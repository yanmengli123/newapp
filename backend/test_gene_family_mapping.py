"""Unit tests for stable-ID-first gene mapping."""

from backend.gene_family_builder import resolve_gene_mapping_precedence


def resolve(*, ncbi=None, ensembl=None, symbol=None):
    return resolve_gene_mapping_precedence(
        ncbi_supplied=ncbi is not None,
        ensembl_supplied=ensembl is not None,
        symbol_supplied=symbol is not None,
        ncbi_candidates=set(ncbi or ()),
        ensembl_candidates=set(ensembl or ()),
        symbol_candidates=set(symbol or ()),
    )


def test_exact_ncbi_gene_is_not_made_ambiguous_by_non_unique_symbol():
    result = resolve(ncbi={"gene-KCTD12-A"}, symbol={"gene-KCTD12-A", "gene-KCTD12-B"})
    assert result.state == "exact"
    assert result.internal_gene_id == "gene-KCTD12-A"
    assert result.method == "ncbigene"


def test_conflicting_stable_identifiers_remain_ambiguous():
    result = resolve(ncbi={"gene-A"}, ensembl={"gene-B"}, symbol={"gene-A"})
    assert result.state == "ambiguous"
    assert result.internal_gene_id is None
    assert result.candidates == ("gene-A", "gene-B")


def test_unknown_supplied_stable_id_is_not_silently_rescued_by_symbol():
    result = resolve(ncbi=set(), symbol={"gene-A"})
    assert result.state == "unmapped"
    assert result.internal_gene_id is None


def test_symbol_is_a_fallback_only_when_no_stable_identifier_is_supplied():
    result = resolve(symbol={"gene-A"})
    assert result.state == "exact"
    assert result.internal_gene_id == "gene-A"
    assert result.method == "gene_symbol"
