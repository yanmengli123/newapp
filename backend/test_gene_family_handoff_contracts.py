"""Tests for the RC2-B.1 scientific handoff gate and batch builder."""

from __future__ import annotations

import gzip
import json
import shutil
import sqlite3
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from backend.gene_family_curation_batch import build_curation_batch
from backend.gene_family_handoff_contracts import (
    AGGREGATE_COMPONENT_TYPES,
    canonical_json_sha256,
    sha256_file,
    validate_approval_aggregate,
    validate_handoff_contracts,
)


ROOT = Path(__file__).resolve().parent.parent
HANDOFF = ROOT / "contracts" / "gene-family" / "rc2b1"
RC2 = ROOT / "contracts" / "gene-family" / "rc2"


def _load(name: str):
    return json.loads((HANDOFF / name).read_text(encoding="utf-8"))


def test_repository_handoff_contracts_validate():
    report = validate_handoff_contracts(HANDOFF, RC2)
    assert report.ok, report.errors
    assert "required_attestation_artifact_types_complete" in report.checks
    assert "legacy_hit_is_fact_not_operator_verified" in report.checks
    assert "shadow_runner_io_boundary_verified" in report.checks


def test_all_handoff_schemas_are_draft_2020_12_and_instances_validate():
    schemas = sorted(HANDOFF.glob("*.schema.json"))
    assert len(schemas) == 6
    for path in schemas:
        Draft202012Validator.check_schema(json.loads(path.read_text(encoding="utf-8")))
    profile_schema = _load("shadow-scope-profile.schema.json")
    validator = Draft202012Validator(profile_schema)
    validator.validate(_load("shadow-scope-targeted-rescanned-v1.json"))
    validator.validate(_load("shadow-scope-legacy-restricted-v1.json"))


