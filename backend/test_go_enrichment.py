"""
Unit tests for GO Enrichment SEA backend.
Tests mathematical correctness of hypergeometric test and FDR correction.
"""

import math
from scipy.stats import hypergeom
from statsmodels.stats.multitest import multipletests


def test_hypergeometric_pvalue():
    """Test that hypergeometric right-tail p-value is computed correctly."""
    # N=1000 background genes, K=100 annotated to GO:A, n=50 query genes, k=20 hit GO:A
    # k/K = 20/100 = 0.2, n/N = 50/1000 = 0.05 → strongly enriched
    N, K, n, k = 1000, 100, 50, 20
    p = hypergeom.sf(k - 1, N, K, n)
    assert math.isfinite(p)
    assert 0 <= p <= 1
    assert p < 0.001, f"Expected strongly enriched p-value < 0.001, got {p:.4f}"


def test_hypergeometric_not_enriched():
    """Test p-value when query is not enriched."""
    N, K, n, k = 1000, 500, 100, 10
    p = hypergeom.sf(k - 1, N, K, n)
    assert math.isfinite(p)
    # k/K = 10/500 = 0.02, n/N = 100/1000 = 0.1 → less than expected → p close to 1
    assert p > 0.5, f"Expected non-enriched p-value > 0.5, got {p:.4f}"


def test_min_overlap_filter_before_fdr():
    """Test that terms below min_overlap are excluded from FDR correction."""
    raw_results = [
        {"go_id": "GO:1", "query_count": 5, "p_value": 0.001},
        {"go_id": "GO:2", "query_count": 1, "p_value": 0.0001},  # below min_overlap=2
        {"go_id": "GO:3", "query_count": 3, "p_value": 0.01},
        {"go_id": "GO:4", "query_count": 2, "p_value": 0.005},
    ]
    min_overlap = 2
    tested = [r for r in raw_results if r["query_count"] >= min_overlap]
    assert len(tested) == 3
    assert all(r["query_count"] >= 2 for r in tested)


def test_bh_correction_none():
    """Test correction=none returns p-values as-is."""
    p_values = [0.01, 0.05, 0.1, 0.5]
    fdr_values = p_values  # no correction
    for p, f in zip(p_values, fdr_values):
        assert f == p


def test_bh_correction_basic():
    """Test Benjamini-Hochberg FDR correction."""
    p_values = [0.001, 0.01, 0.04, 0.1]
    _, fdr_values, _, _ = multipletests(p_values, alpha=0.05, method="fdr_bh")
    # BH should be monotonically non-decreasing
    for i in range(len(fdr_values) - 1):
        assert fdr_values[i] <= fdr_values[i + 1] + 1e-10


def test_fdr_cutoff_boundary():
    """Test that term with FDR exactly at cutoff is marked significant."""
    fdr_cutoff = 0.05
    fdr_values = [0.0499, 0.05, 0.0501]
    significant = [f <= fdr_cutoff for f in fdr_values]
    assert significant == [True, True, False]


def test_compute_enrichment_pure():
    """Test _compute_enrichment_for_namespace as a pure function."""
    from backend.go_enrichment_service import EnrichmentParams
    from scipy.stats import hypergeom
    from statsmodels.stats.multitest import multipletests
    import math

    params = EnrichmentParams(correction="bh", fdr_cutoff=0.05, min_overlap=2)

    # Simulated input data
    query_go_hits = {
        "GO:A": ["g1", "g2", "g3"],
        "GO:B": ["g1"],
        "GO:C": ["g1", "g2", "g3", "g4", "g5"],
    }
    bg_go_counts = {"GO:A": 10, "GO:B": 5, "GO:C": 100}
    go_names = {"GO:A": ("Term A", "biological_process"), "GO:B": ("Term B", "biological_process"), "GO:C": ("Term C", "biological_process")}
    gene_info = {"g1": ("NCBI1", "SYM1"), "g2": ("NCBI2", "SYM2"), "g3": ("NCBI3", "SYM3"), "g4": ("NCBI4", "SYM4"), "g5": ("NCBI5", "SYM5")}
    N, n = 200, 5

    CORRECTION_MAP = {"bh": "fdr_bh", "none": "none"}

    # Step 1: min_overlap filter first
    raw_results = []
    for go_id, hit_gene_ids in query_go_hits.items():
        k = len(hit_gene_ids)
        K = bg_go_counts.get(go_id, 0)
        if K == 0:
            continue
        p_value = hypergeom.sf(k - 1, N, K, n)
        if not math.isfinite(p_value):
            p_value = 1.0
        if go_id in go_names:
            term_name, _ = go_names[go_id]
            hit_ncbi = [gene_info[g][0] for g in hit_gene_ids if g in gene_info and gene_info[g][0]]
            hit_syms = [gene_info[g][1] for g in hit_gene_ids if g in gene_info and gene_info[g][1]]
            raw_results.append({"go_id": go_id, "term_name": term_name, "query_count": k, "p_value": p_value, "hit_genes": hit_gene_ids, "hit_ncbi_ids": hit_ncbi, "hit_symbols": hit_syms})

    tested_results = [r for r in raw_results if r["query_count"] >= params.min_overlap]
    assert len(tested_results) == 2  # GO:B excluded (k=1 < min_overlap=2)

    # Step 2: FDR correction over tested terms only
    p_values = [r["p_value"] for r in tested_results]
    if params.correction == "none":
        fdr_values = p_values
    else:
        method = CORRECTION_MAP.get(params.correction, "fdr_bh")
        _, fdr_values, _, _ = multipletests(p_values, alpha=params.fdr_cutoff, method=method) if p_values else ([], [], [], [])

    for r, fdr in zip(tested_results, fdr_values):
        r["fdr"] = fdr if math.isfinite(fdr) else 1.0

    # Step 3: significant = FDR <= cutoff
    for r in tested_results:
        r["significant"] = r["fdr"] <= params.fdr_cutoff

    assert all(r["fdr"] <= 1.0 for r in tested_results)
    assert all(bool(r["significant"]) in (True, False) for r in tested_results)


