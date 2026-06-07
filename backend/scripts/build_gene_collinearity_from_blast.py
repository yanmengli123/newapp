"""Build conservative gene-level collinearity from reciprocal BLASTP hits.

This is a dependency-light fallback for environments that do not have JCVI or
MCScanX installed. It does not claim to be MCScanX output. It produces an
auditable BLASTP reciprocal-best-hit anchor set and simple genomic chaining
blocks for the comparative browser.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from statistics import mean

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.comparative_paf import GRCG6A_REFSEQ_TO_CHR, chromosome_sort_key


@dataclass
class Gene:
    canonical_id: str
    assembly: str
    chr_name: str
    start: int
    end: int
    strand: str
    gene_id: str
    gene_symbol: str
    protein_id: str


@dataclass
class Hit:
    query: str
    subject: str
    pident: float
    length: int
    evalue: float
    bitscore: float
    qcovs: float

    def rank(self) -> tuple[float, float, float, float]:
        return (self.bitscore, -self.evalue, self.pident, self.qcovs)


def normalize_chr(assembly: str, chr_name: str) -> str:
    if assembly == "GRCg6a":
        return GRCG6A_REFSEQ_TO_CHR.get(chr_name, chr_name.removeprefix("chr"))
    return chr_name.removeprefix("chr")


def read_genes(path: Path) -> dict[str, Gene]:
    genes: dict[str, Gene] = {}
    with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        for row in reader:
            canonical_id = row["canonical_id"]
            assembly = row["assembly"]
            genes[canonical_id] = Gene(
                canonical_id=canonical_id,
                assembly=assembly,
                chr_name=normalize_chr(assembly, row["chr"]),
                start=int(row["start"]),
                end=int(row["end"]),
                strand=row["strand"] or ".",
                gene_id=row["gene_id"],
                gene_symbol=row["gene_symbol"],
                protein_id=row["protein_id"],
            )
    return genes


def read_best_hits(
    path: Path,
    *,
    min_identity: float,
    min_qcov: float,
) -> dict[str, Hit]:
    best: dict[str, Hit] = {}
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if not line.strip():
                continue
            fields = line.rstrip("\n").split("\t")
            if len(fields) < 13:
                continue
            hit = Hit(
                query=fields[0],
                subject=fields[1],
                pident=float(fields[2]),
                length=int(fields[3]),
                evalue=float(fields[10]),
                bitscore=float(fields[11]),
                qcovs=float(fields[12]),
            )
            if hit.pident < min_identity or hit.qcovs < min_qcov:
                continue
            current = best.get(hit.query)
            if current is None or hit.rank() > current.rank():
                best[hit.query] = hit
    return best


def reciprocal_best_hits(forward: dict[str, Hit], reverse: dict[str, Hit]) -> list[Hit]:
    pairs: list[Hit] = []
    for query, hit in forward.items():
        reverse_hit = reverse.get(hit.subject)
        if reverse_hit and reverse_hit.subject == query:
            pairs.append(hit)
    return pairs


def pair_orientation(gene_1: Gene, gene_2: Gene) -> str:
    if gene_1.strand in {"+", "-"} and gene_2.strand in {"+", "-"}:
        return "+" if gene_1.strand == gene_2.strand else "-"
    return "."


def build_blocks(
    pairs: list[dict],
    *,
    min_anchors: int,
    max_gap: int,
) -> tuple[list[dict], dict[str, str]]:
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for pair in pairs:
        grouped[(pair["chr_1"], pair["chr_2"])].append(pair)

    blocks: list[dict] = []
    pair_to_block: dict[str, str] = {}

    def finish(block_pairs: list[dict], orientation: str) -> None:
        if len(block_pairs) < min_anchors:
            return
        block_id = f"GENEBLOCK_{len(blocks) + 1:05d}"
        starts_1 = [int(row["start_1"]) for row in block_pairs]
        ends_1 = [int(row["end_1"]) for row in block_pairs]
        starts_2 = [int(row["start_2"]) for row in block_pairs]
        ends_2 = [int(row["end_2"]) for row in block_pairs]
        for row in block_pairs:
            pair_to_block[row["pair_id"]] = block_id
        blocks.append(
            {
                "block_id": block_id,
                "chr_1": block_pairs[0]["chr_1"],
                "start_1": min(starts_1),
                "end_1": max(ends_1),
                "chr_2": block_pairs[0]["chr_2"],
                "start_2": min(starts_2),
                "end_2": max(ends_2),
                "orientation": orientation,
                "anchor_count": len(block_pairs),
                "mean_identity": round(mean(float(row["pident"]) for row in block_pairs), 3),
                "mean_qcovs": round(mean(float(row["qcovs"]) for row in block_pairs), 3),
                "method": "BLASTP_RBH_CHAINING",
            }
        )

    for (chr_1, chr_2), rows in sorted(
        grouped.items(),
        key=lambda item: (chromosome_sort_key(item[0][0]), chromosome_sort_key(item[0][1])),
    ):
        rows.sort(key=lambda row: (int(row["start_1"]), int(row["start_2"])))
        block: list[dict] = []
        orientation = "."
        prev: dict | None = None

        for row in rows:
            if prev is None:
                block = [row]
                prev = row
                continue

            step_orientation = "+" if int(row["start_2"]) >= int(prev["start_2"]) else "-"
            candidate_orientation = step_orientation if orientation == "." else orientation
            query_gap = int(row["start_1"]) - int(prev["start_1"])
            target_gap = (
                int(row["start_2"]) - int(prev["start_2"])
                if candidate_orientation == "+"
                else int(prev["start_2"]) - int(row["start_2"])
            )
            split = (
                (orientation != "." and step_orientation != orientation)
                or query_gap < 0
                or target_gap < 0
                or query_gap > max_gap
                or target_gap > max_gap
            )

            if split:
                finish(block, orientation)
                block = [row]
                orientation = "."
            else:
                block.append(row)
                orientation = candidate_orientation
            prev = row

        finish(block, orientation)

    return blocks, pair_to_block


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gene-root", required=True, type=Path)
    parser.add_argument("--min-identity", default=50.0, type=float)
    parser.add_argument("--min-qcov", default=50.0, type=float)
    parser.add_argument("--min-anchors", default=3, type=int)
    parser.add_argument("--max-gap", default=10_000_000, type=int)
    args = parser.parse_args()

    gene_root = args.gene_root
    g6 = read_genes(gene_root / "GRCg6a.id_map.tsv")
    g7 = read_genes(gene_root / "GRCg7b.id_map.tsv")
    forward = read_best_hits(
        gene_root / "blast" / "GRCg6a_vs_GRCg7b.blastp.tsv",
        min_identity=args.min_identity,
        min_qcov=args.min_qcov,
    )
    reverse = read_best_hits(
        gene_root / "blast" / "GRCg7b_vs_GRCg6a.blastp.tsv",
        min_identity=args.min_identity,
        min_qcov=args.min_qcov,
    )
    rbh = reciprocal_best_hits(forward, reverse)

    pairs: list[dict] = []
    for index, hit in enumerate(sorted(rbh, key=lambda item: item.query), start=1):
        gene_1 = g6.get(hit.query)
        gene_2 = g7.get(hit.subject)
        if gene_1 is None or gene_2 is None:
            continue
        pairs.append(
            {
                "pair_id": f"GENEPAIR_{index:06d}",
                "block_id": "",
                "gene_1": gene_1.canonical_id,
                "gene_2": gene_2.canonical_id,
                "gene_symbol_1": gene_1.gene_symbol,
                "gene_symbol_2": gene_2.gene_symbol,
                "protein_id_1": gene_1.protein_id,
                "protein_id_2": gene_2.protein_id,
                "chr_1": gene_1.chr_name,
                "start_1": gene_1.start,
                "end_1": gene_1.end,
                "strand_1": gene_1.strand,
                "chr_2": gene_2.chr_name,
                "start_2": gene_2.start,
                "end_2": gene_2.end,
                "strand_2": gene_2.strand,
                "orientation": pair_orientation(gene_1, gene_2),
                "pident": round(hit.pident, 3),
                "alignment_length": hit.length,
                "evalue": hit.evalue,
                "bitscore": hit.bitscore,
                "qcovs": hit.qcovs,
                "method": "BLASTP_RBH",
            }
        )

    blocks, pair_to_block = build_blocks(
        pairs,
        min_anchors=args.min_anchors,
        max_gap=args.max_gap,
    )
    for pair in pairs:
        pair["block_id"] = pair_to_block.get(pair["pair_id"], "")

    pairs.sort(
        key=lambda row: (
            chromosome_sort_key(str(row["chr_1"])),
            int(row["start_1"]),
            chromosome_sort_key(str(row["chr_2"])),
            int(row["start_2"]),
        )
    )
    blocks.sort(
        key=lambda row: (
            chromosome_sort_key(str(row["chr_1"])),
            int(row["start_1"]),
            chromosome_sort_key(str(row["chr_2"])),
            int(row["start_2"]),
        )
    )

    pair_fields = list(pairs[0].keys()) if pairs else []
    with (gene_root / "gene_pairs.tsv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=pair_fields, delimiter="\t")
        writer.writeheader()
        writer.writerows(pairs)

    block_fields = list(blocks[0].keys()) if blocks else [
        "block_id",
        "chr_1",
        "start_1",
        "end_1",
        "chr_2",
        "start_2",
        "end_2",
        "orientation",
        "anchor_count",
        "mean_identity",
        "mean_qcovs",
        "method",
    ]
    with (gene_root / "blocks.tsv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=block_fields, delimiter="\t")
        writer.writeheader()
        writer.writerows(blocks)

    with (gene_root / "grcg6a_grcg7b.anchors").open("w", encoding="utf-8", newline="") as handle:
        handle.write("# BLASTP reciprocal-best-hit chained anchors\n")
        handle.write("# This is not MCScanX/JCVI native output; method=BLASTP_RBH_CHAINING\n")
        current_block = None
        for pair in pairs:
            block_id = pair["block_id"] or "UNBLOCKED"
            if block_id != current_block:
                handle.write(f"### {block_id}\n")
                current_block = block_id
            handle.write(
                f"{pair['gene_1']}\t{pair['gene_2']}\t{pair['bitscore']}\t"
                f"{pair['pident']}\t{pair['qcovs']}\n"
            )

    provenance = {
        "dataset": "GRCg6a_vs_GRCg7b_gene_collinearity",
        "method": "BLASTP reciprocal-best-hit plus genomic chaining",
        "is_mcscanx_or_jcvi_native": False,
        "min_identity": args.min_identity,
        "min_qcov": args.min_qcov,
        "min_anchors_per_block": args.min_anchors,
        "max_gap": args.max_gap,
        "forward_hits": str(gene_root / "blast" / "GRCg6a_vs_GRCg7b.blastp.tsv"),
        "reverse_hits": str(gene_root / "blast" / "GRCg7b_vs_GRCg6a.blastp.tsv"),
        "pair_count": len(pairs),
        "block_count": len(blocks),
    }
    (gene_root / "provenance.json").write_text(json.dumps(provenance, indent=2), encoding="utf-8")

    print(json.dumps(provenance, indent=2))


if __name__ == "__main__":
    main()
