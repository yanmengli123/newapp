"""Validate the RC2-B.1 scientific-handoff contract package.

This module is standard-library only. It validates governance interfaces and
never evaluates biological rules, runs HMMER or opens/writes a release DB.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping


SCHEMA_FILES = (
    "curation-batch-manifest.schema.json",
    "evidence-admissibility-policy.schema.json",
    "approval-attestation-v2.schema.json",
    "scientific-approval-aggregate.schema.json",
    "shadow-scope-profile.schema.json",
    "shadow-input-manifest.schema.json",
)
CONTRACT_FILES = (
    "artifact-hash-algorithms-v1.json",
    "shadow-scope-targeted-rescanned-v1.json",
    "shadow-scope-legacy-restricted-v1.json",
    "shadow-runner-io-contract-v1.json",
    "handoff-qc-gates-v1.json",
)
EXPECTED_FILES = SCHEMA_FILES + CONTRACT_FILES
MANIFEST_FILE = "handoff-contract-manifest-v1.json"
HASH_ALGORITHM = "gf-canonical-json-sha256-v1"
REQUIRED_APPROVAL_ARTIFACT_TYPES = {
    "evidence_admissibility", "domain_vocabulary", "rule_bundle",
    "mapping_decisions", "rollup_policy", "publication_policy",
    "regression_fixture_bundle", "shadow_scope_profile",
    "shadow_input_manifest", "scientific_approval_aggregate", "shadow_run",
    "rc2c_build", "release",
}
AGGREGATE_COMPONENT_TYPES = {
    "evidence_admissibility", "domain_vocabulary", "rule_bundle",
    "mapping_decisions", "rollup_policy", "publication_policy",
    "regression_fixture_bundle", "shadow_scope_profile",
    "shadow_input_manifest",
}
FROZEN_RULE_OPERATORS_FOR_LEGACY_FACT = {"contains", "exists", "eq"}
REQUIRED_RUNNER_INPUTS = {
    "shadow-input-manifest.json", "inputs-lock.json", "subject-universe.tsv",
    "scan-run-manifest.json", "evidence-admissibility-policy.json",
    "domain-vocabulary.json", "rule-bundle.json", "mapping-decisions.tsv",
    "rollup-policy.json", "publication-policy.json", "fixture-bundle.json",
    "scientific-approval-aggregate.json", "shadow-run-authorization.json",
}
REQUIRED_RUNNER_OUTPUTS = {
    "shadow-manifest.json", "inputs-lock.json", "subject-universe.tsv",
    "rule-evaluations.tsv", "rule-node-traces.tsv",
    "trace-evidence-links.tsv", "protein-outcomes.tsv",
    "gene-rollup-proposals.tsv", "publication-proposals.tsv", "metrics.json",
    "diff-vs-rc1.json", "gate-results.json", "rejected-records.tsv",
    "limitations.json", "provenance.jsonld", "checksums.sha256",
}


@dataclass
class HandoffContractReport:
    checks: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def check(self, name: str) -> None:
        self.checks.append(name)

    def error(self, message: str) -> None:
        self.errors.append(message)

    def as_dict(self) -> dict[str, Any]:
        return {"ok": self.ok, "check_count": len(self.checks),
                "error_count": len(self.errors), "checks": self.checks,
                "errors": self.errors}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_json(value: Any) -> str:
    """Implement the frozen legacy profile without claiming RFC 8785 JCS."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)


def canonical_json_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _load(path: Path, report: HandoffContractReport) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        report.error(f"cannot load {path.name}: {exc}")
        return None


