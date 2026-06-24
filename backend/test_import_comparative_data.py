"""Tests for comparative data import helpers."""

from pathlib import Path

from backend.scripts import import_comparative_data as importer


def write_report(path: Path, rows: list[dict[str, str]]) -> None:
    fields = [
        "Assembly Accession",
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
        "Unlocalized Count",
        "Sequence name",
    ]
    lines = ["\t".join(fields)]
    for row in rows:
        lines.append("\t".join(row.get(field, "") for field in fields))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_chromosome_mapping_rows_come_from_sequence_reports(tmp_path: Path):
    grcg6a = tmp_path / "GRCg6a_sequence_report.tsv"
    grcg7b = tmp_path / "GRCg7b_sequence_report.tsv"
    write_report(
        grcg6a,
        [
            {
                "Assembly Accession": "GCF_000002315.6",
                "Assembly-unit name": "Primary Assembly",
                "Chromosome name": "1",
                "GenBank seq accession": "CM000093.5",
                "Molecule type": "Chromosome",
                "RefSeq seq accession": "NC_006088.5",
                "Role": "assembled-molecule",
                "Seq length": "197608386",
                "Sequence name": "1",
            },
            {
                "Assembly Accession": "GCF_000002315.6",
                "Assembly-unit name": "Primary Assembly",
                "Chromosome name": "33",
                "GenBank seq accession": "CM000123.5",
                "Molecule type": "Chromosome",
                "RefSeq seq accession": "NC_008465.4",
                "Role": "assembled-molecule",
                "Seq length": "7821666",
                "Sequence name": "33",
            },
            {
                "Assembly Accession": "GCF_000002315.6",
                "Assembly-unit name": "non-nuclear",
                "Chromosome name": "MT",
                "GenBank seq accession": "GU261716.1",
                "Molecule type": "Mitochondrion",
                "RefSeq seq accession": "NC_040902.1",
                "Role": "assembled-molecule",
                "Seq length": "16784",
                "Sequence name": "MT",
            },
        ],
    )
    write_report(
        grcg7b,
        [
            {
                "Assembly Accession": "GCF_016699485.2",
                "Assembly-unit name": "Primary Assembly",
                "Chromosome name": "1",
                "GenBank seq accession": "CM028482.1",
                "Molecule type": "Chromosome",
                "RefSeq seq accession": "NC_052532.1",
                "Role": "assembled-molecule",
                "Seq length": "196449156",
                "Sequence name": "1",
            },
            {
                "Assembly Accession": "GCF_016699485.2",
                "Assembly-unit name": "Primary Assembly",
                "Chromosome name": "29",
                "GenBank seq accession": "CM028510.1",
                "Molecule type": "Chromosome",
                "RefSeq seq accession": "NC_052560.1",
                "Role": "assembled-molecule",
                "Seq length": "726478",
                "Sequence name": "29",
            },
            {
                "Assembly Accession": "GCF_016699485.2",
                "Assembly-unit name": "Primary Assembly",
                "Chromosome name": "33",
                "GenBank seq accession": "CM028514.1",
                "Molecule type": "Chromosome",
                "RefSeq seq accession": "NC_052564.1",
                "Role": "assembled-molecule",
                "Seq length": "3839931",
                "Sequence name": "33",
            },
            {
                "Assembly Accession": "GCF_016699485.2",
                "Assembly-unit name": "non-nuclear",
                "Chromosome name": "MT",
                "GenBank seq accession": "CM028585.1",
                "Molecule type": "Mitochondrion",
                "RefSeq seq accession": "NC_053523.1",
                "Role": "assembled-molecule",
                "Seq length": "16784",
                "Sequence name": "MT",
            },
        ],
    )

    rows = importer.build_chromosome_mapping_rows(grcg6a, grcg7b)

    assert rows == [
        (
            "GRCg6a",
            "GRCg7b",
            "1",
            "1",
            "NC_006088.5",
            "NC_052532.1",
            "CM000093.5",
            "CM028482.1",
            "+",
            1.0,
        ),
        (
            "GRCg6a",
            "GRCg7b",
            "33",
            "33",
            "NC_008465.4",
            "NC_052564.1",
            "CM000123.5",
            "CM028514.1",
            "+",
            1.0,
        ),
        (
            "GRCg6a",
            "GRCg7b",
            "MT",
            "MT",
            "NC_040902.1",
            "NC_053523.1",
            "GU261716.1",
            "CM028585.1",
            "+",
            1.0,
        ),
    ]
    assert all(row[2] != "29" for row in rows)
