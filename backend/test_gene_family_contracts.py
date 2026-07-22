"""Tests for the RC2-A machine-readable scientific contracts."""

from __future__ import annotations

import json
import shutil
import sqlite3
from pathlib import Path

import pytest

from backend.gene_family_contracts import (
    EXPECTED_CONTRACT_FILES,
    RC1_SQLITE_SHA256,
    project_paths,
    sha256_file,
    stable_contract_key,
    validate_contracts,
)


CONTRACT_ROOT, DOCS_ROOT, RC1_DB = project_paths()
RC2_SCHEMA = Path(__file__).resolve().parent / "db" / "gene_family_schema_rc2_draft.sql"


def test_rc2_contract_package_validates_against_read_only_rc1():
    before = sha256_file(RC1_DB) if RC1_DB.exists() else None
    report = validate_contracts(CONTRACT_ROOT, docs_root=DOCS_ROOT, rc1_db=RC1_DB)
    after = sha256_file(RC1_DB) if RC1_DB.exists() else None

    assert report.ok, report.errors
    assert before == after
    if before is not None:
        assert before == RC1_SQLITE_SHA256
        assert "rc1_sqlite_checksum_unchanged" in report.checks
        assert "rc1_scientific_baseline_reconciled" in report.checks


def test_stable_key_vectors_are_reproducible_and_release_independent():
    data = json.loads((CONTRACT_ROOT / "assertion-key-v1.json").read_text(encoding="utf-8"))
    vector = next(row for row in data["test_vectors"] if "payload" in row)
    payload = dict(vector["payload"])
    assert "release_id" not in payload
    assert stable_contract_key(payload, data["assertion_key"]["prefix"]) == vector["expected"]


def test_multi_valued_schemes_never_receive_a_universal_assignment_slot():
    data = json.loads((CONTRACT_ROOT / "assertion-key-v1.json").read_text(encoding="utf-8"))
    for scheme in data["scheme_cardinality"].values():
        if scheme["cardinality"] == "multi_per_role":
            assert scheme["classification_axis"] is None
    assert data["scheme_cardinality"]["pfam"]["cardinality"] == "multi_per_role"


def test_metric_hash_tampering_fails_validation(tmp_path: Path):
    copied = tmp_path / "contracts"
    shutil.copytree(CONTRACT_ROOT, copied)
    registry_path = copied / "metric-registry-v1.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    registry["metrics"][0]["description"] = "silently changed definition"
    registry_path.write_text(json.dumps(registry, ensure_ascii=False), encoding="utf-8")

    report = validate_contracts(copied)
    assert not report.ok
    assert any("definition hash mismatch" in error for error in report.errors)


def test_contract_set_is_exact_and_contains_no_pending_hashes():
    actual = {path.name for path in CONTRACT_ROOT.glob("*.json")}
    assert actual == set(EXPECTED_CONTRACT_FILES)
    for path in CONTRACT_ROOT.glob("*.json"):
        assert "PENDING" not in path.read_text(encoding="utf-8")


def test_rc2_schema_draft_is_valid_and_enforces_cardinality_and_append_only_review():
    connection = sqlite3.connect(":memory:")
    connection.executescript(RC2_SCHEMA.read_text(encoding="utf-8"))
    digest = "0" * 64
    connection.execute(
        """
        INSERT INTO gf_release (
            release_id, schema_version, scientific_contract_version,
            release_status, qc_status, taxon_id, species_name,
            assembly_accession, assembly_name, created_at
        ) VALUES ('test-rc2', '2.0.0-rc2', 'gg-gf-contract-1.0',
                  'internal_review', 'pending', 9031, 'Gallus gallus',
                  'GCF_000002315.6', 'GRCg6a', '2026-07-22T00:00:00Z')
        """
    )
    connection.executemany(
        """
        INSERT INTO gf_scheme (
            scheme_id, scheme_stable_id, scheme_name, source_name,
            subject_level, assignment_cardinality, classification_axis, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            ("pfam", "pfam", "Pfam", "Pfam-HMMER", "protein", "multi_per_role", None, "test"),
            ("kinomer", "kinomer", "Kinomer", "Kinomer", "protein", "single_per_role", "kinomer_group", "test"),
        ],
    )
    connection.executemany(
        """
        INSERT INTO gf_entry (
            entry_id, entry_stable_id, scheme_id, accession, name,
            entry_type, entry_status, metadata_hash
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
        """,
        [
            ("pfam:PF00001", "pfam:PF00001", "pfam", "PF00001", "7tm_1", "domain", digest),
            ("kinomer:CMGC", "kinomer-group:CMGC", "kinomer", "CMGC", "CMGC", "group", digest),
        ],
    )
    connection.execute(
        """
        INSERT INTO gf_subject (
            release_id, subject_type, source_subject_namespace,
            source_subject_identifier, original_source_identifier,
            normalization_algorithm, mapping_state
        ) VALUES ('test-rc2', 'protein', 'refseq_protein',
                  'XP_015140123.2', 'XP_015140123.2',
                  'gf-subject-normalization-v1', 'unmapped')
        """
    )
    connection.execute(
        "INSERT INTO gf_reason_code VALUES ('external_curated_classification', '1.0', 'source', '[\"accepted\"]', NULL)"
    )

    assertion_sql = """
        INSERT INTO gf_assertion (
            assertion_version_id, release_id, assertion_key, assertion_key_algorithm,
            assignment_slot_key, scheme_id, entry_id, subject_pk, assignment_role,
            assertion_state, decision_basis_type, reason_code, review_state,
            evidence_bundle_hash, created_at
        ) VALUES (?, 'test-rc2', ?, 'gf-assertion-key-v1', ?, ?, ?, 1,
                  'primary', ?, 'external_curated_source',
                  'external_curated_classification', 'unreviewed', ?, '2026-07-22T00:00:00Z')
    """
    with pytest.raises(sqlite3.IntegrityError, match="multi_per_role"):
        connection.execute(
            assertion_sql,
            ("bad-pfam", "bad-pfam", "universal-slot", "pfam", "pfam:PF00001", "accepted", digest),
        )
    connection.execute(
        assertion_sql,
        ("valid-pfam", "valid-pfam", None, "pfam", "pfam:PF00001", "accepted", digest),
    )
    with pytest.raises(sqlite3.IntegrityError, match="single_per_role"):
        connection.execute(
            assertion_sql,
            ("bad-kinomer", "bad-kinomer", None, "kinomer", "kinomer:CMGC", "accepted", digest),
        )
    connection.execute(
        assertion_sql,
        ("valid-kinomer", "valid-kinomer", "kinomer-slot", "kinomer", "kinomer:CMGC", "accepted", digest),
    )
    with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint"):
        connection.execute(
            assertion_sql,
            ("bad-state", "bad-state", "kinomer-slot-2", "kinomer", "kinomer:CMGC", "unresolved", digest),
        )

    connection.execute(
        """
        INSERT INTO gf_review_event (
            review_event_id, release_id, assertion_key, base_assertion_version_id,
            base_assertion_hash, new_review_state, review_decision, reviewer,
            reviewed_at, reason_code
        ) VALUES ('review-1', 'test-rc2', 'valid-kinomer', 'valid-kinomer', ?,
                  'resolved', 'approve', 'test-reviewer', '2026-07-22T00:00:00Z',
                  'external_curated_classification')
        """,
        (digest,),
    )
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        connection.execute("UPDATE gf_review_event SET comment='mutated' WHERE review_event_id='review-1'")

    assert connection.execute("PRAGMA user_version").fetchone()[0] == 2
    assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    connection.close()
