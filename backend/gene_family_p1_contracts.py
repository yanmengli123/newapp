"""Validate frozen RC2-B.2-P1 scan reproducibility contracts.

The validator is intentionally standard-library only. It validates engineering
contracts and authorization boundaries; it never downloads Pfam, runs HMMER,
changes a database, or emits a scientific classification.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.gene_family_handoff_contracts import sha256_file


P0_TARGET_MANIFEST_SHA256 = (
    "1f74a288c9fcbf3d552fcd01145bb430b615652797057eb8784ea245f636b3e6"
)
CONTRACT_MANIFEST = "p1-contract-manifest-v1.json"
CONTRACT_MANIFEST_ID = "gg-gf-rc2b2-p1-contracts-1.0"
SCHEMA_FILES = {
    "scan-environment-manifest.schema.json",
    "pilot-fixture-manifest.schema.json",
    "pilot-authorization.schema.json",
    "pilot-run-manifest.schema.json",
    "pilot-acceptance.schema.json",
    "full-scan-authorization.schema.json",
}
POLICY_FILES = {
    "README.md",
    "p1-state-machine-v1.json",
    "pfam-35-asset-policy-v1.json",
    "hmmer-runtime-policy-v1.json",
    "scan-command-policy-v1.json",
    "hmmer-output-parser-contract-v1.json",
    "semantic-hash-policy-v1.json",
    "p1-qc-gates-v1.json",
    "pilot-fixture-selection-v1.json",
}
EXPECTED_FILES = SCHEMA_FILES | POLICY_FILES


@dataclass
class P1ContractReport:
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


def _load_json(path: Path, report: P1ContractReport) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        report.error(f"cannot load {path.name}: {exc}")
        return None


def _validate_manifest(root: Path, report: P1ContractReport) -> None:
    manifest = _load_json(root / CONTRACT_MANIFEST, report)
    if not isinstance(manifest, dict):
        return
    if manifest.get("manifest_id") != CONTRACT_MANIFEST_ID:
        report.error("P1 contract manifest_id drift")
    if manifest.get("status") != "frozen_for_engineering":
        report.error("P1 contracts are not frozen_for_engineering")
    if manifest.get("p0_target_manifest_sha256") != P0_TARGET_MANIFEST_SHA256:
        report.error("P1 contracts do not bind the frozen P0 target manifest")
    records = manifest.get("files")
    if not isinstance(records, list):
        report.error("P1 contract manifest files must be an array")
        return
    indexed: dict[str, str] = {}
    for record in records:
        if not isinstance(record, dict) or set(record) != {"path", "sha256"}:
            report.error("P1 contract file record must contain only path and sha256")
            continue
        path = record.get("path")
        digest = record.get("sha256")
        if not isinstance(path, str) or path in indexed:
            report.error(f"invalid or duplicate P1 contract path: {path!r}")
        elif not isinstance(digest, str) or len(digest) != 64:
            report.error(f"invalid P1 contract hash for {path!r}")
        else:
            indexed[path] = digest
    if set(indexed) != EXPECTED_FILES:
        report.error("P1 contract manifest file set mismatch")
    else:
        drift = [
            name
            for name, expected in indexed.items()
            if not (root / name).is_file() or sha256_file(root / name) != expected
        ]
        if drift:
            report.error(f"P1 contract checksum mismatch: {sorted(drift)}")
        else:
            report.check("p1_contract_checksums_verified")
    forbidden_true = {
        "pilot_scan_authorized",
        "full_scan_authorized",
        "formal_shadow_authorized",
        "rc2c_build_authorized",
        "api_frontend_switch_authorized",
    }
    if any(manifest.get(name) is not False for name in forbidden_true):
        report.error("P1 contract package crosses an authorization boundary")
    else:
        report.check("p1_contract_authorization_boundary_verified")


def _validate_schema_headers(root: Path, report: P1ContractReport) -> None:
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
        report.check("strict_p1_schema_headers_verified")


def _validate_state_machine(root: Path, report: P1ContractReport) -> None:
    state = _load_json(root / "p1-state-machine-v1.json", report)
    if not isinstance(state, dict):
        return
    expected = {
        "scan_environment_states": {"draft_missing_inputs", "frozen"},
        "pilot_run_states": {"draft", "authorized", "running", "completed", "failed"},
        "pilot_acceptance_states": {"pending", "passed", "failed"},
    }
    for field, values in expected.items():
        observed = state.get(field)
        if not isinstance(observed, list) or set(observed) != values:
            report.error(f"independent P1 state system drift: {field}")
    if (
        state.get("implicit_downstream_transition_allowed") is not False
        or state.get("pilot_acceptance_implies_full_scan_authorization") is not False
    ):
        report.error("P1 state machine permits an implicit authorization transition")
    else:
        report.check("independent_p1_state_systems_verified")


def _validate_pfam_policy(root: Path, report: P1ContractReport) -> None:
    policy = _load_json(root / "pfam-35-asset-policy-v1.json", report)
    if not isinstance(policy, dict):
        return
    required = policy.get("required_assets")
    expected_names = {
        "md5_checksums",
        "relnotes.txt",
        "Pfam-A.hmm.gz",
        "Pfam-A.hmm.dat.gz",
        "Pfam-A.clans.tsv.gz",
        "Pfam-A.dead.gz",
        "Pfam-C.gz",
    }
    names = {
        item.get("artifact_name")
        for item in required
        if isinstance(item, dict)
    } if isinstance(required, list) else set()
    if names != expected_names:
        report.error("Pfam 35.0 required asset set drift")
    uncompressed = policy.get("uncompressed_hmm", {})
    if (
        uncompressed.get("model_count") != 19632
        or uncompressed.get("model_count_with_ga") != 19632
        or uncompressed.get("sha256")
        != "8d3e2ffa785f91ee0e24a3994d2dcfff6f382e3cf663784a47688e7d95297fee"
    ):
        report.error("Pfam 35.0 uncompressed HMM identity drift")
    elif policy.get("cross_release_sidecar_mixing_allowed") is not False:
        report.error("Pfam policy permits cross-release sidecar mixing")
    else:
        report.check("pfam35_official_identity_policy_verified")


def _validate_runtime_and_commands(root: Path, report: P1ContractReport) -> None:
    runtime = _load_json(root / "hmmer-runtime-policy-v1.json", report)
    commands = _load_json(root / "scan-command-policy-v1.json", report)
    if not isinstance(runtime, dict) or not isinstance(commands, dict):
        return
    container = runtime.get("container", {})
    params = runtime.get("pilot_parameters", {})
    if (
        runtime.get("hmmer_version") != "3.4"
        or container.get("manifest_digest")
        != "sha256:85d118bad293e1a55372f80618512f72d939b14f6f62444fcd872f7c324fed0d"
        or container.get("platform") != "linux/amd64"
        or params != {"cpu": 1, "seed": 42, "qformat": "fasta"}
    ):
        report.error("HMMER 3.4 immutable runtime policy drift")
    authoritative = commands.get("authoritative", {})
    diagnostic = commands.get("pilot_diagnostic", {})
    authoritative_argv = authoritative.get("command_argv", [])
    diagnostic_argv = diagnostic.get("command_argv", [])
    if (
        "--cut_ga" not in authoritative_argv
        or "--max" in authoritative_argv
        or authoritative.get("can_support_accepted") is not True
    ):
        report.error("authoritative Pilot command policy drift")
    if (
        "--cut_ga" in diagnostic_argv
        or "--max" not in diagnostic_argv
        or diagnostic.get("coverage_claim") != "non_exhaustive_reported_hits"
        or diagnostic.get("can_support_accepted") is not False
    ):
        report.error("diagnostic Pilot command policy drift")
    if (
        commands.get("clan_resolution_state") != "policy_pending"
        or commands.get("raw_hits_are_final_domain_architecture") is not False
    ):
        report.error("raw hit and clan-resolved architecture boundary drift")
    else:
        report.check("hmmer_runtime_and_dual_scan_policy_verified")


def _validate_parser_and_hash(root: Path, report: P1ContractReport) -> None:
    parser = _load_json(root / "hmmer-output-parser-contract-v1.json", report)
    semantic = _load_json(root / "semantic-hash-policy-v1.json", report)
    if not isinstance(parser, dict) or not isinstance(semantic, dict):
        return
    failure = parser.get("failure_policy", {})
    blockers = {
        "unrecognized_hmmer_format",
        "malformed_numeric_field",
        "invalid_coordinates",
        "unknown_model_accession",
        "unknown_query_name",
    }
    if any(failure.get(name) != "blocker" for name in blockers):
        report.error("strict HMMER parser blocker policy drift")
    if failure.get("silent_parser_skip") != "forbidden":
        report.error("HMMER parser permits silent skips")
    numeric = semantic.get("numeric_policy", {})
    if (
        numeric.get("parser") != "decimal_exact"
        or numeric.get("finite_values_only") is not True
        or semantic.get("semantic_hash_comparison_required") is not True
        or semantic.get("canonical_output_hash_comparison_required") is not True
    ):
        report.error("semantic hash policy drift")
    else:
        report.check("strict_parser_and_semantic_hash_policy_verified")


def validate_p1_contracts(root: Path) -> P1ContractReport:
    report = P1ContractReport()
    missing = sorted(
        name
        for name in EXPECTED_FILES | {CONTRACT_MANIFEST}
        if not (root / name).is_file()
    )
    if missing:
        report.error(f"missing P1 contract files: {missing}")
        return report
    report.check("p1_contract_file_set_loaded")
    _validate_manifest(root, report)
    _validate_schema_headers(root, report)
    _validate_state_machine(root, report)
    _validate_pfam_policy(root, report)
    _validate_runtime_and_commands(root, report)
    _validate_parser_and_hash(root, report)
    return report


def project_contract_root() -> Path:
    return Path(__file__).resolve().parent.parent / "contracts" / "gene-family" / "rc2b2-p1"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate RC2-B.2-P1 contracts")
    parser.add_argument("--contracts", type=Path, default=project_contract_root())
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    report = validate_p1_contracts(args.contracts)
    if args.as_json:
        print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2))
    else:
        print(f"RC2-B.2-P1 contracts: {'PASS' if report.ok else 'FAIL'}")
        print(f"checks={len(report.checks)} errors={len(report.errors)}")
        for error in report.errors:
            print(f"ERROR: {error}")
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
