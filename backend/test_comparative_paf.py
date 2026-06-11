"""Tests for comparative PAF parsing and synteny dataset summaries."""

from pathlib import Path

from backend.comparative_paf import (
    parse_paf_line,
    read_paf_records,
    summarize_paf_records,
)
from backend.comparative_gold import GoldStandardComparativeStore


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
    assert summary["dataset_classification"] == "natural-breakpoint whole-genome alignment"
    assert summary["reverse_strand_blocks"] == 1
    assert summary["chromosomes_1"] == 2
    assert summary["chromosomes_2"] == 2
    assert "rounded_query_start_fraction" not in summary
    assert "one_mb_windowed_blocks" not in summary


def test_gold_standard_status_keeps_missing_layers_explicit(tmp_path: Path):
    natural_dir = tmp_path / "synteny" / "natural"
    natural_dir.mkdir(parents=True)
    (natural_dir / "grcg6a_vs_grcg7b.natural.asm5.paf").write_text(
        "NC_006088.5\t197608386\t127045112\t128112455\t+\tNC_052532.1\t196449156\t126254979\t127249113\t993000\t1000000\t60\n",
        encoding="utf-8",
    )
    (tmp_path / "synteny" / "grcg6a_vs_grcg7b.paf").write_text(
        "NC_006088.5\t197608386\t0\t1000000\t+\tNC_052532.1\t196449156\t0\t994133\t996000\t1000000\t60\n",
        encoding="utf-8",
    )

    store = GoldStandardComparativeStore(tmp_path)
    status = store.get_status()

    assert status["layers"]["dna_natural_synteny"]["status"] == "available"
    assert status["layers"]["base_level_alignment"]["status"] == "missing"
    assert status["layers"]["gene_collinearity"]["status"] == "missing"
    assert "windowed_qc" not in status["layers"]
    assert status["fallback_policy"]["fallback_allowed"] is False
    assert status["fallback_policy"]["fallback_dataset"] is None

    base_level = store.get_base_level_records(chr_name="1", start=0, end=1000)
    assert base_level["status"] == "missing"
    assert base_level["records"] == []


def test_gold_standard_tabix_seqid_mapping(tmp_path: Path):
    store = GoldStandardComparativeStore(tmp_path)

    assert store._tabix_seqid("query", "1") == "NC_006088.5"
    assert store._tabix_seqid("query", "chr1") == "NC_006088.5"
    assert store._tabix_seqid("query", "Z") == "NC_006127.5"
    assert store._tabix_seqid("target", "1") == "chr1"
    assert store._tabix_seqid("target", "chr1") == "chr1"
    assert store._tabix_seqid("target", "MT") == "chrMT"


if __name__ == "__main__":
    import tempfile

    test_parse_paf_line_normalizes_refseq_chromosomes()
    with tempfile.TemporaryDirectory() as tmp:
        test_summarize_paf_records_identifies_natural_dataset(Path(tmp))
    with tempfile.TemporaryDirectory() as tmp:
        test_gold_standard_status_keeps_missing_layers_explicit(Path(tmp))
    with tempfile.TemporaryDirectory() as tmp:
        test_gold_standard_tabix_seqid_mapping(Path(tmp))
    print("All comparative PAF tests passed.")
