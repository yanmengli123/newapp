"""Authorize, execute and accept the RC2-B.2-P1 reproducibility Pilot.

All artifacts are create-only packages. Pilot acceptance is deliberately
separate from both Pilot authorization and full-scan authorization.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import tempfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from backend.gene_family_handoff_contracts import sha256_file
from backend.gene_family_hmmer_parser import (
    DOMTBLOUT_FIELDS,
    HmmerParseError,
    canonical_json_sha256,
    command_sha256,
    enrich_domain_records_with_ga,
    parse_hmmer_table,
    read_pfam_ga_thresholds,
    semantic_sha256,
    write_canonical_tsv,
)
from backend.gene_family_p1_contracts import (
    P0_TARGET_MANIFEST_SHA256,
    validate_p1_contracts,
)
from backend.gene_family_pilot_fixtures import validate_pilot_fixture_package
from backend.gene_family_scan_environment import validate_scan_environment_package


AUTHORIZATION_PACKAGE_ID = "rc2b2-p1-pilot-authorization-v001"
AUTHORIZATION_ID = "gg-gf-rc2b2-p1-pilot-authorization-v1"
ACCEPTANCE_PACKAGE_ID = "rc2b2-p1-pilot-acceptance-v001"
ACCEPTANCE_ID = "gg-gf-rc2b2-p1-pilot-acceptance-v1"
FULL_SCAN_PACKAGE_ID = "rc2b2-p1-full-scan-authorization-v001"
FULL_SCAN_DECISION_ID = "gg-gf-rc2b2-p1-full-scan-authorization-v1"
FASTA_HEADER_RE = re.compile(r"^>sha256_([0-9a-f]{64})(?:\s|$)")
HIT_FIELDS = list(DOMTBLOUT_FIELDS) + [
    "description",
    "scan_role",
    "sequence_ga_threshold",
    "domain_ga_threshold",
    "sequence_ga_pass",
    "domain_ga_pass",
]


class PilotWorkflowError(ValueError):
    pass


@dataclass
class PilotWorkflowReport:
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


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def _write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
            allow_nan=False,
        )
        + "\n",
        encoding="utf-8",
    )


def _write_tsv(path: Path, fieldnames: Sequence[str], rows: Iterable[Mapping[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=list(fieldnames),
            delimiter="\t",
            lineterminator="\n",
            extrasaction="raise",
        )
        writer.writeheader()
        writer.writerows(rows)


def _write_checksums(root: Path) -> None:
    paths = sorted(
        (path for path in root.rglob("*") if path.is_file() and path.name != "checksums.sha256"),
        key=lambda path: path.relative_to(root).as_posix(),
    )
    with (root / "checksums.sha256").open("w", encoding="utf-8", newline="\n") as handle:
        for path in paths:
            handle.write(f"{sha256_file(path)}  {path.relative_to(root).as_posix()}\n")


def _verify_checksums(root: Path) -> None:
    manifest = root / "checksums.sha256"
    if not manifest.is_file():
        raise PilotWorkflowError(f"checksum manifest missing: {manifest}")
    seen: set[str] = set()
    for line_number, raw in enumerate(manifest.read_text(encoding="utf-8").splitlines(), 1):
        if not raw:
            continue
        try:
            expected, relative = raw.split("  ", 1)
        except ValueError as exc:
            raise PilotWorkflowError(f"invalid checksum line {line_number}") from exc
        relative_path = Path(relative)
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise PilotWorkflowError(f"unsafe checksum path: {relative}")
        target = root / relative_path
        if not target.is_file() or sha256_file(target) != expected:
            raise PilotWorkflowError(f"checksum mismatch: {relative}")
        if relative in seen:
            raise PilotWorkflowError(f"duplicate checksum record: {relative}")
        seen.add(relative)
    if not seen:
        raise PilotWorkflowError("checksum manifest is empty")


def _atomic_temp(output: Path) -> Path:
    if output.exists():
        raise FileExistsError(f"create-only output already exists: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=f".{output.name}.tmp-", dir=output.parent))


def _commit_or_cleanup(temp: Path, output: Path, error: BaseException | None) -> None:
    if error is None:
        os.replace(temp, output)
    elif temp.exists():
        shutil.rmtree(temp)


def _artifact(path: Path, root: Path, artifact_type: str) -> dict[str, Any]:
    return {
        "artifact_type": artifact_type,
        "relative_path": path.relative_to(root).as_posix(),
        "byte_size": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise PilotWorkflowError(f"cannot load JSON {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise PilotWorkflowError(f"JSON root must be an object: {path}")
    return value


def _read_subject_map(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        if reader.fieldnames is None:
            raise PilotWorkflowError(f"TSV has no header: {path}")
        return list(reader.fieldnames), list(reader)


def _query_names(path: Path) -> set[str]:
    names: set[str] = set()
    with path.open("r", encoding="ascii") as handle:
        for line_number, raw in enumerate(handle, 1):
            if not raw.startswith(">"):
                continue
            match = FASTA_HEADER_RE.match(raw.rstrip("\r\n"))
            if not match:
                raise PilotWorkflowError(f"invalid Pilot FASTA header at {line_number}")
            name = "sha256_" + match.group(1)
            if name in names:
                raise PilotWorkflowError(f"duplicate Pilot FASTA query: {name}")
            names.add(name)
    if not names:
        raise PilotWorkflowError("Pilot FASTA contains no queries")
    return names


def validate_pilot_authorization_package(root: Path) -> PilotWorkflowReport:
    report = PilotWorkflowReport()
    try:
        _verify_checksums(root)
        authorization = _load_json(root / "pilot-authorization.json")
    except PilotWorkflowError as exc:
        report.error(str(exc))
        return report
    report.check("pilot_authorization_checksums_verified")
    if (
        authorization.get("package_id") != AUTHORIZATION_PACKAGE_ID
        or authorization.get("authorization_id") != AUTHORIZATION_ID
        or authorization.get("pilot_run_state") != "authorized"
        or authorization.get("authorization_scope") != "pilot_fixture_set_only"
        or authorization.get("p0_target_manifest_sha256") != P0_TARGET_MANIFEST_SHA256
    ):
        report.error("Pilot authorization identity or scope drift")
    for field in (
        "full_scan_authorized",
        "formal_shadow_authorized",
        "rc2c_build_authorized",
        "api_frontend_switch_authorized",
    ):
        if authorization.get(field) is not False:
            report.error(f"Pilot authorization crosses boundary: {field}")
    if not report.errors:
        report.check("pilot_only_scope_and_boundaries_verified")
    return report


def build_pilot_authorization_package(
    *,
    output: Path,
    environment_root: Path,
    fixture_root: Path,
    contracts_root: Path,
    issued_at_utc: str,
    authorized_by: str,
) -> Path:
    contract_report = validate_p1_contracts(contracts_root)
    environment_report = validate_scan_environment_package(environment_root)
    fixture_report = validate_pilot_fixture_package(fixture_root)
    if not contract_report.ok:
        raise PilotWorkflowError(f"P1 contracts failed: {contract_report.errors}")
    if not environment_report.ok:
        raise PilotWorkflowError(f"scan environment failed: {environment_report.errors}")
    if not fixture_report.ok:
        raise PilotWorkflowError(f"Pilot fixtures failed: {fixture_report.errors}")
    environment_path = environment_root / "scan-environment-manifest.json"
    fixture_path = fixture_root / "pilot-fixture-manifest.json"
    environment = _load_json(environment_path)
    if environment.get("pilot_fixture_manifest_sha256") != sha256_file(fixture_path):
        raise PilotWorkflowError("environment does not bind the frozen fixture manifest")
    parser_contract = contracts_root / "hmmer-output-parser-contract-v1.json"
    semantic_policy = contracts_root / "semantic-hash-policy-v1.json"
    authoritative_hash = environment["scan_commands"]["authoritative"][
        "command_canonical_sha256"
    ]
    diagnostic_hash = environment["scan_commands"]["diagnostic"][
        "command_canonical_sha256"
    ]
    authorization = {
        "schema_version": "1.0",
        "authorization_id": AUTHORIZATION_ID,
        "package_id": AUTHORIZATION_PACKAGE_ID,
        "pilot_run_state": "authorized",
        "authorization_scope": "pilot_fixture_set_only",
        "issued_at_utc": issued_at_utc,
        "authorized_by": authorized_by,
        "scan_environment_manifest_sha256": sha256_file(environment_path),
        "pilot_fixture_manifest_sha256": sha256_file(fixture_path),
        "p0_target_manifest_sha256": P0_TARGET_MANIFEST_SHA256,
        "parser_contract_sha256": sha256_file(parser_contract),
        "semantic_hash_policy_sha256": sha256_file(semantic_policy),
        "authoritative_command_sha256": authoritative_hash,
        "diagnostic_command_sha256": diagnostic_hash,
        "full_scan_authorized": False,
        "formal_shadow_authorized": False,
        "rc2c_build_authorized": False,
        "api_frontend_switch_authorized": False,
    }
    temp = _atomic_temp(output)
    error: BaseException | None = None
    try:
        _write_json(temp / "pilot-authorization.json", authorization)
        (temp / "README.md").write_text(
            "# RC2-B.2-P1 Pilot authorization v001\n\n"
            "This authorization is limited to the frozen eight-execution Pilot "
            "fixture set and the exact environment, parser, semantic hash policy and "
            "commands named by hash. It does not authorize a full scan.\n",
            encoding="utf-8",
        )
        _write_checksums(temp)
    except BaseException as exc:
        error = exc
        raise
    finally:
        _commit_or_cleanup(temp, output, error)
    report = validate_pilot_authorization_package(output)
    if not report.ok:
        raise PilotWorkflowError(f"built Pilot authorization failed: {report.errors}")
    return output


def _execute_scan(
    *,
    role: str,
    inner_argv: list[str],
    output_dir: Path,
    db_dir: Path,
    fixture_root: Path,
    runtime: dict[str, Any],
) -> dict[str, Any]:
    logs = output_dir / "logs"
    logs.mkdir(exist_ok=True)
    container_argv = [
        "docker",
        "run",
        "--rm",
        "--platform",
        runtime["oci_platform"],
        "-e",
        "LC_ALL=C",
        "-e",
        "LANG=C",
        "-e",
        "TZ=UTC",
        "--mount",
        f"type=bind,source={db_dir.resolve()},target=/db,readonly",
        "--mount",
        f"type=bind,source={fixture_root.resolve()},target=/input,readonly",
        "--mount",
        f"type=bind,source={output_dir.resolve()},target=/output",
        "--workdir",
        "/output",
        runtime["immutable_image_reference"],
    ] + inner_argv
    started = _utc_now()
    completed = subprocess.run(
        container_argv,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="strict",
    )
    finished = _utc_now()
    stdout_path = logs / f"{role}.stdout.txt"
    stderr_path = logs / f"{role}.stderr.txt"
    stdout_path.write_text(completed.stdout, encoding="utf-8", newline="\n")
    stderr_path.write_text(completed.stderr, encoding="utf-8", newline="\n")
    if completed.returncode != 0:
        raise PilotWorkflowError(
            f"{role} hmmscan failed with {completed.returncode}: {completed.stderr}"
        )
    return {
        "command_role": role,
        "command_argv": inner_argv,
        "command_text": shlex.join(inner_argv),
        "command_canonical_sha256": command_sha256(inner_argv),
        "stdout_sha256": sha256_file(stdout_path),
        "stderr_sha256": sha256_file(stderr_path),
        "exit_code": completed.returncode,
        "started_at_utc": started,
        "completed_at_utc": finished,
    }


def _status_counts(rows: list[dict[str, Any]]) -> dict[str, Any]:
    counts = Counter(row["status"] for row in rows)
    total = len(rows)
    return {
        "completed_with_hits": counts["completed_with_hits"],
        "completed_no_hits": counts["completed_no_hits"],
        "failed": counts["failed"],
        "not_attempted": counts["not_attempted"],
        "total": total,
        "coverage_percent": 100.0 if total else 0.0,
    }


def _validate_fixture_observations(
    *,
    fixtures: list[dict[str, Any]],
    authoritative: list[dict[str, Any]],
    diagnostic: list[dict[str, Any]],
    subject_rows: list[dict[str, str]],
) -> list[dict[str, Any]]:
    authoritative_by_query: dict[str, list[dict[str, Any]]] = defaultdict(list)
    diagnostic_by_query: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in authoritative:
        authoritative_by_query[record["query_name"]].append(record)
    for record in diagnostic:
        diagnostic_by_query[record["query_name"]].append(record)
    reexpansion = Counter(row["sequence_sha256"] for row in subject_rows)
    observations: list[dict[str, Any]] = []
    for fixture in sorted(fixtures, key=lambda item: item["fixture_id"]):
        query = "sha256_" + fixture["scan_execution_key"]
        auth_records = authoritative_by_query.get(query, [])
        diagnostic_records = diagnostic_by_query.get(query, [])
        auth_accessions = sorted({record["target_accession"] for record in auth_records})
        diagnostic_accessions = sorted(
            {record["target_accession"] for record in diagnostic_records}
        )
        observed_auth_outcome = (
            "reported_hits_expected" if auth_records else "no_reported_hits_expected"
        )
        observed_diagnostic_outcome = (
            "reported_hits_expected"
            if diagnostic_records
            else "no_reported_hits_expected"
        )
        expected = set(fixture["expected_pfam_accessions"])
        forbidden = set(fixture["must_not_report_accessions"])
        expected_present = expected.issubset(auth_accessions)
        forbidden_absent = forbidden.isdisjoint(auth_accessions)
        reexpansion_ok = (
            reexpansion[fixture["scan_execution_key"]]
            == fixture["expected_reexpansion_count"]
        )
        passed = (
            observed_auth_outcome
            == fixture["expected_authoritative_scan_outcome"]
            and observed_diagnostic_outcome
            == fixture["expected_diagnostic_scan_outcome"]
            and expected_present
            and forbidden_absent
            and reexpansion_ok
        )
        observations.append(
            {
                "fixture_id": fixture["fixture_id"],
                "scientific_subject_key": fixture["scientific_subject_key"],
                "scan_execution_key": fixture["scan_execution_key"],
                "observed_authoritative_scan_outcome": observed_auth_outcome,
                "observed_diagnostic_scan_outcome": observed_diagnostic_outcome,
                "observed_authoritative_pfam_accessions": ",".join(auth_accessions),
                "observed_diagnostic_pfam_accessions": ",".join(diagnostic_accessions),
                "expected_accessions_present": str(expected_present).lower(),
                "must_not_report_accessions_absent": str(forbidden_absent).lower(),
                "observed_reexpansion_count": reexpansion[
                    fixture["scan_execution_key"]
                ],
                "expected_reexpansion_count": fixture["expected_reexpansion_count"],
                "passed": str(passed).lower(),
            }
        )
    failures = [row["fixture_id"] for row in observations if row["passed"] != "true"]
    if failures:
        raise PilotWorkflowError(f"Pilot fixture expectations failed: {failures}")
    return observations


def validate_pilot_run_package(root: Path) -> PilotWorkflowReport:
    report = PilotWorkflowReport()
    try:
        _verify_checksums(root)
        manifest = _load_json(root / "pilot-run-manifest.json")
    except PilotWorkflowError as exc:
        report.error(str(exc))
        return report
    report.check("pilot_run_checksums_verified")
    if (
        manifest.get("pilot_run_state") != "completed"
        or manifest.get("p0_target_manifest_sha256") != P0_TARGET_MANIFEST_SHA256
        or manifest.get("rejected_record_count") != 0
        or manifest.get("source_modification_count") != 0
        or manifest.get("full_scan_authorized") is not False
    ):
        report.error("Pilot run state, rejection, source or authorization gate failed")
    for denominator in ("execution_counts", "subject_counts"):
        counts = manifest.get(denominator, {})
        if (
            counts.get("failed") != 0
            or counts.get("not_attempted") != 0
            or counts.get("coverage_percent") != 100.0
        ):
            report.error(f"Pilot run status coverage failed: {denominator}")
    if not report.errors:
        report.check("pilot_run_status_and_boundary_gates_verified")
    return report


def run_pilot(
    *,
    run_label: str,
    output: Path,
    environment_root: Path,
    fixture_root: Path,
    authorization_root: Path,
    contracts_root: Path,
) -> Path:
    if run_label not in {"a", "b"}:
        raise ValueError("run_label must be 'a' or 'b'")
    contract_report = validate_p1_contracts(contracts_root)
    environment_report = validate_scan_environment_package(environment_root)
    fixture_report = validate_pilot_fixture_package(fixture_root)
    authorization_report = validate_pilot_authorization_package(authorization_root)
    for name, report in (
        ("contracts", contract_report),
        ("environment", environment_report),
        ("fixtures", fixture_report),
        ("authorization", authorization_report),
    ):
        if not report.ok:
            raise PilotWorkflowError(f"{name} validation failed: {report.errors}")
    environment_path = environment_root / "scan-environment-manifest.json"
    fixture_path = fixture_root / "pilot-fixture-manifest.json"
    authorization_path = authorization_root / "pilot-authorization.json"
    environment = _load_json(environment_path)
    fixture = _load_json(fixture_path)
    authorization = _load_json(authorization_path)
    bindings = {
        "scan_environment_manifest_sha256": sha256_file(environment_path),
        "pilot_fixture_manifest_sha256": sha256_file(fixture_path),
        "parser_contract_sha256": sha256_file(
            contracts_root / "hmmer-output-parser-contract-v1.json"
        ),
        "semantic_hash_policy_sha256": sha256_file(
            contracts_root / "semantic-hash-policy-v1.json"
        ),
    }
    for field, observed in bindings.items():
        if authorization.get(field) != observed:
            raise PilotWorkflowError(f"Pilot authorization binding drift: {field}")
    command_policy = _load_json(contracts_root / "scan-command-policy-v1.json")
    authoritative_argv = command_policy["authoritative"]["command_argv"]
    diagnostic_argv = command_policy["pilot_diagnostic"]["command_argv"]
    if authorization["authoritative_command_sha256"] != command_sha256(
        authoritative_argv
    ) or authorization["diagnostic_command_sha256"] != command_sha256(diagnostic_argv):
        raise PilotWorkflowError("authorized scan command hash drift")
    parser_impl = Path(__file__).with_name("gene_family_hmmer_parser.py")
    source_hashes = {
        path: sha256_file(path)
        for path in (
            environment_root / "checksums.sha256",
            fixture_root / "checksums.sha256",
            authorization_root / "checksums.sha256",
            environment_path,
            fixture_path,
            authorization_path,
        )
    }
    db_dir = (
        environment_root
        / "derived"
        / ("press-run-a" if run_label == "a" else "press-run-b")
    )
    temp = _atomic_temp(output)
    error: BaseException | None = None
    started = _utc_now()
    try:
        commands = [
            _execute_scan(
                role="authoritative",
                inner_argv=authoritative_argv,
                output_dir=temp,
                db_dir=db_dir,
                fixture_root=fixture_root,
                runtime=environment["runtime"],
            ),
            _execute_scan(
                role="diagnostic",
                inner_argv=diagnostic_argv,
                output_dir=temp,
                db_dir=db_dir,
                fixture_root=fixture_root,
                runtime=environment["runtime"],
            ),
        ]
        model_thresholds = read_pfam_ga_thresholds(db_dir / "Pfam-A.hmm")
        model_accessions = set(model_thresholds)
        queries = _query_names(fixture_root / "pilot.fasta")
        rejected_path = temp / "rejected-records.tsv"
        try:
            authoritative_tbl = parse_hmmer_table(
                temp / "authoritative.tblout",
                format_name="tblout",
                model_accessions=model_accessions,
                query_names=queries,
            )
            authoritative_dom = parse_hmmer_table(
                temp / "authoritative.domtblout",
                format_name="domtblout",
                model_accessions=model_accessions,
                query_names=queries,
            )
            diagnostic_tbl = parse_hmmer_table(
                temp / "diagnostic.tblout",
                format_name="tblout",
                model_accessions=model_accessions,
                query_names=queries,
            )
            diagnostic_dom = parse_hmmer_table(
                temp / "diagnostic.domtblout",
                format_name="domtblout",
                model_accessions=model_accessions,
                query_names=queries,
            )
        except HmmerParseError as exc:
            _write_tsv(
                rejected_path,
                ["source_path", "line_number", "reason_code", "message", "raw_line"],
                [exc.as_record()],
            )
            raise
        _write_tsv(
            rejected_path,
            ["source_path", "line_number", "reason_code", "message", "raw_line"],
            [],
        )
        if not set(record["query_name"] for record in authoritative_tbl.records).issubset(
            queries
        ) or not set(record["query_name"] for record in diagnostic_tbl.records).issubset(
            queries
        ):
            raise PilotWorkflowError("tblout query set escaped the Pilot")
        authoritative = enrich_domain_records_with_ga(
            authoritative_dom.records,
            model_thresholds,
            scan_role="authoritative",
        )
        diagnostic_all = enrich_domain_records_with_ga(
            diagnostic_dom.records,
            model_thresholds,
            scan_role="diagnostic",
        )
        score_floor = Decimal(
            command_policy["pilot_diagnostic"]["approved_postparse_domain_score_floor"]
        )
        diagnostic = [
            record for record in diagnostic_all if record["domain_score"] >= score_floor
        ]
        below_ga = [
            record
            for record in diagnostic
            if not (record["sequence_ga_pass"] and record["domain_ga_pass"])
        ]
        authoritative_tsv = temp / "raw-authoritative-ga-hits.tsv"
        diagnostic_tsv = temp / "reported-diagnostic-hits.tsv"
        below_ga_tsv = temp / "reported-below-ga-hits.tsv"
        write_canonical_tsv(authoritative_tsv, authoritative, HIT_FIELDS)
        write_canonical_tsv(diagnostic_tsv, diagnostic, HIT_FIELDS)
        write_canonical_tsv(below_ga_tsv, below_ga, HIT_FIELDS)

        auth_counts = Counter(record["query_name"] for record in authoritative)
        diagnostic_counts = Counter(record["query_name"] for record in diagnostic)
        execution_rows: list[dict[str, Any]] = []
        for query in sorted(queries):
            digest = query.removeprefix("sha256_")
            status = (
                "completed_with_hits" if auth_counts[query] else "completed_no_hits"
            )
            execution_rows.append(
                {
                    "scan_execution_key": digest,
                    "query_name": query,
                    "status": status,
                    "authoritative_domain_hit_count": auth_counts[query],
                    "diagnostic_domain_hit_count": diagnostic_counts[query],
                }
            )
        subject_fields, subject_source_rows = _read_subject_map(
            fixture_root / "pilot-subject-map.tsv"
        )
        execution_status_by_key = {
            row["scan_execution_key"]: row["status"] for row in execution_rows
        }
        subject_rows: list[dict[str, Any]] = []
        for source in sorted(
            subject_source_rows, key=lambda row: row["scientific_subject_key"]
        ):
            digest = source["sequence_sha256"]
            if digest not in execution_status_by_key:
                raise PilotWorkflowError(f"subject maps outside Pilot execution set: {digest}")
            subject_rows.append(
                {
                    "scientific_subject_key": source["scientific_subject_key"],
                    "protein_accession_version": source["protein_accession_version"],
                    "stable_gene_id": source["stable_gene_id"],
                    "gene_symbol": source["gene_symbol"],
                    "scan_execution_key": digest,
                    "status": execution_status_by_key[digest],
                    "authoritative_domain_hit_count": auth_counts[
                        "sha256_" + digest
                    ],
                    "diagnostic_domain_hit_count": diagnostic_counts[
                        "sha256_" + digest
                    ],
                }
            )
        execution_status_path = temp / "scan-execution-status.tsv"
        subject_status_path = temp / "scan-subject-status.tsv"
        _write_tsv(
            execution_status_path,
            [
                "scan_execution_key",
                "query_name",
                "status",
                "authoritative_domain_hit_count",
                "diagnostic_domain_hit_count",
            ],
            execution_rows,
        )
        _write_tsv(
            subject_status_path,
            [
                "scientific_subject_key",
                "protein_accession_version",
                "stable_gene_id",
                "gene_symbol",
                "scan_execution_key",
                "status",
                "authoritative_domain_hit_count",
                "diagnostic_domain_hit_count",
            ],
            subject_rows,
        )
        observations = _validate_fixture_observations(
            fixtures=fixture["fixtures"],
            authoritative=authoritative,
            diagnostic=diagnostic,
            subject_rows=subject_source_rows,
        )
        observation_path = temp / "fixture-observations.tsv"
        _write_tsv(
            observation_path,
            [
                "fixture_id",
                "scientific_subject_key",
                "scan_execution_key",
                "observed_authoritative_scan_outcome",
                "observed_diagnostic_scan_outcome",
                "observed_authoritative_pfam_accessions",
                "observed_diagnostic_pfam_accessions",
                "expected_accessions_present",
                "must_not_report_accessions_absent",
                "observed_reexpansion_count",
                "expected_reexpansion_count",
                "passed",
            ],
            observations,
        )
        for path, digest in source_hashes.items():
            if sha256_file(path) != digest:
                raise PilotWorkflowError(f"Pilot input changed during run: {path}")
        completed_at = _utc_now()
        output_hashes = {
            "authoritative_semantic_sha256": semantic_sha256(authoritative),
            "diagnostic_semantic_sha256": semantic_sha256(diagnostic),
            "authoritative_canonical_sha256": sha256_file(authoritative_tsv),
            "diagnostic_canonical_sha256": sha256_file(diagnostic_tsv),
            "execution_status_semantic_sha256": canonical_json_sha256(execution_rows),
            "subject_status_semantic_sha256": canonical_json_sha256(subject_rows),
        }
        artifact_roles = {
            "authoritative.main.out": "authoritative_main_output",
            "authoritative.tblout": "authoritative_tblout",
            "authoritative.domtblout": "authoritative_domtblout",
            "diagnostic.main.out": "diagnostic_main_output",
            "diagnostic.tblout": "diagnostic_tblout",
            "diagnostic.domtblout": "diagnostic_domtblout",
            "raw-authoritative-ga-hits.tsv": "raw_authoritative_ga_hits",
            "reported-diagnostic-hits.tsv": "reported_diagnostic_hits",
            "reported-below-ga-hits.tsv": "reported_below_ga_hits",
            "scan-execution-status.tsv": "scan_execution_status",
            "scan-subject-status.tsv": "scan_subject_status",
            "fixture-observations.tsv": "fixture_observations",
            "rejected-records.tsv": "rejected_records",
            "logs/authoritative.stdout.txt": "authoritative_stdout",
            "logs/authoritative.stderr.txt": "authoritative_stderr",
            "logs/diagnostic.stdout.txt": "diagnostic_stdout",
            "logs/diagnostic.stderr.txt": "diagnostic_stderr",
        }
        artifacts = [
            _artifact(temp / relative, temp, artifact_type)
            for relative, artifact_type in artifact_roles.items()
        ]
        run_id = f"pilot-run-{run_label}"
        package_id = f"rc2b2-p1-pilot-run-{run_label}"
        manifest = {
            "schema_version": "1.0",
            "run_id": run_id,
            "package_id": package_id,
            "pilot_run_state": "completed",
            "started_at_utc": started,
            "completed_at_utc": completed_at,
            "p0_target_manifest_sha256": P0_TARGET_MANIFEST_SHA256,
            "scan_environment_manifest_sha256": sha256_file(environment_path),
            "pilot_fixture_manifest_sha256": sha256_file(fixture_path),
            "pilot_authorization_sha256": sha256_file(authorization_path),
            "parser_contract_sha256": bindings["parser_contract_sha256"],
            "parser_implementation_sha256": sha256_file(parser_impl),
            "semantic_hash_policy_sha256": bindings["semantic_hash_policy_sha256"],
            "commands": commands,
            "execution_counts": _status_counts(execution_rows),
            "subject_counts": _status_counts(subject_rows),
            "output_hashes": output_hashes,
            "artifacts": artifacts,
            "rejected_record_count": 0,
            "source_modification_count": 0,
            "clan_resolution_state": "not_applied",
            "full_scan_authorized": False,
        }
        _write_json(temp / "pilot-run-manifest.json", manifest)
        _write_checksums(temp)
    except BaseException as exc:
        error = exc
        raise
    finally:
        _commit_or_cleanup(temp, output, error)
    report = validate_pilot_run_package(output)
    if not report.ok:
        raise PilotWorkflowError(f"built Pilot run failed: {report.errors}")
    return output


def _read_observation_passes(path: Path) -> bool:
    with path.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle, delimiter="\t"))
    return bool(rows) and all(row.get("passed") == "true" for row in rows)


def validate_pilot_acceptance_package(root: Path) -> PilotWorkflowReport:
    report = PilotWorkflowReport()
    try:
        _verify_checksums(root)
        acceptance = _load_json(root / "pilot-acceptance.json")
    except PilotWorkflowError as exc:
        report.error(str(exc))
        return report
    report.check("pilot_acceptance_checksums_verified")
    gates = acceptance.get("gate_results", [])
    if (
        acceptance.get("pilot_acceptance_state") != "passed"
        or acceptance.get("decision") != "accept_pilot_only"
        or not isinstance(gates, list)
        or not gates
        or any(item.get("passed") is not True for item in gates)
    ):
        report.error("Pilot acceptance decision or gates failed")
    for field in (
        "full_scan_authorized",
        "formal_shadow_authorized",
        "rc2c_build_authorized",
        "api_frontend_switch_authorized",
    ):
        if acceptance.get(field) is not False:
            report.error(f"Pilot acceptance crosses authorization boundary: {field}")
    if not report.errors:
        report.check("pilot_acceptance_and_boundary_gates_verified")
    return report


def build_pilot_acceptance_package(
    *,
    output: Path,
    environment_root: Path,
    fixture_root: Path,
    authorization_root: Path,
    run_a_root: Path,
    run_b_root: Path,
    reviewer: str,
    decided_at_utc: str,
) -> Path:
    for name, report in (
        ("environment", validate_scan_environment_package(environment_root)),
        ("fixtures", validate_pilot_fixture_package(fixture_root)),
        ("authorization", validate_pilot_authorization_package(authorization_root)),
        ("run-a", validate_pilot_run_package(run_a_root)),
        ("run-b", validate_pilot_run_package(run_b_root)),
    ):
        if not report.ok:
            raise PilotWorkflowError(f"{name} failed before acceptance: {report.errors}")
    env_path = environment_root / "scan-environment-manifest.json"
    fixture_path = fixture_root / "pilot-fixture-manifest.json"
    auth_path = authorization_root / "pilot-authorization.json"
    run_a_path = run_a_root / "pilot-run-manifest.json"
    run_b_path = run_b_root / "pilot-run-manifest.json"
    env = _load_json(env_path)
    run_a = _load_json(run_a_path)
    run_b = _load_json(run_b_path)
    if run_a["scan_environment_manifest_sha256"] != sha256_file(
        env_path
    ) or run_b["scan_environment_manifest_sha256"] != sha256_file(env_path):
        raise PilotWorkflowError("Pilot runs do not bind the accepted environment")
    semantic_fields = [
        "authoritative_semantic_sha256",
        "diagnostic_semantic_sha256",
        "execution_status_semantic_sha256",
        "subject_status_semantic_sha256",
    ]
    canonical_fields = [
        "authoritative_canonical_sha256",
        "diagnostic_canonical_sha256",
    ]
    semantic_equal = sum(
        run_a["output_hashes"][field] == run_b["output_hashes"][field]
        for field in semantic_fields
    )
    canonical_equal = sum(
        run_a["output_hashes"][field] == run_b["output_hashes"][field]
        for field in canonical_fields
    )
    a_observations = _read_observation_passes(run_a_root / "fixture-observations.tsv")
    b_observations = _read_observation_passes(run_b_root / "fixture-observations.tsv")
    gates_raw = [
        ("environment_frozen", env["scan_environment_state"], "frozen"),
        ("official_pfam_verified", all(item["verification_status"] in {"official_md5_verified", "release_identity_anchor"} for item in env["official_assets"]), True),
        ("pressed_indexes_reproducible", sum(item["hashes_equal"] for item in env["pressed_index_reproducibility"]), 4),
        ("run_a_completed", run_a["pilot_run_state"], "completed"),
        ("run_b_completed", run_b["pilot_run_state"], "completed"),
        ("run_a_execution_failed", run_a["execution_counts"]["failed"], 0),
        ("run_b_execution_failed", run_b["execution_counts"]["failed"], 0),
        ("run_a_execution_not_attempted", run_a["execution_counts"]["not_attempted"], 0),
        ("run_b_execution_not_attempted", run_b["execution_counts"]["not_attempted"], 0),
        ("run_a_subject_coverage", run_a["subject_counts"]["coverage_percent"], 100.0),
        ("run_b_subject_coverage", run_b["subject_counts"]["coverage_percent"], 100.0),
        ("run_a_rejected_records", run_a["rejected_record_count"], 0),
        ("run_b_rejected_records", run_b["rejected_record_count"], 0),
        ("fixture_expectations_run_a", a_observations, True),
        ("fixture_expectations_run_b", b_observations, True),
        ("semantic_hashes_identical", semantic_equal, len(semantic_fields)),
        ("canonical_hashes_identical", canonical_equal, len(canonical_fields)),
        ("raw_input_modifications_run_a", run_a["source_modification_count"], 0),
        ("raw_input_modifications_run_b", run_b["source_modification_count"], 0),
        ("full_scan_remains_unauthorized", False, False),
    ]
    gate_results = [
        {
            "gate_id": gate_id,
            "passed": observed == required,
            "observed": observed,
            "required": required,
        }
        for gate_id, observed, required in gates_raw
    ]
    passed = all(item["passed"] for item in gate_results)
    if not passed:
        failed = [item["gate_id"] for item in gate_results if not item["passed"]]
        raise PilotWorkflowError(f"Pilot acceptance gates failed: {failed}")
    acceptance = {
        "schema_version": "1.0",
        "acceptance_id": ACCEPTANCE_ID,
        "package_id": ACCEPTANCE_PACKAGE_ID,
        "pilot_acceptance_state": "passed",
        "decided_at_utc": decided_at_utc,
        "reviewer": reviewer,
        "p0_target_manifest_sha256": P0_TARGET_MANIFEST_SHA256,
        "scan_environment_manifest_sha256": sha256_file(env_path),
        "pilot_fixture_manifest_sha256": sha256_file(fixture_path),
        "pilot_authorization_sha256": sha256_file(auth_path),
        "run_a_manifest_sha256": sha256_file(run_a_path),
        "run_b_manifest_sha256": sha256_file(run_b_path),
        "gate_results": gate_results,
        "semantic_hash_comparison": {
            "compared": len(semantic_fields),
            "identical_percent": 100.0 * semantic_equal / len(semantic_fields),
        },
        "canonical_hash_comparison": {
            "compared": len(canonical_fields),
            "identical_percent": 100.0 * canonical_equal / len(canonical_fields),
        },
        "known_limitations": [
            "The Pilot contains eight scan executions and is not the 3,525-execution full target universe.",
            "Diagnostic results claim only non_exhaustive_reported_hits and cannot independently support accepted assertions.",
            "Raw GA hits have not been transformed into clan-resolved domain architecture.",
            "Pilot acceptance does not authorize a full scan, Formal Shadow 1, RC2-C, database rebuild, API switch or frontend statistics switch."
        ],
        "decision": "accept_pilot_only",
        "full_scan_authorized": False,
        "formal_shadow_authorized": False,
        "rc2c_build_authorized": False,
        "api_frontend_switch_authorized": False,
    }
    temp = _atomic_temp(output)
    error: BaseException | None = None
    try:
        _write_json(temp / "pilot-acceptance.json", acceptance)
        (temp / "README.md").write_text(
            "# RC2-B.2-P1 Pilot acceptance v001\n\n"
            "Two independent Pilot processes passed all engineering, denominator, "
            "parser, fixture and semantic reproducibility gates. The decision accepts "
            "the Pilot only and does not authorize a full scan.\n",
            encoding="utf-8",
        )
        _write_checksums(temp)
    except BaseException as exc:
        error = exc
        raise
    finally:
        _commit_or_cleanup(temp, output, error)
    report = validate_pilot_acceptance_package(output)
    if not report.ok:
        raise PilotWorkflowError(f"built Pilot acceptance failed: {report.errors}")
    return output


def build_full_scan_no_authorization_package(
    *,
    output: Path,
    acceptance_root: Path,
    decided_at_utc: str,
    decided_by: str,
) -> Path:
    acceptance_report = validate_pilot_acceptance_package(acceptance_root)
    if not acceptance_report.ok:
        raise PilotWorkflowError(f"Pilot acceptance failed: {acceptance_report.errors}")
    acceptance_path = acceptance_root / "pilot-acceptance.json"
    decision = {
        "schema_version": "1.0",
        "decision_id": FULL_SCAN_DECISION_ID,
        "package_id": FULL_SCAN_PACKAGE_ID,
        "decided_at_utc": decided_at_utc,
        "decided_by": decided_by,
        "pilot_acceptance_sha256": sha256_file(acceptance_path),
        "p0_target_manifest_sha256": P0_TARGET_MANIFEST_SHA256,
        "full_scan_authorized": False,
        "decision": "not_authorized",
        "blocking_reasons": [
            "Pilot acceptance is an engineering reproducibility result and does not imply full-scan authorization.",
            "No independent project-owner authorization has been issued for the 3,525-execution / 4,571-subject full scan.",
            "Formal Shadow 1, RC2-C and API/frontend publication remain outside the authorized P1 scope."
        ],
        "formal_shadow_authorized": False,
        "rc2c_build_authorized": False,
        "api_frontend_switch_authorized": False,
    }
    temp = _atomic_temp(output)
    error: BaseException | None = None
    try:
        _write_json(temp / "full-scan-authorization.json", decision)
        (temp / "README.md").write_text(
            "# RC2-B.2-P1 full-scan decision v001\n\n"
            "The full targeted scan remains explicitly not authorized.\n",
            encoding="utf-8",
        )
        _write_checksums(temp)
    except BaseException as exc:
        error = exc
        raise
    finally:
        _commit_or_cleanup(temp, output, error)
    return output


def project_paths() -> dict[str, Path]:
    project_root = Path(__file__).resolve().parent.parent
    analysis = Path(r"D:\jbrowsedata\projectdata\gene family\analysis")
    return {
        "contracts": project_root / "contracts" / "gene-family" / "rc2b2-p1",
        "environment": analysis / "rc2b2-p1-scan-environment-v001",
        "fixtures": analysis / "rc2b2-p1-pilot-fixtures-v001",
        "authorization": analysis / "rc2b2-p1-pilot-authorization-v001",
        "run_a": analysis / "rc2b2-p1-pilot-run-a",
        "run_b": analysis / "rc2b2-p1-pilot-run-b",
        "acceptance": analysis / "rc2b2-p1-pilot-acceptance-v001",
        "full_scan": analysis / "rc2b2-p1-full-scan-authorization-v001",
    }


def main(argv: list[str] | None = None) -> int:
    defaults = project_paths()
    parser = argparse.ArgumentParser(description="RC2-B.2-P1 Pilot workflow")
    subparsers = parser.add_subparsers(dest="action", required=True)
    authorize = subparsers.add_parser("authorize")
    authorize.add_argument("--output", type=Path, default=defaults["authorization"])
    authorize.add_argument("--environment", type=Path, default=defaults["environment"])
    authorize.add_argument("--fixtures", type=Path, default=defaults["fixtures"])
    authorize.add_argument("--contracts", type=Path, default=defaults["contracts"])
    authorize.add_argument("--issued-at-utc", required=True)
    authorize.add_argument("--authorized-by", required=True)
    run = subparsers.add_parser("run")
    run.add_argument("--run-label", choices=["a", "b"], required=True)
    run.add_argument("--output", type=Path, required=True)
    run.add_argument("--environment", type=Path, default=defaults["environment"])
    run.add_argument("--fixtures", type=Path, default=defaults["fixtures"])
    run.add_argument("--authorization", type=Path, default=defaults["authorization"])
    run.add_argument("--contracts", type=Path, default=defaults["contracts"])
    accept = subparsers.add_parser("accept")
    accept.add_argument("--output", type=Path, default=defaults["acceptance"])
    accept.add_argument("--environment", type=Path, default=defaults["environment"])
    accept.add_argument("--fixtures", type=Path, default=defaults["fixtures"])
    accept.add_argument("--authorization", type=Path, default=defaults["authorization"])
    accept.add_argument("--run-a", type=Path, default=defaults["run_a"])
    accept.add_argument("--run-b", type=Path, default=defaults["run_b"])
    accept.add_argument("--reviewer", required=True)
    accept.add_argument("--decided-at-utc", required=True)
    full = subparsers.add_parser("record-full-scan-no-authorization")
    full.add_argument("--output", type=Path, default=defaults["full_scan"])
    full.add_argument("--acceptance", type=Path, default=defaults["acceptance"])
    full.add_argument("--decided-at-utc", required=True)
    full.add_argument("--decided-by", required=True)
    args = parser.parse_args(argv)
    if args.action == "authorize":
        output = build_pilot_authorization_package(
            output=args.output,
            environment_root=args.environment,
            fixture_root=args.fixtures,
            contracts_root=args.contracts,
            issued_at_utc=args.issued_at_utc,
            authorized_by=args.authorized_by,
        )
        report = validate_pilot_authorization_package(output)
    elif args.action == "run":
        output = run_pilot(
            run_label=args.run_label,
            output=args.output,
            environment_root=args.environment,
            fixture_root=args.fixtures,
            authorization_root=args.authorization,
            contracts_root=args.contracts,
        )
        report = validate_pilot_run_package(output)
    elif args.action == "accept":
        output = build_pilot_acceptance_package(
            output=args.output,
            environment_root=args.environment,
            fixture_root=args.fixtures,
            authorization_root=args.authorization,
            run_a_root=args.run_a,
            run_b_root=args.run_b,
            reviewer=args.reviewer,
            decided_at_utc=args.decided_at_utc,
        )
        report = validate_pilot_acceptance_package(output)
    else:
        output = build_full_scan_no_authorization_package(
            output=args.output,
            acceptance_root=args.acceptance,
            decided_at_utc=args.decided_at_utc,
            decided_by=args.decided_by,
        )
        report = PilotWorkflowReport(checks=["full_scan_explicitly_not_authorized"])
    print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2))
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
