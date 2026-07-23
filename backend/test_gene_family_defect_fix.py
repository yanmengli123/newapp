"""Acceptance gates for the feature-frozen Gene Families v1.0.1 defect patch."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from backend.gene_family_openapi_contract import canonical_json, current_runtime_contract
from backend.gene_family_service import GeneFamilyCatalogService


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
BASELINE_PATH = REPOSITORY_ROOT / "contracts" / "gene-family" / "tab-v1.0.1" / "immutability-baseline.json"
OPENAPI_PATH = REPOSITORY_ROOT / "contracts" / "gene-family" / "api" / "openapi-current.json"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _baseline() -> dict:
    return json.loads(BASELINE_PATH.read_text(encoding="utf-8"))


def _service() -> GeneFamilyCatalogService:
    release = _baseline()["active_release"]
    database = Path(release["sqlite_path"])
    return GeneFamilyCatalogService(database, database.parents[1])


def _all_entry_evidence(service: GeneFamilyCatalogService, entry_id: str) -> list[dict]:
    rows: list[dict] = []
    cursor: str | None = None
    while True:
        page = service.entry_evidence(entry_id, cursor=cursor, limit=100)
        rows.extend(page["data"])
        cursor = page["meta"]["next_cursor"]
        if cursor is None:
            return rows


def test_rc1_and_frozen_p1_inputs_remain_byte_identical():
    baseline = _baseline()
    release = baseline["active_release"]
    assert _sha256(Path(release["sqlite_path"])) == release["sqlite_sha256"]
    assert _sha256(Path(release["checksums_path"])) == release["checksums_sha256"]
    assert _sha256(Path(release["source_inventory_path"])) == release["source_inventory_sha256"]

    checksum_root = Path(release["checksums_path"]).parent
    checksum_rows = Path(release["checksums_path"]).read_text(encoding="utf-8").splitlines()
    assert len(checksum_rows) == release["verified_release_checksums"]
    for row in checksum_rows:
        expected, relative_path = row.split("  ", 1)
        assert _sha256(checksum_root / relative_path) == expected

    manifest = json.loads((checksum_root / "manifest.json").read_text(encoding="utf-8"))
    source_root = Path(manifest["source_directory"])
    assert len(manifest["source_files"]) == release["verified_source_files"]
    for source in manifest["source_files"]:
        source_path = source_root / source["relative_path"]
        assert source_path.is_file()
        assert _sha256(source_path) == source["sha256"]

    frozen = baseline["frozen_rc2_inputs"]
    assert _sha256(Path(frozen["p0_target_manifest_path"])) == frozen["p0_target_manifest_sha256"]
    assert _sha256(Path(frozen["pilot_acceptance_path"])) == frozen["pilot_acceptance_sha256"]
    assert _sha256(Path(frozen["full_scan_authorization_path"])) == frozen["full_scan_authorization_sha256"]
    authorization = json.loads(Path(frozen["full_scan_authorization_path"]).read_text(encoding="utf-8"))
    for field in (
        "full_scan_authorized",
        "formal_shadow_authorized",
        "rc2c_build_authorized",
        "api_frontend_switch_authorized",
    ):
        assert authorization[field] is False


def test_pfam_pf00069_uses_true_lengths_and_explicit_unknowns():
    rows = _all_entry_evidence(_service(), "pfam:PF00069")
    proteins = {row["protein_accession"]: row for row in rows}
    assert len(rows) == 1697
    assert len(proteins) == 1697

    observed = [row for row in proteins.values() if row["protein_length_status"] == "observed"]
    missing = [row for row in proteins.values() if row["protein_length_status"] == "not_reported"]
    assert len(observed) == 1693
    assert len(missing) == 4
    assert all(row["protein_length"] is not None for row in observed)
    assert all(row["protein_length"] is None for row in missing)
    assert all((row["ali_to"] or row["env_to"]) <= row["protein_length"] for row in observed)
    assert {row["protein_accession"] for row in missing} == {
        "NP_990026.1",
        "XP_025002218.1",
        "XP_025002248.1",
        "XP_025002249.1",
    }


def test_kctd12_source_assertions_are_additive_and_preserve_states():
    result = _service().search("KCTD12")
    assert result["genes"] == []
    assert len(result["source_assertions"]) == 2
    assert {row["ncbi_gene_id"] for row in result["source_assertions"]} == {"107051871", "425504"}
    for row in result["source_assertions"]:
        assert row["assertion_state"] == "accepted"
        assert row["mapping_state"] == "ambiguous"
        assert row["review_state"] == "needs_mapping"
        assert row["internal_gene_id"] is None
        assert row["entry_id"] == "ubiquitin_core:E3_CRL_adaptor"


def test_capabilities_describe_only_current_client_panels():
    service = _service()
    schemes = [row["scheme_id"] for row in service.summary()["schemes"]]
    assert len(schemes) == 6
    for scheme_id in schemes:
        entry_id = service.list_entries(
            scheme=scheme_id,
            include_candidates=True,
            sort="name",
            limit=1,
        )["data"][0]["entry_id"]
        capabilities = service.entry(entry_id)["available_sections"]
        assert capabilities["domain_architecture"] is (scheme_id == "pfam")
        assert capabilities["expression_profile"] is False
        assert capabilities["genomic_distribution"] is False
        assert capabilities["change_history"] is False


def test_runtime_and_repository_openapi_are_identical_and_complete():
    repository = json.loads(OPENAPI_PATH.read_text(encoding="utf-8"))
    runtime = current_runtime_contract()
    assert canonical_json(repository) == canonical_json(runtime)
    assert len(repository["paths"]) == 12
    assert "/api/v1/gene-family-catalog/releases/{release_id}/downloads" in repository["paths"]
    assert "/api/v1/gene-family-catalog/releases/{release_id}/downloads/{asset_name}" in repository["paths"]
    assert repository["components"]["schemas"]
