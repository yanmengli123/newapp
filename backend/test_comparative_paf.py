"""Tests for comparative PAF parsing and synteny dataset summaries."""

import json
from pathlib import Path
import re

from backend.comparative_paf import (
    chromosome_sort_key,
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


def test_chromosome_sort_key_keeps_chicken_karyotype_order():
    chromosomes = ["1", "10", "2", "W", "Z", "MT", "32", "chr3"]

    ordered = sorted(chromosomes, key=chromosome_sort_key)

    assert ordered == ["1", "2", "chr3", "10", "32", "W", "Z", "MT"]


def test_base_level_records_prefers_native_tabix_backend(tmp_path: Path, monkeypatch):
    store = GoldStandardComparativeStore(tmp_path)
    store.base_level_paf.parent.mkdir(parents=True, exist_ok=True)
    store.base_level_paf.write_text("", encoding="utf-8")
    store.base_level_query_index.write_text("", encoding="utf-8")
    store.base_level_target_projection.write_text("", encoding="utf-8")
    store.base_level_target_index.write_text("", encoding="utf-8")
    paf_line = (
        "NC_006088.5\t197608386\t100\t1000\t+\tchr1\t196449156\t200\t1100\t"
        "850\t900\t60\tcs:Z::900"
    )

    def native_extract(**_kwargs):
        return [paf_line], None, "native-tabix"

    def wsl_extract(**_kwargs):
        raise AssertionError("WSL tabix should not run when native extraction succeeds")

    monkeypatch.setattr(store, "_extract_tabix_lines_native", native_extract)
    monkeypatch.setattr(store, "_extract_tabix_lines_wsl", wsl_extract)

    result = store.get_base_level_records(chr_name="1", start=0, end=2000)

    assert result["status"] == "available"
    assert result["extraction"] == "native-tabix"
    assert result["records"][0]["has_cs"] is True


def test_citation_text_includes_versions_filters_and_secondary_policy(tmp_path: Path):
    _write_static_figure_fixture(tmp_path)
    provenance_path = tmp_path / "synteny" / "natural" / "grcg6a_vs_grcg7b.natural.asm5.provenance.json"
    provenance_path.write_text(
        json.dumps(
            {
                "tool": "minimap2",
                "preset": "asm5",
                "tool_versions": {"minimap2": "2.26-r1175", "seqkit": "2.8.2"},
                "secondary_alignments": "disabled",
                "default_display_filters": {
                    "mapping_quality_min": 30,
                    "identity_min_percent": 85,
                    "alignment_length_min_bp": 50000,
                },
                "generated_at": "2026-06-19T00:00:00+08:00",
            }
        ),
        encoding="utf-8",
    )
    store = GoldStandardComparativeStore(tmp_path)

    citation = store.get_citation_text()

    assert citation["status"] == "available"
    assert "minimap2 2.26-r1175" in citation["methods_text"]
    assert "asm5" in citation["methods_text"]
    assert "mapQ >= 30" in citation["methods_text"]
    assert "identity >= 85%" in citation["methods_text"]
    assert "secondary alignments disabled" in citation["methods_text"]


def test_sv_candidates_are_reported_as_candidates_not_validated_calls(tmp_path: Path):
    natural_dir = tmp_path / "synteny" / "natural"
    natural_dir.mkdir(parents=True)
    natural_dir.joinpath("grcg6a_vs_grcg7b.natural.asm5.paf").write_text(
        "\n".join(
            [
                "NC_006088.5\t20000000\t1000\t101000\t+\tchr1\t20000000\t2000\t102000\t99000\t100000\t60",
                "NC_006088.5\t20000000\t151000\t251000\t-\tchr1\t20000000\t152000\t252000\t98000\t100000\t60",
                "NC_006088.5\t20000000\t260000\t261000\t-\tchr1\t20000000\t262000\t263000\t990\t1000\t60",
                "NC_006088.5\t20000000\t270000\t370000\t-\tchr1\t20000000\t272000\t372000\t98000\t100000\t20",
                "NC_006088.5\t20000000\t401000\t501000\t+\tchr1\t20000000\t702000\t802000\t97000\t100000\t60",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    store = GoldStandardComparativeStore(tmp_path)

    result = store.get_sv_candidates(min_gap_bp=100000)

    assert result["status"] == "available"
    assert result["classification"] == "candidate-only"
    assert result["counts"]["inversion_orientation"] == 1
    assert result["counts"]["large_gap"] >= 1
    assert all(candidate["evidence_level"] == "candidate" for candidate in result["candidates"])


def _write_static_figure_fixture(root: Path) -> None:
    natural_dir = root / "synteny" / "natural"
    natural_dir.mkdir(parents=True)
    natural_dir.joinpath("grcg6a_vs_grcg7b.natural.asm5.paf").write_text(
        "\n".join(
            [
                "NC_006088.5\t197608386\t1000\t101000\t+\tNC_052532.1\t196449156\t2000\t102000\t95000\t100000\t60",
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
                "GENEBLOCK_00002\t1\t5000\t8000\t1\t5500\t8500\t-\t2\t97.5\t89.5\tBLASTP_RBH_CHAINING",
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
                "GENEPAIR_000003\tGENEBLOCK_00002\tGRCg6a_G000003\tGRCg7b_G000003\tC\tC\tP5\tP6\t1\t5000\t6000\t+\t1\t5500\t6500\t-\t-\t97.0\t100\t1e-8\t110\t89\tBLASTP_RBH",
                "GENEPAIR_000004\tGENEBLOCK_00002\tGRCg6a_G000004\tGRCg7b_G000004\tD\tD\tP7\tP8\t1\t7000\t8000\t-\t1\t7500\t8500\t+\t-\t98.0\t100\t1e-7\t115\t90\tBLASTP_RBH",
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def _append_dense_micro_synteny_block(root: Path, count: int = 72) -> None:
    gene_root = root / "comparative" / "pairwise" / "GRCg6a__GRCg7b" / "gene_collinearity"
    block_id = "GENEBLOCK_DENSE"
    with gene_root.joinpath("blocks.tsv").open("a", encoding="utf-8") as handle:
        handle.write(
            f"{block_id}\t1\t10000\t{10000 + count * 100}\t1\t11000\t{11000 + count * 100}\t+\t{count}\t98.5\t90.5\tBLASTP_RBH_CHAINING\n"
        )
    with gene_root.joinpath("gene_pairs.tsv").open("a", encoding="utf-8") as handle:
        for index in range(count):
            q_start = 10000 + index * 100
            q_end = q_start + 80
            t_start = 11000 + index * 100
            t_end = t_start + 80
            symbol = f"LOC{index:05d}"
            strand = "-" if index % 11 == 0 else "+"
            handle.write(
                "\t".join(
                    [
                        f"GENEPAIR_DENSE_{index:05d}",
                        block_id,
                        f"GRCg6a_DENSE_{index:05d}",
                        f"GRCg7b_DENSE_{index:05d}",
                        symbol,
                        symbol,
                        f"PX{index}",
                        f"PY{index}",
                        "1",
                        str(q_start),
                        str(q_end),
                        strand,
                        "1",
                        str(t_start),
                        str(t_end),
                        strand,
                        "+",
                        "98.0",
                        "100",
                        "1e-9",
                        "120",
                        "91",
                        "BLASTP_RBH",
                    ]
                )
                + "\n"
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


def test_micro_synteny_svg_changes_with_selected_block(tmp_path: Path):
    _write_static_figure_fixture(tmp_path)
    store = GoldStandardComparativeStore(tmp_path)

    delayed_block_pairs = store._read_gene_pairs(block_id="GENEBLOCK_00002", limit=1)
    block_1_svg = store.render_static_figure_svg(
        "micro-synteny",
        settings={"selectedBlockId": "GENEBLOCK_00001"},
    )
    block_2_svg = store.render_static_figure_svg(
        "micro-synteny",
        settings={"selectedBlockId": "GENEBLOCK_00002"},
    )

    assert [row["gene_symbol_1"] for row in delayed_block_pairs] == ["C"]
    assert "Block: GENEBLOCK_00001" in block_1_svg
    assert "Block: GENEBLOCK_00002" in block_2_svg
    assert ">A<" in block_1_svg
    assert ">C<" in block_2_svg
    assert block_1_svg != block_2_svg


def test_micro_synteny_dense_block_renders_all_anchors_without_static_label_clutter(tmp_path: Path):
    _write_static_figure_fixture(tmp_path)
    _append_dense_micro_synteny_block(tmp_path, count=72)
    store = GoldStandardComparativeStore(tmp_path)

    svg = store.render_static_figure_svg("micro-synteny", block_id="GENEBLOCK_DENSE")
    labels = re.findall(r'<text x="([0-9.]+)" y="([0-9.]+)" text-anchor="middle" class="gene-label[^"]*">([^<]+)</text>', svg)

    assert "anchors rendered: 72/72" in svg
    assert "label mode: overview-landmark" in svg
    assert 0 < len(labels) <= 15
    assert svg.count('class="anchor-link link"') == 72
    assert "GENEPAIR_DENSE_00000" in svg
    assert "GRCg6a_DENSE_00000" in svg
    assert "GRCg7b_DENSE_00000" in svg
    assert "pident=98.0" in svg
    assert "qcovs=91" in svg
    assert "GRCg6a 1:10000-10080 (-)" in svg
    assert "GRCg7b 1:11000-11080 (-)" in svg

    by_lane: dict[str, list[tuple[float, str]]] = {}
    for x_value, y_value, label in labels:
        by_lane.setdefault(y_value, []).append((float(x_value), label))
    for lane_labels in by_lane.values():
        ordered = sorted(lane_labels)
        for (left_x, left_label), (right_x, _right_label) in zip(ordered, ordered[1:]):
            min_gap = len(left_label) * 6 + 6
            assert right_x - left_x >= min_gap


def test_micro_synteny_compact_labels_are_assigned_to_non_overlapping_lanes(tmp_path: Path):
    _write_static_figure_fixture(tmp_path)
    _append_dense_micro_synteny_block(tmp_path, count=24)
    store = GoldStandardComparativeStore(tmp_path)

    svg = store.render_static_figure_svg(
        "micro-synteny",
        block_id="GENEBLOCK_DENSE",
        settings={"width": 1200, "height": 720},
    )
    labels = re.findall(r'<text x="([0-9.]+)" y="([0-9.]+)" text-anchor="middle" class="gene-label[^"]*">([^<]+)</text>', svg)

    assert "label mode: compact" in svg
    assert 0 < len(labels) < 24
    by_lane: dict[str, list[tuple[float, str]]] = {}
    for x_value, y_value, label in labels:
        by_lane.setdefault(y_value, []).append((float(x_value), label))
    for lane_labels in by_lane.values():
        ordered = sorted(lane_labels)
        for (left_x, left_label), (right_x, _right_label) in zip(ordered, ordered[1:]):
            min_gap = len(left_label) * 6 + 6
            assert right_x - left_x >= min_gap


def test_micro_synteny_block_details_return_summary_and_pairs(tmp_path: Path):
    _write_static_figure_fixture(tmp_path)
    _append_dense_micro_synteny_block(tmp_path, count=72)
    store = GoldStandardComparativeStore(tmp_path)

    details = store.get_micro_synteny_block_details("GENEBLOCK_DENSE")

    assert details["status"] == "available"
    assert details["block"]["block_id"] == "GENEBLOCK_DENSE"
    assert details["summary"]["anchor_count"] == 72
    assert details["summary"]["query_interval"] == "1:10000-17180"
    assert details["summary"]["target_interval"] == "1:11000-18180"
    assert details["summary"]["method"] == "BLASTP_RBH_CHAINING"
    assert details["pair_count"] == 72
    assert details["pairs"][0]["gene_1"] == "GRCg6a_DENSE_00000"
    assert details["pairs"][0]["gene_2"] == "GRCg7b_DENSE_00000"


def test_gene_collinearity_can_return_all_blocks_without_large_pair_payload(tmp_path: Path):
    _write_static_figure_fixture(tmp_path)
    store = GoldStandardComparativeStore(tmp_path)

    result = store.get_gene_collinearity(limit=1, block_limit=10)

    assert result["pair_count"] == 1
    assert result["block_count"] == 2
    assert [row["block_id"] for row in result["blocks"]] == ["GENEBLOCK_00001", "GENEBLOCK_00002"]


def test_comparative_service_forwards_gene_block_limit():
    from backend.comparative_service import ComparativeService

    class FakeGoldStore:
        def __init__(self):
            self.kwargs = None

        def get_gene_collinearity(self, **kwargs):
            self.kwargs = kwargs
            return {"ok": True}

    service = ComparativeService.__new__(ComparativeService)
    service.gold_store = FakeGoldStore()

    result = service.get_gene_collinearity(chr_name="1", limit=100, block_limit=5000)

    assert result == {"ok": True}
    assert service.gold_store.kwargs == {
        "chr_name": "1",
        "limit": 100,
        "block_limit": 5000,
    }


def test_comparative_service_alignment_block_result_reports_truncation(tmp_path: Path):
    from backend.comparative_service import ComparativeService

    paf = tmp_path / "natural.paf"
    paf.write_text(
        "\n".join(
            [
                "NC_006088.5\t197608386\t1000\t101000\t+\tchr1\t196449156\t2000\t102000\t95000\t100000\t60",
                "NC_006088.5\t197608386\t201000\t301000\t+\tchr1\t196449156\t202000\t302000\t95000\t100000\t60",
                "NC_006088.5\t197608386\t401000\t501000\t+\tchr1\t196449156\t402000\t502000\t95000\t100000\t60",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    service = ComparativeService.__new__(ComparativeService)
    service.get_alignment_paf_path = lambda _mode="natural": paf

    result = service.get_alignment_block_result(
        min_quality=0,
        min_identity=0,
        min_alignment_length=0,
        limit=2,
    )

    assert result["returned_count"] == 2
    assert result["total_count"] == 3
    assert result["truncated"] is True


def test_comparative_service_forwards_citation_and_sv_candidates():
    from backend.comparative_service import ComparativeService

    class FakeGoldStore:
        def __init__(self):
            self.min_gap_bp = None

        def get_citation_text(self):
            return {"status": "available"}

        def get_sv_candidates(self, *, min_gap_bp: int = 100_000):
            self.min_gap_bp = min_gap_bp
            return {"status": "available", "min_gap_bp": min_gap_bp}

    fake = FakeGoldStore()
    service = ComparativeService.__new__(ComparativeService)
    service.gold_store = fake

    assert service.get_citation_text() == {"status": "available"}
    assert service.get_sv_candidates(min_gap_bp=250000) == {"status": "available", "min_gap_bp": 250000}
    assert fake.min_gap_bp == 250000


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


def test_dna_static_figure_uses_gold_standard_display_filters(tmp_path: Path):
    _write_static_figure_fixture(tmp_path)
    store = GoldStandardComparativeStore(tmp_path)

    svg = store.render_static_figure_svg("dna-dotplot")

    assert "Blocks: 1;" in svg
    assert "10000" not in svg


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
        test_dna_static_figure_uses_gold_standard_display_filters(Path(tmp))
    with tempfile.TemporaryDirectory() as tmp:
        test_static_figure_svg_settings_are_clamped_and_block_ids_are_safe(Path(tmp))
    with tempfile.TemporaryDirectory() as tmp:
        test_gene_collinearity_file_endpoint_paths_are_safe_and_normalized(Path(tmp))
    print("All comparative PAF tests passed.")