def _validate_manifest(root: Path, report: HandoffContractReport) -> None:
    manifest = _load(root / MANIFEST_FILE, report)
    if not isinstance(manifest, dict):
        return
    if manifest.get("manifest_id") != "gg-gf-rc2b1-scientific-handoff-1.0":
        report.error("handoff manifest_id is invalid")
    if manifest.get("status") != "frozen_for_engineering":
        report.error("handoff manifest is not frozen_for_engineering")
    if manifest.get("scientific_shadow_authorized") is not False:
        report.error("handoff manifest must not authorize a scientific shadow")
    records = manifest.get("files")
    if not isinstance(records, list):
        report.error("handoff manifest files must be an array")
        return
    indexed: dict[str, str] = {}
    for record in records:
        if not isinstance(record, dict) or set(record) != {"path", "sha256"}:
            report.error("handoff manifest records require only path and sha256")
            continue
        name, digest = record.get("path"), record.get("sha256")
        if not isinstance(name, str) or name in indexed:
            report.error(f"invalid or duplicate handoff manifest path: {name!r}")
        elif not isinstance(digest, str) or len(digest) != 64:
            report.error(f"invalid handoff manifest SHA-256 for {name}")
        else:
            indexed[name] = digest
    if set(indexed) != set(EXPECTED_FILES):
        report.error("handoff manifest file set mismatch")
        return
    drift = [name for name, expected in indexed.items()
             if not (root / name).is_file() or sha256_file(root / name) != expected]
    if drift:
        report.error(f"handoff contract checksum mismatch: {sorted(drift)}")
    else:
        report.check("handoff_contract_checksums_verified")


def _validate_schema_headers(documents: Mapping[str, Any], report: HandoffContractReport) -> None:
    ids: set[str] = set()
    for name in SCHEMA_FILES:
        schema = documents.get(name)
        if not isinstance(schema, dict):
            continue
        if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
            report.error(f"{name} is not JSON Schema Draft 2020-12")
        if schema.get("type") != "object" or schema.get("additionalProperties") is not False:
            report.error(f"{name} must be a strict root object schema")
        schema_id = schema.get("$id")
        if not isinstance(schema_id, str) or not schema_id or schema_id in ids:
            report.error(f"{name} has a missing or duplicate schema ID")
        else:
            ids.add(schema_id)
    if len(ids) == len(SCHEMA_FILES):
        report.check("strict_handoff_schema_headers_verified")


def _validate_attestation_contract(documents: Mapping[str, Any], report: HandoffContractReport) -> None:
    schema = documents.get("approval-attestation-v2.schema.json", {})
    properties = schema.get("properties", {}) if isinstance(schema, dict) else {}
    artifact_types = set(properties.get("artifact_type", {}).get("enum", []))
    if artifact_types != REQUIRED_APPROVAL_ARTIFACT_TYPES:
        report.error(f"approval artifact type coverage drift: {sorted(artifact_types)}")
    else:
        report.check("required_attestation_artifact_types_complete")
    algorithm = properties.get("artifact_hash_algorithm", {}).get("const")
    if algorithm != HASH_ALGORITHM or "normalization_algorithm" in properties:
        report.error("approval schema must use the single frozen artifact_hash_algorithm field")
    else:
        report.check("single_artifact_hash_algorithm_field_verified")


def _validate_hash_registry(documents: Mapping[str, Any], report: HandoffContractReport) -> None:
    registry = documents.get("artifact-hash-algorithms-v1.json", {})
    algorithms = registry.get("algorithms", []) if isinstance(registry, dict) else []
    if len(algorithms) != 1 or algorithms[0].get("algorithm_id") != HASH_ALGORITHM:
        report.error("artifact hash algorithm registry drift")
        return
    if algorithms[0].get("rfc8785_jcs") is not False or registry.get("rfc8785_algorithm_registered") is not False:
        report.error("legacy canonical JSON profile must not be relabeled RFC 8785 JCS")
    for vector in algorithms[0].get("test_vectors", []):
        try:
            canonical = canonical_json(vector["input"])
        except (KeyError, TypeError, ValueError) as exc:
            report.error(f"invalid artifact hash test vector: {exc}")
            continue
        if canonical != vector.get("canonical") or canonical_json_sha256(vector["input"]) != vector.get("sha256"):
            report.error("artifact hash test vector mismatch")
    if not report.errors:
        report.check("artifact_hash_vectors_verified")


