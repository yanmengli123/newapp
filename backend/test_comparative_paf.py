"""Tests for comparative PAF parsing and synteny dataset summaries."""

from pathlib import Path

from backend.comparative_paf import (
    parse_paf_line,
    read_paf_records,
    summarize_paf_records,
)


def test_parse_paf_line_normalizes_refseq_chromosomes():
    line = (
        "NC_006088.5\t197608386\t127045112\t128112455\t+\t"
        "NC_052532.1\t196449156\t126254979\t127249113\t"
        "993000\t1000000\t60"
    )

    record = parse_paf_line(line, 0)

    assert record is not None
    assert record.chr_1 == "1"
    assert record.chr_2 == "1"
    assert record.start_1 == 127045112
    assert record.end_1 == 128112455
    assert record.identity == 99.3
    assert record.is_windowed_1mb is False


def test_summarize_paf_records_identifies_windowed_dataset(tmp_path: Path):
    paf = tmp_path / "windowed.paf"
    paf.write_text(
        "\n".join(
            [
                "NC_006088.5\t197608386\t0\t1000000\t+\tNC_052532.1\t196449156\t0\t994133\t996000\t1000000\t60",
                "NC_006088.5\t197608386\t1000000\t2000000\t+\tNC_052532.1\t196449156\t994133\t1988267\t986000\t1000000\t60",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    records = read_paf_records(paf)
    summary = summarize_paf_records(records, dataset="windowed", source_path=paf)

    assert summary["block_count"] == 2
    assert summary["rounded_query_start_fraction"] == 1.0
    assert summary["dataset_classification"] == "1 Mb windowed alignment QC"
    assert summary["query_covered_bases"] == 2000000
    assert summary["target_covered_bases"] == 1988267


def test_summarize_paf_records_identifies_natural_dataset(tmp_path: Path):
    paf = tmp_path / "natural.paf"
    paf.write_text(
        "\n".join(
            [
                "NC_006088.5\t197608386\t127045112\t128112455\t+\tNC_052532.1\t196449156\t126254979\t127249113\t993000\t1000000\t60",
                "NC_006089.5\t149693582\t41022\t904455\t-\tNC_052533.1\t149117098\t33111\t891302\t850000\t890000\t50",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    records = read_paf_records(paf)
    summary = summarize_paf_records(records, dataset="natural", source_path=paf)

    assert summary["block_count"] == 2
    assert summary["rounded_query_start_fraction"] == 0.0
    assert summary["dataset_classification"] == "natural-breakpoint whole-genome alignment"
    assert summary["reverse_strand_blocks"] == 1
    assert summary["chromosomes_1"] == 2
    assert summary["chromosomes_2"] == 2


if __name__ == "__main__":
    import tempfile

    test_parse_paf_line_normalizes_refseq_chromosomes()
    with tempfile.TemporaryDirectory() as tmp:
        test_summarize_paf_records_identifies_windowed_dataset(Path(tmp))
    with tempfile.TemporaryDirectory() as tmp:
        test_summarize_paf_records_identifies_natural_dataset(Path(tmp))
    print("All comparative PAF tests passed.")
