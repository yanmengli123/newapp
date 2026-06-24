"""Tests for registry-driven comparative asset generation."""

import gzip
import json
from pathlib import Path

from backend.scripts.build_comparative_registry_assets import build_comparative_assets
from backend.test_comparative_registry import molecule, write_report


def write_fasta(path: Path, records: list[tuple[str, str]]) -> None:
    with path.open("w", encoding="ascii", newline="\n") as handle:
        for name, sequence in records:
            handle.write(f">{name} source record\n")
            handle.write(sequence + "\n")


def test_build_comparative_assets_outputs_registry_aliases_and_target_only(tmp_path: Path):
    g6_report = tmp_path / "GRCg6a.tsv"
    g7_report = tmp_path / "GRCg7b.tsv"
    g6_fasta = tmp_path / "GRCg6a.fna"
    g7_fasta = tmp_path / "GRCg7b.fna"
    g6_gff = tmp_path / "GRCg6a.gff"
    g7_gff = tmp_path / "GRCg7b.gff"
    out_dir = tmp_path / "out"

    write_report(
        g6_report,
        [
            molecule("1", "NC_006088.5", 8, accession="GCF_000002315.6"),
            molecule("33", "NC_008465.4", 6, accession="GCF_000002315.6"),
        ],
    )
    write_report(
        g7_report,
        [
            molecule("1", "NC_052532.1", 8, accession="GCF_016699485.2"),
            molecule("29", "NC_052560.1", 4, accession="GCF_016699485.2"),
            molecule("33", "NC_052564.1", 6, accession="GCF_016699485.2"),
            molecule("34", "NC_052565.1", 5, accession="GCF_016699485.2"),
        ],
    )
    write_fasta(g6_fasta, [("NC_006088.5", "AACCGGTT"), ("NC_008465.4", "AACCGG")])
    write_fasta(
        g7_fasta,
        [
            ("NC_052532.1", "AACCGGTT"),
            ("NC_052560.1", "AAAA"),
            ("NC_052564.1", "CCCCCC"),
            ("NC_052565.1", "GGGGG"),
        ],
    )
    g6_gff.write_text(
        "##gff-version 3\nNC_006088.5\tRefSeq\tgene\t1\t8\t.\t+\t.\tID=gene-a\nNC_008465.4\tRefSeq\tgene\t1\t6\t.\t+\t.\tID=gene-b\n",
        encoding="utf-8",
    )
    g7_gff.write_text(
        "##gff-version 3\nNC_052532.1\tRefSeq\tgene\t1\t8\t.\t+\t.\tID=gene-c\nNC_052560.1\tRefSeq\tgene\t1\t4\t.\t+\t.\tID=gene-d\nNC_052564.1\tRefSeq\tgene\t1\t6\t.\t+\t.\tID=gene-f\nNC_052565.1\tRefSeq\tgene\t1\t5\t.\t+\t.\tID=gene-e\n",
        encoding="utf-8",
    )

    manifest = build_comparative_assets(
        grcg6a_report=g6_report,
        grcg7b_report=g7_report,
        grcg6a_fasta=g6_fasta,
        grcg7b_fasta=g7_fasta,
        grcg6a_gff=g6_gff,
        grcg7b_gff=g7_gff,
        out_dir=out_dir,
        expected_grcg6a=2,
        expected_grcg7b=4,
    )

    registry = json.loads((out_dir / "comparative" / "registry" / "assembly_registry.json").read_text(encoding="utf-8"))
    assert registry["assemblies"]["GRCg6a"]["assembled_molecule_count"] == 2
    assert registry["assemblies"]["GRCg7b"]["assembled_molecule_count"] == 4
    assert [row["chr"] for row in registry["target_only_molecules"]] == ["29", "34"]
    assert (out_dir / "GCF_016699485.2_GRCg7b_primary_42.fna.fai").read_text(encoding="ascii").splitlines()[1].startswith("chr29\t4\t")
    assert "chr34\tNC_052565.1" in (out_dir / "grcg7b_primary_42_aliases.txt").read_text(encoding="ascii")
    with gzip.open(out_dir / "GCF_016699485.2_GRCg7b_primary_42.gff.gz", "rt", encoding="utf-8") as handle:
        gff_text = handle.read()
    assert "chr29\tRefSeq\tgene" in gff_text
    assert "NC_052560.1" not in gff_text
    assert manifest["registry"]["validation"]["status"] == "passed"
