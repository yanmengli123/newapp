"""Build registry-driven GRCg6a/GRCg7b comparative assets.

This intentionally excludes MUMmer4. The outputs support the website's
registry-driven DNA synteny, base-level alignment, and gene-collinearity layers.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.comparative_registry import (
    build_pair_registry,
    chromosome_sort_key,
    display_chr,
    file_sha256,
    molecule_aliases,
    normalize_chr_name,
    read_sequence_report,
)


DROP_GFF_TYPES = {"region", "cDNA_match"}


def open_text(path: Path):
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8", errors="replace")
    return path.open("r", encoding="utf-8", errors="replace")


def report_molecules(report: Path, selected_chrs: set[str] | None = None) -> list[dict]:
    molecules: list[dict] = []
    for row in read_sequence_report(report):
        if row.get("Role", "").strip() != "assembled-molecule":
            continue
        if row.get("Molecule type", "").strip() not in {"Chromosome", "Mitochondrion"}:
            continue
        chr_name = normalize_chr_name(row.get("Chromosome name", ""))
        refseq = row.get("RefSeq seq accession", "").strip()
        if not chr_name or not refseq:
            continue
        if selected_chrs is not None and chr_name not in selected_chrs:
            continue
        molecules.append(
            {
                "chr": chr_name,
                "display_name": display_chr(chr_name),
                "refseq": refseq,
                "genbank": row.get("GenBank seq accession", "").strip(),
                "ucsc": row.get("UCSC style name", "").strip(),
                "length": int(row.get("Seq length", "0")),
                "molecule_type": row.get("Molecule type", "").strip(),
            }
        )
    molecules.sort(key=lambda item: chromosome_sort_key(item["chr"]))
    return molecules


def alias_lookup(molecules: Iterable[dict]) -> dict[str, dict]:
    lookup: dict[str, dict] = {}
    for molecule in molecules:
        for alias in molecule_aliases(
            molecule["chr"],
            molecule["refseq"],
            molecule.get("genbank", ""),
            molecule.get("ucsc", ""),
        ):
            lookup[alias] = molecule
    return lookup


def write_fai(fasta: Path, fai: Path) -> None:
    records: list[tuple[str, int, int, int, int]] = []
    current_name: str | None = None
    current_length = 0
    seq_offset = 0
    line_bases = 0
    line_width = 0
    offset = 0
    with fasta.open("rb") as handle:
        for raw_line in handle:
            if raw_line.startswith(b">"):
                if current_name is not None:
                    records.append((current_name, current_length, seq_offset, line_bases, line_width))
                current_name = raw_line[1:].split()[0].decode("ascii")
                current_length = 0
                seq_offset = offset + len(raw_line)
                line_bases = 0
                line_width = 0
            else:
                stripped = raw_line.rstrip(b"\r\n")
                if stripped and line_bases == 0:
                    line_bases = len(stripped)
                    line_width = len(raw_line)
                current_length += len(stripped)
            offset += len(raw_line)
    if current_name is not None:
        records.append((current_name, current_length, seq_offset, line_bases, line_width))
    with fai.open("w", encoding="ascii", newline="\n") as out:
        for record in records:
            out.write("\t".join(map(str, record)) + "\n")


def write_filtered_fasta(source_fasta: Path, molecules: list[dict], out_fasta: Path) -> int:
    lookup = alias_lookup(molecules)
    expected = {molecule["display_name"] for molecule in molecules}
    seen: set[str] = set()
    current: dict | None = None
    with open_text(source_fasta) as src, out_fasta.open("w", encoding="ascii", newline="\n") as out:
        for line in src:
            if line.startswith(">"):
                token = line[1:].split()[0]
                current = lookup.get(token)
                if current:
                    seen.add(current["display_name"])
                    out.write(f">{current['display_name']} {current['refseq']} {current['molecule_type']}\n")
                continue
            if current:
                sequence = line.strip().upper()
                for start in range(0, len(sequence), 60):
                    out.write(sequence[start:start + 60] + "\n")
    missing = sorted(expected - seen, key=chromosome_sort_key)
    if missing:
        raise ValueError(f"{source_fasta} did not contain selected molecules: {', '.join(missing)}")
    return len(seen)


def write_filtered_gff(source_gff: Path, molecules: list[dict], out_gff: Path) -> int:
    lookup = alias_lookup(molecules)
    kept = 0
    with open_text(source_gff) as src, gzip.open(out_gff, "wt", encoding="utf-8", newline="\n") as out:
        for line in src:
            if line.startswith("##sequence-region "):
                fields = line.rstrip("\n").split()
                if len(fields) >= 4 and fields[1] in lookup:
                    out.write(f"##sequence-region {lookup[fields[1]]['display_name']} {fields[2]} {fields[3]}\n")
                continue
            if line.startswith("#"):
                out.write(line)
                continue
            fields = line.rstrip("\n").split("\t")
            if len(fields) < 9:
                continue
            molecule = lookup.get(fields[0])
            if molecule is None or fields[2] in DROP_GFF_TYPES:
                continue
            fields[0] = molecule["display_name"]
            out.write("\t".join(fields) + "\n")
            kept += 1
    return kept


def write_aliases(molecules: list[dict], out_path: Path) -> None:
    with out_path.open("w", encoding="ascii", newline="\n") as handle:
        handle.write("# alias\tNCBI accession\n")
        for molecule in molecules:
            handle.write(f"{molecule['display_name']}\t{molecule['refseq']}\n")


def write_tsv(path: Path, rows: list[dict], fields: list[str]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, delimiter="\t")
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fields})


def write_checksums(path: Path, files: list[Path]) -> None:
    with path.open("w", encoding="ascii", newline="\n") as handle:
        for file_path in files:
            digest = file_sha256(file_path)
            if digest:
                handle.write(f"{digest}  {file_path.name}\n")


def build_comparative_assets(
    *,
    grcg6a_report: Path,
    grcg7b_report: Path,
    grcg6a_fasta: Path,
    grcg7b_fasta: Path,
    grcg6a_gff: Path,
    grcg7b_gff: Path,
    out_dir: Path,
    expected_grcg6a: int = 35,
    expected_grcg7b: int = 42,
) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    registry_dir = out_dir / "comparative" / "registry"
    registry_dir.mkdir(parents=True, exist_ok=True)

    g6_molecules = report_molecules(grcg6a_report)
    g7_molecules = report_molecules(grcg7b_report)
    g6_chrs = {item["chr"] for item in g6_molecules}
    g7_chrs = {item["chr"] for item in g7_molecules}
    target_only_chrs = set(g7_chrs - g6_chrs)
    g7_extra_molecules = [item for item in g7_molecules if item["chr"] in target_only_chrs]

    g6_primary_fasta = out_dir / "GCF_000002315.6_GRCg6a_primary_35.fna"
    g7_primary_fasta = out_dir / "GCF_016699485.2_GRCg7b_primary_42.fna"
    g7_extra_fasta = out_dir / "GCF_016699485.2_GRCg7b_extra_7.fna"
    g6_primary_gff = out_dir / "GCF_000002315.6_GRCg6a_primary_35.gff.gz"
    g7_primary_gff = out_dir / "GCF_016699485.2_GRCg7b_primary_42.gff.gz"
    g7_extra_gff = out_dir / "GCF_016699485.2_GRCg7b_extra_7.gff.gz"

    write_filtered_fasta(grcg6a_fasta, g6_molecules, g6_primary_fasta)
    write_filtered_fasta(grcg7b_fasta, g7_molecules, g7_primary_fasta)
    write_filtered_fasta(grcg7b_fasta, g7_extra_molecules, g7_extra_fasta)
    write_fai(g6_primary_fasta, Path(f"{g6_primary_fasta}.fai"))
    write_fai(g7_primary_fasta, Path(f"{g7_primary_fasta}.fai"))
    write_fai(g7_extra_fasta, Path(f"{g7_extra_fasta}.fai"))
    write_filtered_gff(grcg6a_gff, g6_molecules, g6_primary_gff)
    write_filtered_gff(grcg7b_gff, g7_molecules, g7_primary_gff)
    write_filtered_gff(grcg7b_gff, g7_extra_molecules, g7_extra_gff)
    write_aliases(g6_molecules, out_dir / "grcg6a_primary_35_aliases.txt")
    write_aliases(g7_molecules, out_dir / "grcg7b_primary_42_aliases.txt")
    write_aliases(g7_extra_molecules, out_dir / "grcg7b_extra_7_aliases.txt")

    registry = build_pair_registry(
        grcg6a_report=grcg6a_report,
        grcg7b_report=grcg7b_report,
        grcg6a_fasta=g6_primary_fasta,
        grcg7b_fasta=g7_primary_fasta,
        grcg6a_fai=Path(f"{g6_primary_fasta}.fai"),
        grcg7b_fai=Path(f"{g7_primary_fasta}.fai"),
        grcg6a_gff=g6_primary_gff,
        grcg7b_gff=g7_primary_gff,
        expected_grcg6a_molecules=expected_grcg6a,
        expected_grcg7b_molecules=expected_grcg7b,
    )
    registry_path = registry_dir / "assembly_registry.json"
    registry_path.write_text(json.dumps(registry, indent=2), encoding="utf-8")

    write_tsv(
        registry_dir / "chromosome_mapping.tsv",
        registry["chromosome_mapping"],
        ["chr", "chr_from", "chr_to", "refseq_from", "refseq_to", "genbank_from", "genbank_to", "length_from", "length_to", "strand", "mapping_type"],
    )
    write_tsv(
        registry_dir / "target_only_molecules.tsv",
        registry["target_only_molecules"],
        ["chr", "display_name", "refseq", "genbank", "length", "molecule_type", "interpretation"],
    )
    alias_rows = [
        {"assembly": "GRCg6a", "alias": item["display_name"], "refseq": item["refseq"]}
        for item in g6_molecules
    ] + [
        {"assembly": "GRCg7b", "alias": item["display_name"], "refseq": item["refseq"]}
        for item in g7_molecules
    ]
    write_tsv(registry_dir / "aliases.tsv", alias_rows, ["assembly", "alias", "refseq"])
    (registry_dir / "validation_report.json").write_text(
        json.dumps(registry["validation"], indent=2),
        encoding="utf-8",
    )

    generated_files = [
        g6_primary_fasta,
        Path(f"{g6_primary_fasta}.fai"),
        g6_primary_gff,
        g7_primary_fasta,
        Path(f"{g7_primary_fasta}.fai"),
        g7_primary_gff,
        g7_extra_fasta,
        Path(f"{g7_extra_fasta}.fai"),
        g7_extra_gff,
        registry_path,
        registry_dir / "chromosome_mapping.tsv",
        registry_dir / "target_only_molecules.tsv",
        registry_dir / "aliases.tsv",
    ]
    write_checksums(registry_dir / "checksums.sha256", generated_files)
    manifest = {
        "dataset_version": "comparative_gold_v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mummer4_qc": "not_generated",
        "registry": registry,
        "files": {path.stem: str(path) for path in generated_files},
        "checksums": {path.name: file_sha256(path) for path in generated_files},
    }
    (registry_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Build registry-driven comparative assets, excluding MUMmer4 QC.")
    parser.add_argument("--grcg6a-report", required=True, type=Path)
    parser.add_argument("--grcg7b-report", required=True, type=Path)
    parser.add_argument("--grcg6a-fasta", required=True, type=Path)
    parser.add_argument("--grcg7b-fasta", required=True, type=Path)
    parser.add_argument("--grcg6a-gff", required=True, type=Path)
    parser.add_argument("--grcg7b-gff", required=True, type=Path)
    parser.add_argument("--out-dir", default=Path(r"D:\jbrowsedata\projectdata"), type=Path)
    parser.add_argument("--expected-grcg6a", default=35, type=int)
    parser.add_argument("--expected-grcg7b", default=42, type=int)
    args = parser.parse_args()
    manifest = build_comparative_assets(
        grcg6a_report=args.grcg6a_report,
        grcg7b_report=args.grcg7b_report,
        grcg6a_fasta=args.grcg6a_fasta,
        grcg7b_fasta=args.grcg7b_fasta,
        grcg6a_gff=args.grcg6a_gff,
        grcg7b_gff=args.grcg7b_gff,
        out_dir=args.out_dir,
        expected_grcg6a=args.expected_grcg6a,
        expected_grcg7b=args.expected_grcg7b,
    )
    print(json.dumps({
        "dataset_version": manifest["dataset_version"],
        "validation": manifest["registry"]["validation"],
        "registry": manifest["files"]["assembly_registry"],
    }, indent=2))


if __name__ == "__main__":
    main()