def test_manifest_hash_drift_is_rejected(tmp_path: Path):
    copied = tmp_path / "handoff"
    shutil.copytree(HANDOFF, copied)
    profile = copied / "shadow-scope-legacy-restricted-v1.json"
    profile.write_text(profile.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    report = validate_handoff_contracts(copied, RC2)
    assert not report.ok
    assert any("checksum mismatch" in error for error in report.errors)


def test_legacy_profile_cannot_enable_absence_or_use_fake_numeric_gate_value():
    schema = _load("shadow-scope-profile.schema.json")
    profile = _load("shadow-scope-legacy-restricted-v1.json")
    profile["predicate_capabilities"]["domain_absence"] = True
    errors = list(Draft202012Validator(schema).iter_errors(profile))
    assert errors
    profile = _load("shadow-scope-legacy-restricted-v1.json")
    profile["profile_gate_overrides"][0]["observed_value"] = "not_required_by_profile"
    errors = list(Draft202012Validator(schema).iter_errors(profile))
    assert errors


def test_targeted_gene_absence_requires_complete_isoform_universe():
    schema = _load("shadow-scope-profile.schema.json")
    profile = _load("shadow-scope-targeted-rescanned-v1.json")
    profile["subject_scope"]["gene_level_absence_enabled"] = True
    errors = list(Draft202012Validator(schema).iter_errors(profile))
    assert errors


def test_batch_schema_rejects_absolute_artifact_paths():
    schema = _load("curation-batch-manifest.schema.json")
    digest = "0" * 64
    sample = {
        "schema_version": "1.0", "batch_id": "gg-gf-ubiquitin-curation-rc2-batch-001",
        "scheme_id": "ubiquitin_core", "purpose": "test",
        "contract_version": "gg-gf-contract-1.0",
        "contract_tag": "gene-family-rc2a-contract-v1.0",
        "evaluator_tag": "gene-family-rc2b-evaluator-core-v1.0",
        "packet_manifest_sha256": digest,
        "handoff_contract_manifest_sha256": digest,
        "input_artifacts": [{"artifact_type": "packet", "relative_path": "C:/packet.json",
                             "sha256": digest, "required": True, "status": "observed"}],
        "expected_decision_artifacts": [{"artifact_type": "rule_bundle",
                                         "relative_path": "decisions/rules.json",
                                         "required": True, "status": "missing"}],
        "created_by": {"name": "test", "role": "engineering_preparer"},
        "created_at": "2026-07-22T00:00:00Z", "status": "draft",
        "supersedes_batch_id": None, "scientific_approval_implied": False,
        "scientific_shadow_authorized": False, "rc2c_build_authorized": False,
        "limitations": [],
    }
    assert list(Draft202012Validator(schema).iter_errors(sample))


def test_aggregate_requires_every_component_and_matching_approved_attestation():
    digest = "1" * 64
    artifacts = {kind: digest for kind in AGGREGATE_COMPONENT_TYPES}
    attestations = {}
    components = []
    for index, kind in enumerate(sorted(AGGREGATE_COMPONENT_TYPES)):
        attestation_id = f"attestation-{index}"
        attestation = {
            "attestation_id": attestation_id, "artifact_type": kind,
            "artifact_hash_algorithm": "gf-canonical-json-sha256-v1",
            "artifact_sha256": digest, "approval_scope": "approved_for_shadow_run",
            "decision": "approved", "curator": {"name": "Test", "identifier": "test",
            "identifier_scheme": "local", "role": "scientific_curator"},
            "approved_at": "2026-07-22T00:00:00Z", "limitations": [],
        }
        attestations[attestation_id] = attestation
        components.append({"artifact_type": kind, "artifact_sha256": digest,
                           "attestation_id": attestation_id,
                           "attestation_sha256": canonical_json_sha256(attestation)})
    aggregate = {"components": components}
    assert validate_approval_aggregate(aggregate, artifacts, attestations) == []
    aggregate["components"] = components[:-1]
    assert any("incomplete" in error for error in
               validate_approval_aggregate(aggregate, artifacts, attestations))


def _fake_batch_inputs(tmp_path: Path):
    rc1_manifest = tmp_path / "manifest.json"
    rc1_database = tmp_path / "gene_family.sqlite"
    rc1_manifest.write_text('{"release":"rc1"}\n', encoding="utf-8")
    rc1_database.write_bytes(b"not-opened-as-sqlite")

    projectdata = tmp_path / "projectdata"
    projectdata.mkdir()
    protein = projectdata / "GCF_000002315.6_GRCg6a_protein.faa.gz"
    with gzip.open(protein, "wt", encoding="utf-8") as handle:
        handle.write(">XP_1 test\nMAA\n")
    gff = projectdata / "GCF_000002315.6_GRCg6a_genomic.gff.gz"
    with gzip.open(gff, "wt", encoding="utf-8") as handle:
        handle.write("##gff-version 3\n#!genome-build GRCg6a\n")
        handle.write("#!genome-build-accession NCBI_Assembly:GCF_000002315.6\n")
        handle.write("#!annotation-source NCBI Gallus gallus Annotation Release 104\n")
        handle.write("NC_1\tRefSeq\tgene\t1\t3\t.\t+\t.\tID=gene-1\n")
    (projectdata / "GCF_000002315.6_GRCg6a_assembly_report.txt").write_text(
        "assembly GCF_000002315.6\n", encoding="utf-8")

    packet = tmp_path / "packet"
    packet.mkdir()
    (packet / "subject-universe.tsv").write_text("subject\n1\n", encoding="utf-8")
    packet_manifest = {
        "packet_id": "rc2b-curator-packet-v1.1",
        "status": "machine_generated_unapproved",
        "source_release_id": "gg-gf-2026-07-rc1",
        "source_manifest_sha256": sha256_file(rc1_manifest),
        "source_database_sha256": sha256_file(rc1_database),
        "scientific_shadow_authorized": False,
    }
    packet_manifest_path = packet / "packet-manifest.json"
    packet_manifest_path.write_text(json.dumps(packet_manifest), encoding="utf-8")
    checksum_rows = [packet_manifest_path, packet / "subject-universe.tsv"]
    (packet / "checksums.sha256").write_text(
        "".join(f"{sha256_file(path)}  {path.name}\n" for path in checksum_rows),
        encoding="utf-8",
    )
    return packet, rc1_manifest, rc1_database, projectdata


def test_batch_builder_is_create_only_and_keeps_science_unapproved(tmp_path: Path):
    packet, rc1_manifest, rc1_database, projectdata = _fake_batch_inputs(tmp_path)
    output = tmp_path / "batch-001"
    build_curation_batch(
        output=output, packet_root=packet, rc1_manifest=rc1_manifest,
        rc1_database=rc1_database, handoff_root=HANDOFF, rc2_contract_root=RC2,
        projectdata_root=projectdata, evaluator_commit="0" * 40,
        generator_commit="1" * 40, created_by="test-engineer",
        created_at="2026-07-22T00:00:00Z",
    )
    manifest = json.loads((output / "curation-batch-manifest.json").read_text(encoding="utf-8"))
    Draft202012Validator(_load("curation-batch-manifest.schema.json")).validate(manifest)
    assert manifest["status"] == "draft"
    assert manifest["scientific_shadow_authorized"] is False
    assert all(item["status"] == "missing" for item in manifest["expected_decision_artifacts"])
    inventory = (output / "targeted-rescan-input-inventory.tsv").read_text(encoding="utf-8")
    assert "declared_isoform_universe\t\tmissing" in inventory
    assert "C:\\" not in (output / "inputs-lock.json").read_text(encoding="utf-8")
    with pytest.raises(FileExistsError):
        build_curation_batch(
            output=output, packet_root=packet, rc1_manifest=rc1_manifest,
            rc1_database=rc1_database, handoff_root=HANDOFF, rc2_contract_root=RC2,
            projectdata_root=projectdata, evaluator_commit="0" * 40,
            generator_commit="1" * 40, created_by="test-engineer",
            created_at="2026-07-22T00:00:00Z",
        )


def test_rc2_draft_schema_enforces_closed_batch_and_artifact_append_only():
    schema = (ROOT / "backend" / "db" / "gene_family_schema_rc2_draft.sql").read_text(
        encoding="utf-8"
    )
    connection = sqlite3.connect(":memory:")
    connection.executescript(schema)
    digest = "0" * 64
    connection.execute(
        """
        INSERT INTO gf_scheme (
            scheme_id, scheme_stable_id, scheme_name, source_name, subject_level,
            assignment_cardinality, classification_axis, description
        ) VALUES ('ubiquitin_core', 'ubiquitin_core', 'Ubiquitin core', 'curated',
                  'gene', 'single_per_role', 'primary_class', 'test')
        """
    )
    connection.execute(
        """
        INSERT INTO gf_curation_batch (
            batch_id, scheme_id, purpose, contract_version, contract_tag,
            evaluator_tag, evaluator_commit, packet_manifest_sha256,
            handoff_contract_manifest_sha256, created_by, created_at, batch_status
        ) VALUES ('batch-001', 'ubiquitin_core', 'test', 'gg-gf-contract-1.0',
                  'gene-family-rc2a-contract-v1.0',
                  'gene-family-rc2b-evaluator-core-v1.0', ?, ?, ?, 'test',
                  '2026-07-22T00:00:00Z', 'draft')
        """,
        ("1" * 40, digest, digest),
    )
    connection.execute(
        """
        INSERT INTO gf_curation_batch_artifact (
            batch_artifact_id, batch_id, artifact_role, artifact_type,
            relative_path, artifact_hash_algorithm, artifact_sha256,
            artifact_status, recorded_at
        ) VALUES ('artifact-1', 'batch-001', 'input', 'packet',
                  'inputs/packet.json', 'gf-canonical-json-sha256-v1', ?,
                  'observed', '2026-07-22T00:00:00Z')
        """,
        (digest,),
    )
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        connection.execute(
            "UPDATE gf_curation_batch_artifact SET artifact_status='approved' WHERE batch_artifact_id='artifact-1'"
        )
    connection.execute("UPDATE gf_curation_batch SET batch_status='closed' WHERE batch_id='batch-001'")
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        connection.execute("UPDATE gf_curation_batch SET purpose='changed' WHERE batch_id='batch-001'")
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        connection.execute("DELETE FROM gf_curation_batch WHERE batch_id='batch-001'")
    connection.close()
