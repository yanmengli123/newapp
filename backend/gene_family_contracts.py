"""Validation helpers for the RC2 gene-family scientific contracts.

The validator is intentionally standard-library only. It validates the frozen
contract package and can audit the RC1 baseline through an immutable SQLite URI;
it never creates or updates a release database.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


CONTRACT_VERSION = "gg-gf-contract-1.0"
CONTRACT_STATUS = "frozen_for_implementation"
EXPECTED_CONTRACT_FILES = (
    "assertion-key-v1.json",
    "subject-normalization-v1.json",
    "state-enums.json",
    "metric-registry-v1.json",
    "reason-codes-v1.json",
    "rule-operators-v1.json",
    "qc-policy-v1.json",
)
EXPECTED_DOC_FILES = (
    "release_state_contract.md",
    "assertion_identity_contract.md",
    "subject_identifier_policy.md",
    "entry_semantics.md",
    "evidence_model.md",
    "rule_model.md",
    "metric_registry.md",
    "mapping_policy.md",
    "diff_contract.md",
    "rc2_exit_criteria.md",
)
RC1_SQLITE_SHA256 = "b590a0bfd9d81b41bbf044eb7daba08f241c9a959362d59f06de8142ac84ad97"


@dataclass
class ContractValidationReport:
    checks: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
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
            "warning_count": len(self.warnings),
            "error_count": len(self.errors),
            "checks": self.checks,
            "warnings": self.warnings,
            "errors": self.errors,
        }


def canonical_json(value: Any) -> str:
    """Canonical form used by the string-only key payload and metric hashes.

    RFC 8785 number serialization is intentionally avoided for identity payloads
    by requiring string values. Metric definition hashes contain no numbers.
    """

    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def stable_contract_key(payload: dict[str, str], prefix: str) -> str:
    if not payload or any(not isinstance(value, str) or not value for value in payload.values()):
        raise ValueError("stable-key payload values must be non-empty strings")
    return f"{prefix}{sha256_text(canonical_json(payload))}"


def _load_contracts(root: Path, report: ContractValidationReport) -> dict[str, dict[str, Any]]:
    loaded: dict[str, dict[str, Any]] = {}
    for name in EXPECTED_CONTRACT_FILES:
        path = root / name
        if not path.is_file():
            report.error(f"missing machine contract: {path}")
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            report.error(f"invalid JSON contract {path}: {exc}")
            continue
        if not isinstance(data, dict):
            report.error(f"contract root must be an object: {path}")
            continue
        if data.get("contract_version") != CONTRACT_VERSION:
            report.error(f"{name}: unexpected contract_version")
        if data.get("status") != CONTRACT_STATUS:
            report.error(f"{name}: unexpected status")
        loaded[name] = data
    if len(loaded) == len(EXPECTED_CONTRACT_FILES):
        report.check("all_machine_contracts_loaded")
    return loaded


def _validate_bundle_checksums(root: Path, report: ContractValidationReport) -> None:
    checksum_path = root / "checksums.sha256"
    if not checksum_path.is_file():
        report.error(f"missing contract checksum manifest: {checksum_path}")
        return
    declared: dict[str, str] = {}
    for line_number, raw_line in enumerate(checksum_path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw_line.strip():
            continue
        parts = raw_line.split()
        if len(parts) != 2 or not re.fullmatch(r"[0-9a-f]{64}", parts[0]):
            report.error(f"invalid checksum line {line_number}: {raw_line}")
            continue
        declared[parts[1]] = parts[0]
    if set(declared) != set(EXPECTED_CONTRACT_FILES):
        report.error("contract checksum manifest does not cover exactly the seven JSON contracts")
        return
    for name, expected in declared.items():
        path = root / name
        if not path.is_file():
            report.error(f"contract bundle checksum target is missing: {name}")
        elif sha256_file(path) != expected:
            report.error(f"contract bundle checksum mismatch: {name}")
    if not any("contract bundle checksum" in error for error in report.errors):
        report.check("contract_bundle_checksums_valid")


def _validate_docs(docs_root: Path, report: ContractValidationReport) -> None:
    missing = [name for name in EXPECTED_DOC_FILES if not (docs_root / name).is_file()]
    if missing:
        report.error(f"missing normative documents: {', '.join(missing)}")
    else:
        report.check("all_normative_documents_present")


def _validate_identity(data: dict[str, Any], report: ContractValidationReport) -> None:
    assertion = data.get("assertion_key", {})
    slot = data.get("assignment_slot_key", {})
    required_assertion_fields = {
        "taxon_id",
        "scheme_stable_id",
        "source_subject_namespace",
        "source_subject_identifier",
        "entry_stable_id",
        "assignment_role",
    }
    if set(assertion.get("fields", [])) != required_assertion_fields:
        report.error("assertion key fields do not match the v1 identity contract")
    if "release_id" not in set(assertion.get("excluded_fields", [])):
        report.error("release_id must be excluded from assertion_key")
    if set(slot.get("applicable_cardinality", [])) != {"single_per_role"}:
        report.error("assignment slots must be restricted to single_per_role schemes")

    cardinality = data.get("scheme_cardinality", {})
    if not cardinality:
        report.error("scheme cardinality registry is empty")
    for scheme_id, scheme in cardinality.items():
        value = scheme.get("cardinality")
        axis = scheme.get("classification_axis")
        if value == "single_per_role" and not axis:
            report.error(f"{scheme_id}: single-valued scheme requires classification_axis")
        if value == "multi_per_role" and axis is not None:
            report.error(f"{scheme_id}: multi-valued scheme must not receive a universal slot axis")
    if cardinality:
        report.check("scheme_cardinality_valid")

    vectors = data.get("test_vectors", [])
    if not vectors:
        report.error("stable-key test vectors are missing")
    for vector in vectors:
        if "payload" in vector:
            actual = stable_contract_key(vector["payload"], assertion.get("prefix", ""))
        elif "slot_payload" in vector:
            actual = stable_contract_key(vector["slot_payload"], slot.get("prefix", ""))
        else:
            report.error(f"invalid stable-key vector: {vector.get('name')}")
            continue
        if actual != vector.get("expected"):
            report.error(f"stable-key vector failed: {vector.get('name')}")
    if vectors and not any("stable-key vector failed" in error for error in report.errors):
        report.check("stable_key_test_vectors_passed")


def _validate_subjects(data: dict[str, Any], report: ContractValidationReport) -> None:
    namespaces = data.get("namespaces", {})
    seen_aliases: dict[str, str] = {}
    for namespace, policy in namespaces.items():
        try:
            re.compile(policy["pattern"])
        except (KeyError, re.error) as exc:
            report.error(f"{namespace}: invalid identifier pattern: {exc}")
        for alias in policy.get("aliases", []):
            previous = seen_aliases.get(alias)
            if previous and previous != namespace:
                report.error(f"identifier alias {alias!r} belongs to multiple namespaces")
            seen_aliases[alias] = namespace
    for forbidden in ("chickendata_gene", "gene_symbol"):
        if namespaces.get(forbidden, {}).get("stable_key_eligible") is not False:
            report.error(f"{forbidden} must not be source stable-key eligible")
    if namespaces:
        report.check("subject_namespace_policies_valid")


def _validate_states(data: dict[str, Any], report: ContractValidationReport) -> None:
    release_states = set(data.get("release_status", []))
    for source, targets in data.get("release_transitions", {}).items():
        if source not in release_states or not set(targets).issubset(release_states):
            report.error(f"invalid release transition from {source}")
    assertion_states = set(data.get("assertion_state", []))
    if "unresolved" in assertion_states or data.get("assertion_state_rules", {}).get("unresolved_allowed"):
        report.error("unresolved must not be an RC2 assertion state")
    required_basis = {
        "executable_local_rule",
        "external_curated_source",
        "manual_review",
        "legacy_source_assertion",
    }
    if set(data.get("decision_basis_type", [])) != required_basis:
        report.error("decision_basis_type contract is incomplete")
    if not report.errors:
        report.check("state_enums_and_transitions_valid")


def _validate_reasons(data: dict[str, Any], states: dict[str, Any], report: ContractValidationReport) -> None:
    codes = data.get("codes", [])
    names = [row.get("code") for row in codes]
    if len(names) != len(set(names)) or any(not name for name in names):
        report.error("reason codes must be non-empty and unique")
    allowed_outcomes = set(states.get("assertion_state", []))
    for row in codes:
        invalid = set(row.get("outcomes", [])) - allowed_outcomes
        if invalid:
            report.error(f"reason code {row.get('code')} has invalid outcomes: {sorted(invalid)}")
    required = {"mapping_ambiguous", "mapping_unresolved", "excluded_abc_transporter_architecture"}
    if not required.issubset(names):
        report.error("required mapping/CFTR reason codes are missing")
    if codes:
        report.check("reason_code_registry_valid")


def _validate_rule_operators(data: dict[str, Any], report: ContractValidationReport) -> None:
    required_nodes = {"all", "any", "not", "predicate"}
    required_scopes = {"same_hit", "same_protein", "same_gene", "any_isoform", "all_isoforms", "representative_isoform"}
    if set(data.get("node_types", [])) != required_nodes:
        report.error("rule node types are incomplete")
    if set(data.get("evidence_scopes", [])) != required_scopes:
        report.error("rule evidence scopes are incomplete")
    if data.get("manual_review_is_rule_priority") is not False:
        report.error("manual review must remain outside automatic rule priority")
    serialized = canonical_json(data).lower()
    for prohibited in data.get("prohibited_payloads", []):
        if prohibited not in {"sql", "python_expression", "javascript_expression", "shell_command"}:
            report.error(f"unknown prohibited payload label: {prohibited}")
    if '"expression"' in serialized and "prohibited_payloads" not in data:
        report.error("arbitrary rule expressions are prohibited")
    report.check("rule_operator_allowlist_valid")


def _metric_definition_hash(metric: dict[str, Any], fields: list[str]) -> str:
    payload = {name: metric.get(name) for name in fields}
    return sha256_text(canonical_json(payload))


def _validate_metrics(data: dict[str, Any], states: dict[str, Any], report: ContractValidationReport) -> None:
    metrics = data.get("metrics", [])
    fields = data.get("definition_hash_fields", [])
    allowed_impl = set(data.get("allowed_implementation_ids", []))
    allowed_states = set(states.get("assertion_state", []))
    allowed_roles = set(states.get("assignment_role", []))
    ids = [metric.get("metric_id") for metric in metrics]
    if len(ids) != len(set(ids)) or any(not metric_id for metric_id in ids):
        report.error("metric IDs must be non-empty and unique")
    for metric in metrics:
        metric_id = metric.get("metric_id", "<missing>")
        if metric.get("implementation_id") not in allowed_impl:
            report.error(f"{metric_id}: implementation is not allow-listed")
        if set(metric.get("eligible_assertion_states", [])) - allowed_states:
            report.error(f"{metric_id}: invalid assertion state")
        if set(metric.get("eligible_assignment_roles", [])) - allowed_roles:
            report.error(f"{metric_id}: invalid assignment role")
        if metric.get("mapping_requirement") not in {"none", "any", "exact"}:
            report.error(f"{metric_id}: invalid mapping requirement")
        if metric.get("definition_hash") != _metric_definition_hash(metric, fields):
            report.error(f"{metric_id}: definition hash mismatch")
        if "accepted" in metric_id and "candidate" in metric.get("eligible_assertion_states", []):
            report.error(f"{metric_id}: candidate state leaks into an accepted metric")
        denominator = metric.get("denominator_metric_id")
        if denominator is not None and denominator not in ids:
            report.error(f"{metric_id}: unknown denominator metric {denominator}")
    baseline = next((row for row in metrics if row.get("metric_id") == "ubiquitin_accepted_mapped_gene_count"), {})
    expected = baseline.get("rc1_baseline", {})
    if expected != {"value": 383, "denominator": 387, "excluded": {"ambiguous": 3, "unmapped": 1}}:
        report.error("ubiquitin RC1 mapping baseline must be 383 exact, 3 ambiguous and 1 unmapped")
    if metrics:
        report.check("metric_registry_and_hashes_valid")


def _validate_qc(data: dict[str, Any], states: dict[str, Any], report: ContractValidationReport) -> None:
    gates = data.get("gates", [])
    gate_ids = [gate.get("gate_id") for gate in gates]
    if len(gate_ids) != len(set(gate_ids)) or any(not gate_id for gate_id in gate_ids):
        report.error("QC gate IDs must be non-empty and unique")
    target = data.get("rc2_target", {})
    if target.get("release_status") != "release_candidate" or target.get("blocking_issue_count") != 0:
        report.error("RC2 target status is invalid")
    if not set(target.get("qc_status", [])).issubset(set(states.get("qc_status", []))):
        report.error("RC2 target contains an unknown QC state")
    required_signoffs = {"builder", "data_qc_reviewer", "scientific_curator"}
    if set(data.get("required_signoff_roles", [])) != required_signoffs:
        report.error("RC2 sign-off roles are incomplete")
    required_gates = {
        "accepted_decision_provenance_coverage",
        "applicable_executable_rule_trace_coverage",
        "unreviewed_accepted_ambiguous_count",
        "unreviewed_accepted_unmapped_count",
        "candidate_in_accepted_metric_count",
        "supplementary_in_core_metric_count",
        "unexpected_assertion_change_count",
        "raw_source_modification_count",
    }
    if not required_gates.issubset(gate_ids):
        report.error("QC policy is missing required scientific gates")
    if gates:
        report.check("qc_policy_valid")


def validate_rc1_baseline(
    db_path: Path,
    report: ContractValidationReport,
    expected_sha256: str = RC1_SQLITE_SHA256,
) -> None:
    if not db_path.is_file():
        report.warnings.append(f"RC1 baseline database is unavailable: {db_path}")
        return
    actual_hash = sha256_file(db_path)
    if actual_hash != expected_sha256:
        report.error(f"RC1 SQLite checksum changed: {actual_hash}")
        return
    report.check("rc1_sqlite_checksum_unchanged")

    uri = f"{db_path.resolve().as_uri()}?mode=ro&immutable=1"
    connection = sqlite3.connect(uri, uri=True)
    try:
        connection.execute("PRAGMA query_only = ON")
        counts = {
            "assertions": connection.execute("SELECT COUNT(*) FROM gf_assertion").fetchone()[0],
            "domain_hits": connection.execute("SELECT COUNT(*) FROM gf_domain_hit").fetchone()[0],
            "ubi_accepted": connection.execute(
                "SELECT COUNT(*) FROM gf_assertion WHERE scheme_id='ubiquitin_core' AND assertion_state='accepted'"
            ).fetchone()[0],
            "ubi_candidate": connection.execute(
                "SELECT COUNT(*) FROM gf_assertion WHERE scheme_id='ubiquitin_core' AND assertion_state='candidate'"
            ).fetchone()[0],
        }
        expected_counts = {
            "assertions": 125109,
            "domain_hits": 118957,
            "ubi_accepted": 387,
            "ubi_candidate": 907,
        }
        if counts != expected_counts:
            report.error(f"RC1 baseline counts changed: {counts}")
        mapping = dict(
            connection.execute(
                """
                SELECT s.mapping_state, COUNT(*)
                FROM gf_assertion a JOIN gf_subject s ON s.subject_pk=a.subject_pk
                WHERE a.scheme_id='ubiquitin_core' AND a.assertion_state='accepted'
                GROUP BY s.mapping_state
                """
            ).fetchall()
        )
        if mapping != {"ambiguous": 3, "exact": 383, "unmapped": 1}:
            report.error(f"RC1 ubiquitin mapping baseline changed: {mapping}")
        if counts == expected_counts and mapping == {"ambiguous": 3, "exact": 383, "unmapped": 1}:
            report.check("rc1_scientific_baseline_reconciled")
    finally:
        connection.close()


def validate_contracts(
    contract_root: Path,
    docs_root: Path | None = None,
    rc1_db: Path | None = None,
) -> ContractValidationReport:
    report = ContractValidationReport()
    contracts = _load_contracts(contract_root, report)
    _validate_bundle_checksums(contract_root, report)
    if docs_root is not None:
        _validate_docs(docs_root, report)
    if len(contracts) != len(EXPECTED_CONTRACT_FILES):
        return report

    identity = contracts["assertion-key-v1.json"]
    subjects = contracts["subject-normalization-v1.json"]
    states = contracts["state-enums.json"]
    metrics = contracts["metric-registry-v1.json"]
    reasons = contracts["reason-codes-v1.json"]
    operators = contracts["rule-operators-v1.json"]
    qc = contracts["qc-policy-v1.json"]

    _validate_identity(identity, report)
    _validate_subjects(subjects, report)
    _validate_states(states, report)
    _validate_reasons(reasons, states, report)
    _validate_rule_operators(operators, report)
    _validate_metrics(metrics, states, report)
    _validate_qc(qc, states, report)
    if rc1_db is not None:
        validate_rc1_baseline(rc1_db, report)
    return report


def project_paths() -> tuple[Path, Path, Path]:
    project_root = Path(__file__).resolve().parent.parent
    return (
        project_root / "contracts" / "gene-family" / "rc2",
        project_root / "docs" / "gene-family" / "rc2",
        Path(r"D:\jbrowsedata\projectdata\gene family\releases\gg-gf-2026-07-rc1\gene_family.sqlite"),
    )


def main(argv: list[str] | None = None) -> int:
    default_contracts, default_docs, default_rc1 = project_paths()
    parser = argparse.ArgumentParser(description="Validate gene-family RC2-A scientific contracts")
    parser.add_argument("--contracts", type=Path, default=default_contracts)
    parser.add_argument("--docs", type=Path, default=default_docs)
    parser.add_argument("--rc1-db", type=Path, default=default_rc1)
    parser.add_argument("--skip-rc1", action="store_true")
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)

    report = validate_contracts(
        args.contracts,
        docs_root=args.docs,
        rc1_db=None if args.skip_rc1 else args.rc1_db,
    )
    if args.as_json:
        print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2))
    else:
        print(f"RC2-A contracts: {'PASS' if report.ok else 'FAIL'}")
        print(f"checks={len(report.checks)} warnings={len(report.warnings)} errors={len(report.errors)}")
        for warning in report.warnings:
            print(f"WARNING: {warning}")
        for error in report.errors:
            print(f"ERROR: {error}")
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