def _validate_profiles(documents: Mapping[str, Any], report: HandoffContractReport) -> None:
    targeted = documents.get("shadow-scope-targeted-rescanned-v1.json", {})
    legacy = documents.get("shadow-scope-legacy-restricted-v1.json", {})
    for name, profile in (("targeted", targeted), ("legacy", legacy)):
        if profile.get("assembly") != {"name": "GRCg6a", "accession": "GCF_000002315.6"}:
            report.error(f"{name} profile assembly is not frozen to GRCg6a GCF_000002315.6")
        if profile.get("scientific_shadow_authorized") is not False:
            report.error(f"{name} profile must not authorize a shadow run")
        if any(profile.get("claims", {}).values()):
            report.error(f"{name} profile contains an unsupported catalog/discovery claim")
    scope = targeted.get("subject_scope", {})
    if scope.get("isoform_universe_status") != "complete" and scope.get("gene_level_absence_enabled") is not False:
        report.error("targeted profile enables gene-level absence without a complete isoform universe")
    if targeted.get("predicate_capabilities", {}).get("domain_absence") is not False:
        report.error("unexecuted targeted profile must keep absence predicates disabled")
    restricted = legacy.get("predicate_capabilities", {})
    forbidden = {"domain_presence", "domain_absence", "domain_order",
                 "threshold_dependent_predicates", "legacy_only_accepted_emission"}
    if any(restricted.get(field) is not False for field in forbidden):
        report.error("legacy restricted profile enables a prohibited capability")
    overrides = legacy.get("profile_gate_overrides", [])
    if not overrides or any(item.get("gate_status") != "not_applicable"
                            or item.get("observed_value") is not None
                            or not item.get("not_applicable_reason")
                            for item in overrides if isinstance(item, dict)):
        report.error("legacy not-applicable gates must use structured null semantics")
    else:
        report.check("versioned_shadow_scope_profiles_verified")


def _validate_legacy_fact(documents: Mapping[str, Any], rc2_root: Path,
                          report: HandoffContractReport) -> None:
    schema = documents.get("evidence-admissibility-policy.schema.json", {})
    semantics = schema.get("properties", {}).get("legacy_hit_semantics", {}).get("properties", {})
    if semantics.get("claim_name", {}).get("const") != "legacy_hit_observed":
        report.error("legacy_hit_observed evidence fact is not declared")
    if semantics.get("fact_field", {}).get("const") != "legacy.pfam_observed_terms":
        report.error("legacy_hit_observed fact field is invalid")
    declared = set(semantics.get("query_operators", {}).get("items", {}).get("enum", []))
    operators_path = rc2_root / "rule-operators-v1.json"
    operators = _load(operators_path, report)
    frozen = set(operators.get("operators", {})) if isinstance(operators, dict) else set()
    if "legacy_hit_observed" in frozen:
        report.error("legacy_hit_observed was incorrectly added as a rule operator")
    if declared != FROZEN_RULE_OPERATORS_FOR_LEGACY_FACT or not declared <= frozen:
        report.error("legacy evidence fact does not use exactly the existing contains/exists/eq operators")
    else:
        report.check("legacy_hit_is_fact_not_operator_verified")


