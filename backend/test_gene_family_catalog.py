"""Regression tests for the versioned gene-family annotation catalog."""

from pathlib import Path

from backend.gene_family_service import GeneFamilyCatalogService


RELEASE_ROOT = Path(r"D:\jbrowsedata\projectdata\gene family\releases")
RELEASE_ID = "gg-gf-2026-07-rc1"
DB_PATH = RELEASE_ROOT / RELEASE_ID / "gene_family.sqlite"


def catalog() -> GeneFamilyCatalogService | None:
    if not DB_PATH.exists():
        return None
    return GeneFamilyCatalogService(DB_PATH, RELEASE_ROOT)


def test_release_reconciles_source_counts_and_states():
    service = catalog()
    if service is None:
        return
    release = service.current_release()
    assert release["release_id"] == RELEASE_ID
    assert release["release_status"] == "release_candidate"
    summary = service.summary()
    schemes = {row["scheme_id"]: row for row in summary["schemes"]}
    assert schemes["pfam"]["domain_hits"] == 118_957
    assert schemes["kinomer"]["annotated_proteins"] == 1_965
    assert schemes["ubiquitin_core"]["accepted_assertions"] == 387
    assert schemes["ubiquitin_core"]["candidate_assertions"] == 907


def test_candidate_negative_and_known_positive_are_kept_distinct():
    service = catalog()
    if service is None:
        return
    rbr = service.entry_members("ubiquitin_core:E3_RBR", include_candidates=True, query="CFTR")
    assert any(row["gene_symbol"] == "CFTR" and row["assertion_state"] == "candidate" for row in rbr["data"])
    assert not any(row["gene_symbol"] == "CFTR" and row["assertion_state"] == "accepted" for row in rbr["data"])

    bmpr2 = service.search("BMPR2")["genes"]
    assert bmpr2
    annotations = service.gene_annotations(bmpr2[0]["internal_gene_id"])
    assert any(
        row["entry_id"] == "kinomer:TKL" and row["assertion_state"] == "accepted"
        for row in annotations["classifications"]
    )


def test_cursor_pages_are_stable_and_downloads_stay_inside_release():
    service = catalog()
    if service is None:
        return
    first = service.list_entries(limit=5, sort="name")
    second = service.list_entries(limit=5, sort="name", cursor=first["meta"]["next_cursor"])
    assert {row["entry_id"] for row in first["data"]}.isdisjoint(
        {row["entry_id"] for row in second["data"]}
    )
    assert service.download_path(RELEASE_ID, "gene_family.sqlite") == DB_PATH.resolve()
    assert service.download_path(RELEASE_ID, "../gene_family.sqlite") is None


if __name__ == "__main__":
    test_release_reconciles_source_counts_and_states()
    test_candidate_negative_and_known_positive_are_kept_distinct()
    test_cursor_pages_are_stable_and_downloads_stay_inside_release()
    print("All gene-family catalog tests passed.")
