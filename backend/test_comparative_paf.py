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


def _write_static_figure_fixture(root: Path) -> None:
    natural_dir = root / "synteny" / "natural"
    natural_dir.mkdir(parents=True)
    natural_dir.joinpath("grcg6a_vs_grcg7b.natural.asm5.paf").write_text(
        "\n".join(
            [
                "NC_006088.5\t197608386\t1000\t9000\t+\tNC_052532.1\t196449156\t2000\t10000\t7600\t8000\t60",
                "NC_006089.5\t149682049\t2000\t12000\t-\tNC_052533.1\t149539284\t3000\t13000\t9100\t10000\t60",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    gene_root = root / "comparative" / "pairwise" / "GRCg6a__GRCg7b" / "gene_collinearity"
    gene_root.mkdir(parents=True)
    gene_root.joinpath("GRCg6a.bed").write_text(
        "\n".join(
            [
                "NC_006088.5\t1000\t2000\tGRCg6a_G000001\t0\t+",
                "NC_006088.5\t3000\t4000\tGRCg6a_G000002\t0\t-",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    gene_root.joinpath("GRCg7b.bed").write_text(
        "\n".join(
            [
                "1\t1500\t2500\tGRCg7b_G000001\t0\t+",
                "1\t3500\t4500\tGRCg7b_G000002\t0\t-",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    gene_root.joinpath("grcg6a_grcg7b.anchors").write_text(
        "\n".join(
            [
                "# MCScan-compatible anchors for test",
                "### GENEBLOCK_00001",
                "GRCg6a_G000001\tGRCg7b_G000001\t100\t99.0\t90.0",
                "GRCg6a_G000002\tGRCg7b_G000002\t120\t98.0\t91.0",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    gene_root.joinpath("blocks.tsv").write_text(
        "\n".join(
            [
                "block_id\tchr_1\tstart_1\tend_1\tchr_2\tstart_2\tend_2\torientation\tanchor_count\tmean_identity\tmean_qcovs\tmethod",
                "GENEBLOCK_00001\t1\t1000\t4000\t1\t1500\t4500\t+\t2\t98.5\t90.5\tBLASTP_RBH_CHAINING",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    gene_root.joinpath("gene_pairs.tsv").write_text(
        "\n".join(
            [
                "pair_id\tblock_id\tgene_1\tgene_2\tgene_symbol_1\tgene_symbol_2\tprotein_id_1\tprotein_id_2\tchr_1\tstart_1\tend_1\tstrand_1\tchr_2\tstart_2\tend_2\tstrand_2\torientation\tpident\talignment_length\tevalue\tbitscore\tqcovs\tmethod",
                "GENEPAIR_000001\tGENEBLOCK_00001\tGRCg6a_G000001\tGRCg7b_G000001\tA\tA\tP1\tP2\t1\t1000\t2000\t+\t1\t1500\t2500\t+\t+\t99.0\t100\t1e-10\t100\t90\tBLASTP_RBH",
                "GENEPAIR_000002\tGENEBLOCK_00001\tGRCg6a_G000002\tGRCg7b_G000002\tB\tB\tP3\tP4\t1\t3000\t4000\t-\t1\t3500\t4500\t-\t+\t98.0\t100\t1e-9\t120\t91\tBLASTP_RBH",
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def test_static_figure_catalog_exposes_four_publication_figures(tmp_path: Path):
    _write_static_figure_fixture(tmp_path)
    store = GoldStandardComparativeStore(tmp_path)

    catalog = store.get_static_figure_catalog()

    assert [item["id"] for item in catalog["figures"]] == [
        "dna-dotplot",
        "gene-collinearity-dotplot",
        "karyotype-ribbons",
        "micro-synteny",
    ]
    assert all(item["status"] == "available" for item in catalog["figures"])
    assert catalog["dynamic_layers"] == [
        "JBrowse2 Natural DNA Synteny",
        "JBrowse2 Gene Collinearity Anchors",
    ]


def test_static_figure_svg_rendering_is_scientifically_labeled(tmp_path: Path):
    _write_static_figure_fixture(tmp_path)
    store = GoldStandardComparativeStore(tmp_path)

    svg = store.render_static_figure_svg("micro-synteny", block_id="GENEBLOCK_00001")

    assert svg.startswith("<svg")
    assert "Micro-synteny" in svg
    assert "GENEBLOCK_00001" in svg
    assert "BLASTP_RBH_CHAINING" in svg


def test_static_figure_svg_accepts_reproducible_style_settings(tmp_path: Path):
    _write_static_figure_fixture(tmp_path)
    store = GoldStandardComparativeStore(tmp_path)

    settings = {
        "width": 1200,
        "height": 700,
        "colorScheme": {
            "forward": "#123456",
            "reverse": "#abcdef",
            "lowConfidence": "#999999",
            "background": "#ffffff",
            "grid": "#dddddd",
            "text": "#111111",
        },
        "showTitle": False,
        "showLegend": True,
        "strokeWidth": 3.0,
        "opacity": 0.42,
        "title": "Custom DNA",
        "subtitle": "Custom subtitle",
    }

    svg = store.render_static_figure_svg("dna-dotplot", settings=settings)

    assert 'width="1200"' in svg
    assert 'height="700"' in svg
    assert "#123456" in svg
    assert "#abcdef" in svg
    assert "stroke-width=\"3.0\"" in svg
    assert "stroke-opacity=\"0.42\"" in svg
    assert '<text x="32" y="36" class="title">Custom DNA</text>' not in svg
    assert "<metadata" in svg
    assert '"figure_id": "dna-dotplot"' in svg
    assert '"showTitle": false' in svg


def test_static_figure_svg_settings_are_clamped_and_block_ids_are_safe(tmp_path: Path):
    _write_static_figure_fixture(tmp_path)
    store = GoldStandardComparativeStore(tmp_path)

    svg = store.render_static_figure_svg(
        "micro-synteny",
        settings={
            "width": 20,
            "height": 20,
            "selectedBlockId": "../GENEBLOCK_00001",
            "showAnchorLines": False,
            "showGeneArrows": True,
        },
    )

    assert 'width="800"' in svg
    assert 'height="600"' in svg
    assert "No anchor pairs are available" in svg
    assert "GENEBLOCK_00001" not in svg


def test_gene_collinearity_file_endpoint_paths_are_safe_and_normalized(tmp_path: Path):
    _write_static_figure_fixture(tmp_path)
    store = GoldStandardComparativeStore(tmp_path)

    anchors = store.get_gene_collinearity_file("grcg6a_grcg7b.anchors")
    grcg7b_bed = store.get_gene_collinearity_file("GRCg7b.bed")

    assert anchors["path"].name == "grcg6a_grcg7b.anchors"
    assert grcg7b_bed["content"].splitlines()[0].startswith("chr1\t")
    assert store.get_gene_collinearity_file("../secret.txt") is None


if __name__ == "__main__":
    import tempfile

    test_parse_paf_line_normalizes_refseq_chromosomes()
    with tempfile.TemporaryDirectory() as tmp:
        test_summarize_paf_records_identifies_natural_dataset(Path(tmp))
    with tempfile.TemporaryDirectory() as tmp:
        test_gold_standard_status_keeps_missing_layers_explicit(Path(tmp))
    with tempfile.TemporaryDirectory() as tmp:
        test_gold_standard_tabix_seqid_mapping(Path(tmp))
    with tempfile.TemporaryDirectory() as tmp:
        test_static_figure_catalog_exposes_four_publication_figures(Path(tmp))
    with tempfile.TemporaryDirectory() as tmp:
        test_static_figure_svg_rendering_is_scientifically_labeled(Path(tmp))
    with tempfile.TemporaryDirectory() as tmp:
        test_static_figure_svg_accepts_reproducible_style_settings(Path(tmp))
    with tempfile.TemporaryDirectory() as tmp:
        test_static_figure_svg_settings_are_clamped_and_block_ids_are_safe(Path(tmp))
    with tempfile.TemporaryDirectory() as tmp:
        test_gene_collinearity_file_endpoint_paths_are_safe_and_normalized(Path(tmp))
    print("All comparative PAF tests passed.")