def _validate_runner(documents: Mapping[str, Any], report: HandoffContractReport) -> None:
    runner = documents.get("shadow-runner-io-contract-v1.json", {})
    if set(runner.get("required_inputs", [])) != REQUIRED_RUNNER_INPUTS:
        report.error("Shadow Runner required input set drift")
    if set(runner.get("required_outputs", [])) != REQUIRED_RUNNER_OUTPUTS:
        report.error("Shadow Runner required output set drift")
    if runner.get("adds_rule_operators") is not False or runner.get("orchestration_only") is not True:
        report.error("Shadow Runner contract crosses the orchestration boundary")
    if runner.get("formal_assertion_write_allowed") is not False or runner.get("release_database_write_allowed") is not False:
        report.error("Shadow Runner interface must not write formal assertions or a release database")
    if runner.get("rejected_record_policy", {}).get("silent_drop_allowed") is not False:
        report.error("Shadow Runner permits silent source-record drops")
    else:
        report.check("shadow_runner_io_boundary_verified")


def validate_approval_aggregate(
    aggregate: Mapping[str, Any], artifacts: Mapping[str, str],
    attestations: Mapping[str, Mapping[str, Any]],
) -> list[str]:
    """Resolve an aggregate against artifacts and detached attestations."""
    errors: list[str] = []
    components = aggregate.get("components")
    if not isinstance(components, list):
        return ["aggregate components must be an array"]
    types = [item.get("artifact_type") for item in components if isinstance(item, dict)]
    if len(types) != len(components) or len(types) != len(set(types)):
        errors.append("aggregate component artifact types must be unique")
    if set(types) != AGGREGATE_COMPONENT_TYPES:
        errors.append("aggregate required component set is incomplete")
    for item in components:
        if not isinstance(item, dict):
            continue
        kind = item.get("artifact_type")
        if artifacts.get(str(kind)) != item.get("artifact_sha256"):
            errors.append(f"aggregate artifact hash unresolved: {kind}")
        attestation = attestations.get(str(item.get("attestation_id")))
        if not attestation:
            errors.append(f"aggregate attestation unresolved: {kind}")
            continue
        if canonical_json_sha256(attestation) != item.get("attestation_sha256"):
            errors.append(f"aggregate attestation hash mismatch: {kind}")
        if (attestation.get("artifact_type") != kind
                or attestation.get("artifact_sha256") != item.get("artifact_sha256")
                or attestation.get("approval_scope") != "approved_for_shadow_run"
                or attestation.get("decision") != "approved"):
            errors.append(f"aggregate attestation does not approve component: {kind}")
    return errors


def validate_handoff_contracts(root: Path, rc2_contract_root: Path) -> HandoffContractReport:
    report = HandoffContractReport()
    documents: dict[str, Any] = {}
    for name in EXPECTED_FILES:
        path = root / name
        if not path.is_file():
            report.error(f"missing handoff contract file: {name}")
            continue
        document = _load(path, report)
        if document is not None:
            documents[name] = document
    if len(documents) == len(EXPECTED_FILES):
        report.check("handoff_contract_file_set_loaded")
    _validate_manifest(root, report)
    _validate_schema_headers(documents, report)
    _validate_attestation_contract(documents, report)
    _validate_hash_registry(documents, report)
    _validate_profiles(documents, report)
    _validate_legacy_fact(documents, rc2_contract_root, report)
    _validate_runner(documents, report)
    return report


def project_paths() -> tuple[Path, Path]:
    project_root = Path(__file__).resolve().parent.parent
    return (project_root / "contracts" / "gene-family" / "rc2b1",
            project_root / "contracts" / "gene-family" / "rc2")


def main(argv: list[str] | None = None) -> int:
    default_root, default_rc2 = project_paths()
    parser = argparse.ArgumentParser(description="Validate RC2-B.1 handoff contracts")
    parser.add_argument("--contracts", type=Path, default=default_root)
    parser.add_argument("--rc2-contracts", type=Path, default=default_rc2)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    report = validate_handoff_contracts(args.contracts, args.rc2_contracts)
    if args.as_json:
        print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2))
    else:
        print(f"RC2-B.1 handoff contracts: {'PASS' if report.ok else 'FAIL'}")
        print(f"checks={len(report.checks)} errors={len(report.errors)}")
        for error in report.errors:
            print(f"ERROR: {error}")
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