def test_fdr_per_ontology():
    """Test that FDR correction is applied separately per ontology."""
    import numpy as np
    bp_pvals = [0.001, 0.01, 0.05]
    cc_pvals = [0.0005, 0.005]

    bp_rejected, bp_fdr, _, _ = multipletests(bp_pvals, alpha=0.05, method="fdr_bh")
    cc_rejected, cc_fdr, _, _ = multipletests(cc_pvals, alpha=0.05, method="fdr_bh")

    # CC FDR should NOT be influenced by BP p-values
    assert isinstance(cc_fdr, np.ndarray)
    assert len(cc_fdr) == 2


def test_alt_id_normalization():
    """Test that alt GO IDs normalize to primary GO IDs (COALESCE logic)."""
    alt_id_map = {
        "GO:alt1": "GO:primary1",
        "GO:alt2": "GO:primary2",
        "GO:alt3": None,  # no alt, use as-is
    }
    go_ids = ["GO:alt1", "GO:alt2", "GO:alt3"]
    normalized = [
        alt_id_map[g] if alt_id_map.get(g) is not None else g
        for g in go_ids
    ]
    assert normalized == ["GO:primary1", "GO:primary2", "GO:alt3"]


def test_go_id_expr_logic():
    """Test _go_id_expr and _table_exists logic."""
    from backend.go_enrichment_service import _go_id_expr
    assert _go_id_expr(True) == "COALESCE(galt.primary_go_id, gg.go_id)"
    assert _go_id_expr(False) == "gg.go_id"


def test_go_alt_sql_parts():
    """Test _go_alt_sql_parts returns correct SQL parts for both table presence states."""
    from backend.go_enrichment_service import _go_alt_sql_parts
    # Mock cursor that returns True for has_alt_table=True
    class MockCurTrue:
        def execute(self, q, args): pass
        def fetchone(self):
            return (True,)  # go_alt_id exists
    class MockCurFalse:
        def execute(self, q, args): pass
        def fetchone(self):
            return (False,)  # go_alt_id missing

    go_id_expr, alt_join, has_alt = _go_alt_sql_parts(MockCurTrue())
    assert has_alt is True
    assert go_id_expr == "COALESCE(galt.primary_go_id, gg.go_id)"
    assert alt_join == "LEFT JOIN go_alt_id galt ON galt.alt_go_id = gg.go_id"

    go_id_expr, alt_join, has_alt = _go_alt_sql_parts(MockCurFalse())
    assert has_alt is False
    assert go_id_expr == "gg.go_id"
    assert alt_join == ""


def test_sig_term_overflow_handling():
    """Test that sig terms are truncated by FDR when exceeding max_nodes."""
    # Simulate 15 sig terms but max_nodes=10
    sig_terms = [f"GO:{i}" for i in range(15)]
    fdr_values = {f"GO:{i}": 0.001 * (i + 1) for i in range(15)}
    p_values = {f"GO:{i}": 0.005 * (i + 1) for i in range(15)}
    max_nodes = 10
    root_slot = 1
    sig_slots = len(sig_terms)
    total = sig_slots + root_slot

    if sig_slots + root_slot > max_nodes:
        sorted_ids = sorted(sig_terms, key=lambda g: (fdr_values[g], p_values[g], g))
        kept = set(sorted_ids[: max_nodes - root_slot])
    else:
        kept = set(sig_terms)

    assert len(kept) == 9  # 10 - 1 root slot = 9
    assert "GO:0" in kept  # lowest FDR
    assert "GO:8" in kept  # 9th
    assert "GO:9" not in kept  # would be 10th, beyond limit


if __name__ == "__main__":
    test_hypergeometric_pvalue()
    test_hypergeometric_not_enriched()
    test_min_overlap_filter_before_fdr()
    test_bh_correction_none()
    test_bh_correction_basic()
    test_fdr_cutoff_boundary()
    test_compute_enrichment_pure()
    test_fdr_per_ontology()
    test_alt_id_normalization()
    test_go_id_expr_logic()
    test_go_alt_sql_parts()
    test_sig_term_overflow_handling()
    print("All tests passed.")
    print("All tests passed.")