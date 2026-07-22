"""Validate the append-only RC2-B.2 readiness contract package.

The validator is standard-library only. It checks engineering contracts and
never runs HMMER, evaluates a biological rule, or writes a database.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.gene_family_handoff_contracts import sha256_file


SCHEMA_FILES = {
    "decision-submission-manifest.schema.json",
    "target-universe-manifest.schema.json",
    "scan-environment-manifest.schema.json",
}
CONTRACT_FILES = {
    "README.md",
    "dual-scan-policy-v1.json",
    "rc2b2-p0-qc-gates-v1.json",
}
EXPECTED_FILES = SCHEMA_FILES | CONTRACT_FILES
MANIFEST_FILE = "rc2b2-contract-manifest-v1.json"
MANIFEST_ID = "gg-gf-rc2b2-readiness-1.0"
PARENT_MANIFEST_ID = "gg-gf-rc2b1-scientific-handoff-1.0"
EXPECTED_COUNTS = {
    "target_genes": 1294,
    "target_transcripts": 4777,
    "target_protein_subjects": 4571,
    "noncoding_transcript_exclusions": 206,
    "scan_execution_sequences": 3525,
    "shared_sequence_groups": 460,
    "subjects_in_shared_sequence_groups": 1506,
    "scan_execution_reuse_savings": 1046,
    "multi_placement_genes": 4,
    "annotation_exception_proteins": 209,
}
PFAM_ARTIFACT_ROLES = {
    "pfam_hmm_compressed",
    "pfam_hmm_uncompressed",
    "pfam_hmm_dat",
    "pfam_hmm_h3f",
    "pfam_hmm_h3i",
    "pfam_hmm_h3m",
    "pfam_hmm_h3p",
    "pfam_clans",
    "pfam_dead_families",
    "pfam_version_record",
}


@dataclass
class RC2B2ContractReport:
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


def _load_json(path: Path, report: RC2B2ContractReport) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        report.error(f"cannot load {path.name}: {exc}")
        return None


def _validate_manifest(
    root: Path, parent_handoff_manifest: Path, report: RC2B2ContractReport
) -> dict[str, Any] | None:
    manifest = _load_json(root / MANIFEST_FILE, report)
    if not isinstance(manifest, dict):
        return None
    if manifest.get("manifest_id") != MANIFEST_ID:
        report.error("RC2-B.2 manifest_id is invalid")
    if manifest.get("status") != "frozen_for_engineering":
        report.error("RC2-B.2 contract package is not frozen_for_engineering")
    parent = manifest.get("parent_handoff")
    if not isinstance(parent, dict):
        report.error("RC2-B.2 parent handoff binding is missing")
    else:
        if parent.get("manifest_id") != PARENT_MANIFEST_ID:
            report.error("RC2-B.2 parent handoff manifest ID drift")
        if not parent_handoff_manifest.is_file():
            report.error("frozen RC2-B.1 handoff manifest is missing")
        elif parent.get("sha256") != sha256_file(parent_handoff_manifest):
            report.error("frozen RC2-B.1 handoff manifest hash drift")
        else:
            report.check("parent_rc2b1_handoff_hash_verified")

    records = manifest.get("files")
    if not isinstance(records, list):
        report.error("RC2-B.2 manifest files must be an array")
        return manifest
    indexed: dict[str, str] = {}
    for record in records:
        if not isinstance(record, dict) or set(record) != {"path", "sha256"}:
            report.error("RC2-B.2 file records require only path and sha256")
            continue
        path = record.get("path")
        digest = record.get("sha256")
        if not isinstance(path, str) or path in indexed:
            report.error(f"invalid or duplicate RC2-B.2 manifest path: {path!r}")
        elif not isinstance(digest, str) or len(digest) != 64:
            report.error(f"invalid RC2-B.2 manifest hash: {path}")
        else:
            indexed[path] = digest
    if set(indexed) != EXPECTED_FILES:
        report.error("RC2-B.2 manifest file set mismatch")
    else:
        drift = [
            name
            for name, expected in indexed.items()
            if not (root / name).is_file() or sha256_file(root / name) != expected
        ]
        if drift:
            report.error(f"RC2-B.2 contract checksum mismatch: {sorted(drift)}")
        else:
            report.check("rc2b2_contract_checksums_verified")

    boundary_fields = {
        "scientific_approval_implied",
        "pilot_scan_authorized",
        "full_targeted_scan_authorized",
        "formal_shadow_authorized",
        "rc2c_build_authorized",
        "api_frontend_switch_authorized",
    }
    if any(manifest.get(field) is not False for field in boundary_fields):
        report.error("RC2-B.2 engineering contract crosses an authorization boundary")
    else:
        report.check("engineering_authorization_boundary_verified")
    return manifest


def _validate_schema_headers(root: Path, report: RC2B2ContractReport) -> None:
    ids: set[str] = set()
    for name in sorted(SCHEMA_FILES):
        schema = _load_json(root / name, report)
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
        report.check("strict_rc2b2_schema_headers_verified")


def _const(properties: dict[str, Any], name: str) -> Any:
    value = properties.get(name, {})
    return value.get("const") if isinstance(value, dict) else None


def _validate_target_contract(root: Path, report: RC2B2ContractReport) -> None:
    schema = _load_json(root / "target-universe-manifest.schema.json", report)
    if not isinstance(schema, dict):
        return
    properties = schema.get("properties", {})
    count_properties = properties.get("counts", {}).get("properties", {})
    observed = {name: _const(count_properties, name) for name in EXPECTED_COUNTS}
    if observed != EXPECTED_COUNTS:
        report.error(f"target-universe denominator drift: {observed}")
    identity = properties.get("identity_policy", {}).get("properties", {})
    required_identity = {
        "scientific_subject_key": "versioned_protein_accession",
        "scan_execution_key": "sequence_sha256",
        "equal_sequence_accessions_merged": False,
        "scan_results_reexpanded_before_rule_evaluation": True,
        "placement_is_biological_gene": False,
    }
    if any(_const(identity, key) != value for key, value in required_identity.items()):
        report.error("target-universe subject/scan/placement identity contract drift")
    else:
        report.check("target_denominators_and_identity_verified")


def _validate_scan_contract(root: Path, report: RC2B2ContractReport) -> None:
    schema = _load_json(root / "scan-environment-manifest.schema.json", report)
    policy = _load_json(root / "dual-scan-policy-v1.json", report)
    if not isinstance(schema, dict) or not isinstance(policy, dict):
        return
    item = (
        schema.get("properties", {})
        .get("pfam_artifacts", {})
        .get("items", {})
        .get("$ref")
    )
    artifact_roles = (
        schema.get("$defs", {})
        .get("inputArtifact", {})
        .get("properties", {})
        .get("artifact_role", {})
        .get("enum", [])
    )
    if item != "#/$defs/inputArtifact" or set(artifact_roles) != PFAM_ARTIFACT_ROLES:
        report.error("Pfam environment artifact coverage drift")
    authoritative = policy.get("authoritative", {})
    diagnostic = policy.get("diagnostic", {})
    authoritative_argv = authoritative.get("command_argv", [])
    diagnostic_argv = diagnostic.get("command_argv", [])
    if (
        authoritative.get("evidence_role") != "authoritative"
        or "--cut_ga" not in authoritative_argv
        or authoritative.get("can_support_accepted") is not True
    ):
        report.error("authoritative scan policy is invalid")
    if (
        diagnostic.get("evidence_role") != "diagnostic_only"
        or "--cut_ga" in diagnostic_argv
        or diagnostic.get("can_support_accepted") is not False
        or diagnostic.get("can_support_candidate") != "policy_dependent"
    ):
        report.error("diagnostic scan policy is invalid")
    separation = policy.get("separation", {})
    if (
        separation.get("mixed_evidence_views_allowed") is not False
        or separation.get("legacy_unknown_treated_as_ga_pass") is not False
        or separation.get("scan_evidence_is_assertion") is not False
        or separation.get("rule_evaluation_is_publication") is not False
    ):
        report.error("scan/evaluation/publication separation drift")
    else:
        report.check("dual_scan_evidence_separation_verified")
    if any(
        policy.get(field) is not False
        for field in (
            "pilot_scan_authorized",
            "full_targeted_scan_authorized",
            "formal_shadow_authorized",
        )
    ):
        report.error("dual-scan policy unexpectedly authorizes execution")


def _validate_gate_contract(root: Path, report: RC2B2ContractReport) -> None:
    gates = _load_json(root / "rc2b2-p0-qc-gates-v1.json", report)
    if not isinstance(gates, dict):
        return
    target = gates.get("target_universe", {})
    for key, required in {
        "target_genes": 1294,
        "target_transcripts": 4777,
        "target_protein_subjects": 4571,
        "noncoding_transcript_exclusions": 206,
        "target_proteins_missing_fasta": 0,
        "protein_mapped_to_multiple_genes": 0,
        "unexplained_transcript_exclusions": 0,
        "unexplained_source_format_anomalies": 0,
        "source_modification_count": 0,
    }.items():
        if target.get(key) != {"operator": "eq", "required_value": required}:
            report.error(f"RC2-B.2 P0 target gate drift: {key}")
    failure = gates.get("failure_policy", {})
    if (
        failure.get("force_failed_count_to_zero") is not False
        or failure.get("record_every_failure") is not True
        or failure.get("formal_shadow_requires_observed_failed_count_zero") is not True
    ):
        report.error("scan failure policy permits suppressed or fabricated failures")
    else:
        report.check("p0_gates_and_failure_semantics_verified")


def validate_rc2b2_contracts(
    root: Path, parent_handoff_manifest: Path
) -> RC2B2ContractReport:
    report = RC2B2ContractReport()
    required = EXPECTED_FILES | {MANIFEST_FILE}
    missing = sorted(name for name in required if not (root / name).is_file())
    if missing:
        report.error(f"missing RC2-B.2 contract files: {missing}")
        return report
    report.check("rc2b2_contract_file_set_loaded")
    _validate_manifest(root, parent_handoff_manifest, report)
    _validate_schema_headers(root, report)
    _validate_target_contract(root, report)
    _validate_scan_contract(root, report)
    _validate_gate_contract(root, report)
    return report


def project_paths() -> tuple[Path, Path]:
    project_root = Path(__file__).resolve().parent.parent
    return (
        project_root / "contracts" / "gene-family" / "rc2b2",
        project_root
        / "contracts"
        / "gene-family"
        / "rc2b1"
        / "handoff-contract-manifest-v1.json",
    )


def main(argv: list[str] | None = None) -> int:
    default_root, default_parent = project_paths()
    parser = argparse.ArgumentParser(description="Validate RC2-B.2 readiness contracts")
    parser.add_argument("--contracts", type=Path, default=default_root)
    parser.add_argument("--parent-handoff-manifest", type=Path, default=default_parent)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    report = validate_rc2b2_contracts(args.contracts, args.parent_handoff_manifest)
    if args.as_json:
        print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2))
    else:
        print(f"RC2-B.2 readiness contracts: {'PASS' if report.ok else 'FAIL'}")
        print(f"checks={len(report.checks)} errors={len(report.errors)}")
        for error in report.errors:
            print(f"ERROR: {error}")
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
