"""Tests for registry-driven comparative assembly metadata."""

import json
from pathlib import Path

from backend.comparative_registry import build_pair_registry, load_assembly_registry


FIELDS = [
    "Assembly Accession",
    "Assembly Name",
    "Assembly-unit name",
    "Chromosome name",
    "GC Count",
    "GC Percent",
    "GenBank seq accession",
    "Molecule type",
    "Ordering",
    "RefSeq seq accession",
    "Role",
    "Seq length",
    "UCSC style name",
    "Sequence name",
]


def write_report(path: Path, rows: list[dict[str, str]]) -> None:
    lines = ["\t".join(FIELDS)]
    for row in rows:
        lines.append("\t".join(row.get(field, "") for field in FIELDS))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_fai(path: Path, rows: list[tuple[str, int]]) -> None:
    offset = 0
    lines = []
    for seqid, length in rows:
        lines.append(f"{seqid}\t{length}\t{offset}\t60\t61")
        offset += length + 100
    path.write_text("\n".join(lines) + "\n", encoding="ascii")


def write_gff(path: Path, seqids: list[str]) -> None:
    lines = ["##gff-version 3"]
    for seqid in seqids:
        lines.append(f"##sequence-region {seqid} 1 100")
        lines.append(f"{seqid}\tRefSeq\tgene\t1\t100\t.\t+\t.\tID=gene-{seqid}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def molecule(chr_name: str, refseq: str, length: int, *, accession: str) -> dict[str, str]:
    return {
        "Assembly Accession": accession,
        "Assembly Name": "Test Assembly",
        "Assembly-unit name": "Primary Assembly" if chr_name != "MT" else "non-nuclear",
        "Chromosome name": chr_name,
        "GenBank seq accession": f"GB_{refseq}",
        "Molecule type": "Mitochondrion" if chr_name == "MT" else "Chromosome",
        "Ordering": "na",
        "RefSeq seq accession": refseq,
        "Role": "assembled-molecule",
        "Seq length": str(length),
        "UCSC style name": f"chr{chr_name}",
        "Sequence name": chr_name,
    }


def test_load_assembly_registry_validates_report_fai_gff_aliases(tmp_path: Path):
    report = tmp_path / "GRCg7b_sequence_report.tsv"
    fai = tmp_path / "GRCg7b.fna.fai"
    gff = tmp_path / "GRCg7b.gff"
    write_report(
        report,
        [
            molecule("1", "NC_052532.1", 1000, accession="GCF_016699485.2"),
            molecule("33", "NC_052564.1", 333, accession="GCF_016699485.2"),
            molecule("39", "NC_052570.1", 390, accession="GCF_016699485.2"),
            molecule("MT", "NC_053523.1", 17, accession="GCF_016699485.2"),
        ],
    )
    write_fai(fai, [("chr1", 1000), ("chr33", 333), ("chr39", 390), ("chrMT", 17)])
    write_gff(gff, ["NC_052532.1", "NC_052564.1", "NC_052570.1", "NC_053523.1"])

    registry = load_assembly_registry(
        assembly_name="GRCg7b",
        sequence_report=report,
        fai_path=fai,
        gff_path=gff,
    )

    assert registry["assembled_molecule_count"] == 4
    assert registry["chromosome_count"] == 3
    assert registry["organelle_count"] == 1
    assert registry["molecules"][1]["chr"] == "33"
    assert registry["molecules"][1]["aliases"] == ["33", "chr33", "NC_052564.1", "GB_NC_052564.1"]
    assert registry["validation"]["status"] == "passed"
    assert registry["validation"]["errors"] == []


def test_pair_registry_keeps_shared_mapping_and_target_only_separate(tmp_path: Path):
    g6_report = tmp_path / "GRCg6a.tsv"
    g7_report = tmp_path / "GRCg7b.tsv"
    g6_fai = tmp_path / "GRCg6a.fai"
    g7_fai = tmp_path / "GRCg7b.fai"
    write_report(
        g6_report,
        [
            molecule("1", "NC_006088.5", 1000, accession="GCF_000002315.6"),
            molecule("33", "NC_008465.4", 333, accession="GCF_000002315.6"),
            molecule("MT", "NC_040902.1", 17, accession="GCF_000002315.6"),
        ],
    )
    write_report(
        g7_report,
        [
            molecule("1", "NC_052532.1", 1000, accession="GCF_016699485.2"),
            molecule("29", "NC_052560.1", 290, accession="GCF_016699485.2"),
            molecule("33", "NC_052564.1", 333, accession="GCF_016699485.2"),
            molecule("34", "NC_052565.1", 340, accession="GCF_016699485.2"),
            molecule("39", "NC_052570.1", 390, accession="GCF_016699485.2"),
            molecule("MT", "NC_053523.1", 17, accession="GCF_016699485.2"),
        ],
    )
    write_fai(g6_fai, [("chr1", 1000), ("chr33", 333), ("chrMT", 17)])
    write_fai(g7_fai, [("chr1", 1000), ("chr29", 290), ("chr33", 333), ("chr34", 340), ("chr39", 390), ("chrMT", 17)])

    pair = build_pair_registry(
        grcg6a_report=g6_report,
        grcg7b_report=g7_report,
        grcg6a_fai=g6_fai,
        grcg7b_fai=g7_fai,
    )

    assert pair["assemblies"]["GRCg6a"]["assembled_molecule_count"] == 3
    assert pair["assemblies"]["GRCg7b"]["assembled_molecule_count"] == 6
    assert [row["chr"] for row in pair["chromosome_mapping"]] == ["1", "33", "MT"]
    assert [row["chr"] for row in pair["target_only_molecules"]] == ["29", "34", "39"]
    assert pair["dotplot_axes"]["query"]["molecule_count"] == 3
    assert pair["dotplot_axes"]["target"]["molecule_count"] == 6
    assert pair["validation"]["status"] == "passed"


def test_comparative_service_serves_registry_overview_and_dotplot_metadata(tmp_path: Path):
    from backend.comparative_service import ComparativeService

    registry_dir = tmp_path / "comparative" / "registry"
    registry_dir.mkdir(parents=True)
    registry = {
        "version": "comparative_gold_v1",
        "pair": {"assembly_1": "GRCg6a", "assembly_2": "GRCg7b", "comparison_id": "GRCg6a__GRCg7b"},
        "assemblies": {
            "GRCg6a": {
                "assembled_molecule_count": 35,
                "chromosome_count": 34,
                "organelle_count": 1,
                "molecules": [{"chr": "1", "display_name": "chr1", "length": 100, "refseq": "NC_006088.5"}],
            },
            "GRCg7b": {
                "assembled_molecule_count": 42,
                "chromosome_count": 41,
                "organelle_count": 1,
                "molecules": [
                    {"chr": "1", "display_name": "chr1", "length": 100, "refseq": "NC_052532.1"},
                    {"chr": "29", "display_name": "chr29", "length": 29, "refseq": "NC_052560.1"},
                ],
            },
        },
        "shared_molecules": ["1"],
        "target_only_molecules": [{"chr": "29", "refseq": "NC_052560.1", "length": 29}],
        "chromosome_mapping": [{"chr": "1", "refseq_from": "NC_006088.5", "refseq_to": "NC_052532.1"}],
        "dotplot_axes": {
            "query": {"assembly": "GRCg6a", "molecule_count": 35, "molecules": [{"chr": "1", "length": 100}]},
            "target": {"assembly": "GRCg7b", "molecule_count": 42, "molecules": [{"chr": "1", "length": 100}, {"chr": "29", "length": 29}]},
        },
        "validation": {"status": "passed", "errors": []},
    }
    registry_dir.joinpath("assembly_registry.json").write_text(json.dumps(registry), encoding="utf-8")

    service = ComparativeService.__new__(ComparativeService)
    service._project_root = lambda: tmp_path

    assert service.get_comparative_registry()["version"] == "comparative_gold_v1"
    assert service.get_comparative_overview()["target_only_count"] == 1
    assert service.get_target_only_molecules()["molecules"][0]["chr"] == "29"
    assert service.get_dotplot_metadata()["axes"]["target"]["molecule_count"] == 42
