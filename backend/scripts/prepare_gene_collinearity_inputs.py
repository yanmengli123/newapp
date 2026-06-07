"""Prepare gene-level collinearity inputs for JCVI/MCScanX.

The difficult part of NCBI RefSeq gene synteny is not BLAST itself; it is
keeping GFF3 gene/transcript/protein identifiers consistent. This script builds
a stable internal ID map and canonical BED/protein FASTA files that downstream
tools can use without depending on noisy original headers.

It does not run BLASTP, DIAMOND, JCVI, or MCScanX. It prepares their inputs.
"""

from __future__ import annotations

import argparse
import gzip
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import unquote


@dataclass
class GeneModel:
    canonical_id: str
    assembly: str
    chr_name: str
    start: int
    end: int
    strand: str
    gene_id: str
    gene_symbol: str
    locus_tag: str
    protein_id: str
    transcript_id: str
    attributes: str


def open_text(path: Path):
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8", errors="replace")
    return path.open("r", encoding="utf-8", errors="replace")


def parse_attrs(raw: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    for item in raw.split(";"):
        if not item or "=" not in item:
            continue
        key, value = item.split("=", 1)
        attrs[key] = unquote(value)
    return attrs


def first_dbxref(attrs: dict[str, str], prefix: str) -> str:
    for value in attrs.get("Dbxref", "").split(","):
        if value.startswith(prefix):
            return value.split(":", 1)[1]
    return ""


def normalize_chr(seqid: str) -> str:
    if seqid.startswith("chr"):
        return seqid[3:]
    return seqid


def parse_gff_genes(path: Path, assembly: str) -> list[GeneModel]:
    genes: dict[str, dict] = {}
    transcript_to_gene: dict[str, str] = {}
    gene_proteins: dict[str, str] = {}
    gene_transcripts: dict[str, str] = {}

    with open_text(path) as handle:
        for line in handle:
            if not line.strip() or line.startswith("#"):
                continue
            fields = line.rstrip("\n").split("\t")
            if len(fields) != 9:
                continue
            seqid, _, feature_type, start_raw, end_raw, _, strand, _, attr_raw = fields
            attrs = parse_attrs(attr_raw)
            feature_id = attrs.get("ID", "")
            parent = attrs.get("Parent", "")
            if feature_type == "gene":
                gene_key = feature_id or attrs.get("gene", "") or attrs.get("locus_tag", "")
                if not gene_key:
                    continue
                genes[gene_key] = {
                    "chr_name": normalize_chr(seqid),
                    "start": int(start_raw),
                    "end": int(end_raw),
                    "strand": strand,
                    "gene_id": first_dbxref(attrs, "GeneID:") or gene_key,
                    "gene_symbol": attrs.get("Name", attrs.get("gene", "")),
                    "locus_tag": attrs.get("locus_tag", ""),
                    "attributes": attr_raw,
                }
            elif feature_type in {"mRNA", "transcript"}:
                if feature_id and parent:
                    transcript_to_gene[feature_id] = parent
                    gene_transcripts.setdefault(parent, feature_id)
            elif feature_type == "CDS":
                protein_id = attrs.get("protein_id", "")
                if not protein_id:
                    continue
                parent_gene = ""
                for parent_id in parent.split(","):
                    parent_gene = transcript_to_gene.get(parent_id, parent_id)
                    if parent_gene in genes:
                        break
                if parent_gene:
                    gene_proteins.setdefault(parent_gene, protein_id)
                    if parent:
                        gene_transcripts.setdefault(parent_gene, parent.split(",")[0])

    models: list[GeneModel] = []
    for index, (gene_key, row) in enumerate(sorted(genes.items(), key=lambda item: (item[1]["chr_name"], item[1]["start"]))):
        canonical_id = f"{assembly}_G{index + 1:06d}"
        models.append(
            GeneModel(
                canonical_id=canonical_id,
                assembly=assembly,
                chr_name=row["chr_name"],
                start=row["start"],
                end=row["end"],
                strand=row["strand"],
                gene_id=row["gene_id"],
                gene_symbol=row["gene_symbol"],
                locus_tag=row["locus_tag"],
                protein_id=gene_proteins.get(gene_key, ""),
                transcript_id=gene_transcripts.get(gene_key, ""),
                attributes=row["attributes"],
            )
        )
    return models


def fasta_records(path: Path) -> Iterable[tuple[str, str, str]]:
    header = ""
    seq_parts: list[str] = []
    with open_text(path) as handle:
        for line in handle:
            line = line.rstrip("\n")
            if line.startswith(">"):
                if header:
                    yield header, extract_accession(header), "".join(seq_parts)
                header = line[1:]
                seq_parts = []
            else:
                seq_parts.append(line.strip())
    if header:
        yield header, extract_accession(header), "".join(seq_parts)


def extract_accession(header: str) -> str:
    token = header.split()[0]
    token = token.replace("ref|", "").replace("gb|", "").strip("|")
    match = re.search(r"([A-Z]{2,3}_[0-9]+\.[0-9]+)", header)
    return match.group(1) if match else token


def write_outputs(models: list[GeneModel], protein_fasta: Path, out_dir: Path, assembly: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    id_map = out_dir / f"{assembly}.id_map.tsv"
    bed = out_dir / f"{assembly}.bed"
    canonical_faa = out_dir / f"{assembly}.protein.canonical.faa"

    by_protein = {model.protein_id: model for model in models if model.protein_id}
    with id_map.open("w", encoding="utf-8", newline="") as handle:
        handle.write(
            "canonical_id\tassembly\tchr\tstart\tend\tstrand\tgene_id\tgene_symbol\t"
            "locus_tag\ttranscript_id\tprotein_id\toriginal_attributes\n"
        )
        for model in models:
            handle.write(
                f"{model.canonical_id}\t{model.assembly}\t{model.chr_name}\t{model.start}\t{model.end}\t"
                f"{model.strand}\t{model.gene_id}\t{model.gene_symbol}\t{model.locus_tag}\t"
                f"{model.transcript_id}\t{model.protein_id}\t{model.attributes}\n"
            )

    with bed.open("w", encoding="utf-8", newline="") as handle:
        for model in models:
            handle.write(f"{model.chr_name}\t{max(0, model.start - 1)}\t{model.end}\t{model.canonical_id}\t0\t{model.strand}\n")

    written = 0
    with canonical_faa.open("w", encoding="utf-8", newline="") as out_handle:
        for header, accession, seq in fasta_records(protein_fasta):
            model = by_protein.get(accession)
            if not model:
                continue
            out_handle.write(f">{model.canonical_id} protein_id={accession} original={header}\n")
            for i in range(0, len(seq), 60):
                out_handle.write(seq[i:i + 60] + "\n")
            written += 1

    print(f"{assembly}: genes={len(models)} canonical_proteins={written} out={out_dir}")


def merge_id_maps(out_dir: Path) -> None:
    merged = out_dir / "id_map.tsv"
    files = sorted(out_dir.glob("*.id_map.tsv"))
    with merged.open("w", encoding="utf-8", newline="") as out_handle:
        wrote_header = False
        for path in files:
            with path.open("r", encoding="utf-8", errors="replace") as in_handle:
                for line_no, line in enumerate(in_handle):
                    if line_no == 0:
                        if not wrote_header:
                            out_handle.write(line)
                            wrote_header = True
                        continue
                    out_handle.write(line)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--grcg6a-gff", required=True, type=Path)
    parser.add_argument("--grcg6a-protein", required=True, type=Path)
    parser.add_argument("--grcg7b-gff", required=True, type=Path)
    parser.add_argument("--grcg7b-protein", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    args = parser.parse_args()

    grcg6a = parse_gff_genes(args.grcg6a_gff, "GRCg6a")
    grcg7b = parse_gff_genes(args.grcg7b_gff, "GRCg7b")
    write_outputs(grcg6a, args.grcg6a_protein, args.out_dir, "GRCg6a")
    write_outputs(grcg7b, args.grcg7b_protein, args.out_dir, "GRCg7b")
    merge_id_maps(args.out_dir)

    print("Next steps:")
    print("  1. Run BLASTP/DIAMOND between canonical protein FASTA files.")
    print("  2. Feed BED + hits into JCVI or MCScanX.")
    print("  3. Export gene_pairs.tsv, blocks.tsv, and grcg6a_grcg7b.anchors.")


if __name__ == "__main__":
    main()
