"""Validate the engineering-only RC2-B shadow-preparation contracts.

The validator is standard-library only and never opens or writes a release
database.  It verifies the frozen engineering package, its content hashes and
the namespace boundary between evaluator diagnostics and assertion reasons.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.gene_family_rule_engine import EMITTED_TRACE_DIAGNOSTIC_CODES


SCHEMA_FILES = (
    "domain-vocabulary.schema.json",
    "rule-catalog.schema.json",
    "scan-evidence.schema.json",
    "regression-fixture.schema.json",
    "approval-attestation.schema.json",
    "rollup-policy.schema.json",
    "publication-policy.schema.json",
    "mapping-consistency.schema.json",
)
REGISTRY_FILES = (
    "trace-diagnostic-codes-v1.json",
    "shadow-qc-gates-v1.json",
)
MANIFEST_FILE = "shadow-contract-manifest-v1.json"
EXPECTED_FILES = SCHEMA_FILES + REGISTRY_FILES
APPROVAL_SCOPES = {
    "approved_for_rule_testing",
    "approved_for_shadow_run",
    "approved_for_rc2c_build",
    "approved_for_release",
}
SHADOW_GATE_IDS = {
    "mapping_cross_table_mismatch_count",
    "threshold_policy_coverage",
    "scan_completeness_coverage",
    "evidence_admissibility_approval_coverage",
    "diagnostic_code_registry_coverage",
    "fixture_expected_outcome_coverage",
    "attempted_evaluation_trace_coverage",
    "protein_gene_rollup_provenance_coverage",
    "publication_decision_provenance_coverage",
    "shadow_subject_universe_coverage",
    "independent_clean_build_semantic_hash_match",
}
VALUE_STATUSES = {
    "observed", "derived", "not_reported", "not_applicable", "unknown_legacy",
}


@dataclass
class ShadowContractReport:
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
        return {
            "ok": self.ok,
            "check_count": len(self.checks),
            "error_count": len(self.errors),
            "checks": self.checks,
            "errors": self.errors,
        }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load(path: Path, report: ShadowContractReport) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        report.error(f"cannot load {path.name}: {exc}")
        return None


def _validate_manifest(
    root: Path, documents: dict[str, Any], report: ShadowContractReport,
) -> None:
    manifest_path = root / MANIFEST_FILE
    manifest = _load(manifest_path, report)
    if not isinstance(manifest, dict):
        return
    if manifest.get("manifest_id") != "gf-shadow-contract-manifest-v1":
        report.error("shadow contract manifest_id is invalid")
    if manifest.get("status") != "frozen_for_engineering":
        report.error("shadow contract manifest is not frozen_for_engineering")
    if manifest.get("base_contract") != "gg-gf-contract-1.0":
        report.error("shadow contract manifest base_contract is invalid")
    if manifest.get("scientific_shadow_authorized") is not False:
        report.error("shadow contract manifest must not authorize a scientific shadow")
    records = manifest.get("files")
    if not isinstance(records, list):
        report.error("shadow contract manifest files must be an array")
        return
    indexed: dict[str, str] = {}
    for record in records:
        if not isinstance(record, dict) or set(record) != {"path", "sha256"}:
            report.error("shadow contract manifest records require only path and sha256")
            continue
        path, digest = record.get("path"), record.get("sha256")
        if not isinstance(path, str) or path in indexed:
            report.error(f"duplicate or invalid manifest path: {path!r}")
            continue
        if not isinstance(digest, str) or len(digest) != 64:
            report.error(f"invalid manifest SHA-256 for {path}")
            continue
        indexed[path] = digest
    if set(indexed) != set(EXPECTED_FILES):
        report.error(
            "shadow contract manifest file set mismatch: "
            f"expected={sorted(EXPECTED_FILES)} observed={sorted(indexed)}"
        )
        return
    mismatches = [
        name for name, expected in indexed.items()
        if _sha256(root / name) != expected
    ]
    if mismatches:
        report.error(f"shadow contract checksum mismatch: {sorted(mismatches)}")
    else:
        report.check("shadow_contract_checksums_verified")


def _validate_schemas(documents: dict[str, Any], report: ShadowContractReport) -> None:
    schema_ids: set[str] = set()
    for name in SCHEMA_FILES:
        schema = documents.get(name)
        if not isinstance(schema, dict):
            continue
        if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
            report.error(f"{name} is not JSON Schema Draft 2020-12")
        if schema.get("type") != "object" or schema.get("additionalProperties") is not False:
            report.error(f"{name} must be a strict root object schema")
        schema_id = schema.get("$id")
        if not isinstance(schema_id, str) or not schema_id:
            report.error(f"{name} has no schema ID")
        elif schema_id in schema_ids:
            report.error(f"duplicate schema ID: {schema_id}")
        else:
            schema_ids.add(schema_id)
    if len(schema_ids) == len(SCHEMA_FILES):
        report.check("strict_schema_headers_verified")

    vocabulary = documents.get("domain-vocabulary.schema.json", {})
    vocab_status = vocabulary.get("properties", {}).get("status", {}).get("enum", [])
    if APPROVAL_SCOPES.intersection(vocab_status):
        report.error("approval scope is incorrectly encoded as vocabulary lifecycle status")
    else:
        report.check("approval_scope_separated_from_lifecycle_status")

    approval = documents.get("approval-attestation.schema.json", {})
    observed_scopes = set(
        approval.get("properties", {}).get("approval_scope", {}).get("enum", [])
    )
    if observed_scopes != APPROVAL_SCOPES:
        report.error(f"approval scope contract drift: {sorted(observed_scopes)}")
    else:
        report.check("approval_scopes_verified")
    hash_algorithm = (
        approval.get("properties", {})
        .get("artifact_hash_algorithm", {})
        .get("const")
    )
    if hash_algorithm != "gf-canonical-json-sha256-v1":
        report.error("approval artifact hash algorithm is not frozen")
    else:
        report.check("approval_artifact_hash_algorithm_verified")

    scan = documents.get("scan-evidence.schema.json", {})
    observed_statuses = set(
        scan.get("$defs", {}).get("valueStatus", {}).get("enum", [])
    )
    if observed_statuses != VALUE_STATUSES:
        report.error(f"scan value-status contract drift: {sorted(observed_statuses)}")
    else:
        report.check("scan_missing_value_semantics_verified")

    mapping = documents.get("mapping-consistency.schema.json", {})
    mapping_required = set(
        mapping.get("properties", {}).get("rows", {}).get("items", {}).get("required", [])
    )
    required_mapping_fields = {
        "source_namespace", "source_identifier", "gf_subject_status",
        "registry_mapping_status", "registry_internal_gene_id",
        "consistency_status", "engineering_reason",
        "scientific_review_required", "proposed_action",
    }
    if not required_mapping_fields <= mapping_required:
        report.error("mapping-consistency schema does not match the audit report contract")
    else:
        report.check("mapping_consistency_report_fields_verified")


def _validate_diagnostics(
    documents: dict[str, Any], rc2_root: Path, report: ShadowContractReport,
) -> None:
    registry = documents.get("trace-diagnostic-codes-v1.json")
    if not isinstance(registry, dict):
        return
    if registry.get("namespace") != "trace_diagnostic":
        report.error("trace diagnostic namespace is invalid")
    if registry.get("unknown_codes_allowed") is not False:
        report.error("unknown trace diagnostic codes must be rejected")
    if registry.get("scientific_approval_implied") is not False:
        report.error("trace diagnostic registry must not imply scientific approval")
    records = registry.get("codes")
    if not isinstance(records, list):
        report.error("trace diagnostic codes must be an array")
        return
    codes = [item.get("code") for item in records if isinstance(item, dict)]
    if len(codes) != len(records) or any(not isinstance(code, str) or not code for code in codes):
        report.error("trace diagnostic registry contains invalid records")
        return
    if len(codes) != len(set(codes)):
        report.error("trace diagnostic registry contains duplicate codes")
    missing = set(EMITTED_TRACE_DIAGNOSTIC_CODES) - set(codes)
    if missing:
        report.error(f"evaluator diagnostics are unregistered: {sorted(missing)}")
    else:
        report.check("evaluator_diagnostic_registry_coverage_verified")

    reasons = _load(rc2_root / "reason-codes-v1.json", report)
    if isinstance(reasons, dict) and isinstance(reasons.get("codes"), list):
        reason_codes = {
            item.get("code") for item in reasons["codes"] if isinstance(item, dict)
        }
        overlap = set(codes).intersection(reason_codes)
        if overlap:
            report.error(f"trace diagnostics overlap assertion reasons: {sorted(overlap)}")
        else:
            report.check("diagnostic_assertion_reason_namespaces_disjoint")


def _validate_gates(
    documents: dict[str, Any], rc2_root: Path, report: ShadowContractReport,
) -> None:
    gates = documents.get("shadow-qc-gates-v1.json")
    if not isinstance(gates, dict):
        return
    if gates.get("status") != "frozen_for_engineering":
        report.error("shadow QC gates are not frozen_for_engineering")
    if gates.get("base_contract") != "gg-gf-contract-1.0":
        report.error("shadow QC gates do not extend gg-gf-contract-1.0")
    if gates.get("scientific_shadow_authorized") is not False:
        report.error("shadow QC gates must not authorize a scientific shadow")
    records = gates.get("gates")
    if not isinstance(records, list):
        report.error("shadow QC gates must be an array")
        return
    observed = [item.get("gate_id") for item in records if isinstance(item, dict)]
    if len(observed) != len(records) or set(observed) != SHADOW_GATE_IDS:
        report.error(f"shadow QC gate set drift: {sorted(str(item) for item in observed)}")
    elif len(observed) != len(set(observed)):
        report.error("shadow QC gate IDs are not unique")
    elif any(item.get("severity") != "blocker" for item in records):
        report.error("every formal shadow entry gate must be a blocker")
    else:
        report.check("shadow_qc_gate_set_verified")

    base_qc = _load(rc2_root / "qc-policy-v1.json", report)
    if isinstance(base_qc, dict) and isinstance(base_qc.get("gates"), list):
        base_ids = {
            item.get("gate_id") for item in base_qc["gates"] if isinstance(item, dict)
        }
        overlap = set(observed).intersection(base_ids)
        if overlap:
            report.error(f"shadow gate IDs duplicate RC2-A gates: {sorted(overlap)}")
        else:
            report.check("shadow_gates_extend_without_mutating_rc2a")


def validate_shadow_contracts(
    root: Path, rc2_contract_root: Path,
) -> ShadowContractReport:
    report = ShadowContractReport()
    documents: dict[str, Any] = {}
    for name in EXPECTED_FILES:
        path = root / name
        if not path.is_file():
            report.error(f"missing shadow contract file: {name}")
            continue
        document = _load(path, report)
        if document is not None:
            documents[name] = document
    if len(documents) == len(EXPECTED_FILES):
        report.check("shadow_contract_file_set_loaded")
    _validate_manifest(root, documents, report)
    _validate_schemas(documents, report)
    _validate_diagnostics(documents, rc2_contract_root, report)
    _validate_gates(documents, rc2_contract_root, report)
    return report


def project_paths() -> tuple[Path, Path]:
    root = Path(__file__).resolve().parent.parent
    return (
        root / "rules" / "gene-family" / "ubiquitin" / "v1",
        root / "contracts" / "gene-family" / "rc2",
    )


def main(argv: list[str] | None = None) -> int:
    default_root, default_rc2 = project_paths()
    parser = argparse.ArgumentParser(description="Validate RC2-B shadow-preparation contracts")
    parser.add_argument("--contracts", type=Path, default=default_root)
    parser.add_argument("--rc2-contracts", type=Path, default=default_rc2)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    report = validate_shadow_contracts(args.contracts, args.rc2_contracts)
    if args.as_json:
        print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2))
    else:
        print(f"RC2-B shadow contracts: {'PASS' if report.ok else 'FAIL'}")
        print(f"checks={len(report.checks)} errors={len(report.errors)}")
        for error in report.errors:
            print(f"ERROR: {error}")
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
