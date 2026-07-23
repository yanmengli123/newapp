"""Build and validate the immutable RC2-B.2-P1 Pilot fixture package."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import tempfile
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from backend.gene_family_handoff_contracts import sha256_file
from backend.gene_family_hmmer_parser import (
    canonical_json_sha256,
    read_pfam_ga_thresholds,
)
from backend.gene_family_p1_contracts import (
    P0_TARGET_MANIFEST_SHA256,
    validate_p1_contracts,
)


PACKAGE_ID = "rc2b2-p1-pilot-fixtures-v001"
FIXTURE_SET_ID = "gg-gf-pfam35-pilot-fixtures-v1"
FASTA_NAME_RE = re.compile(r"^sha256_([0-9a-f]{64})(?:\s|$)")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class PilotFixtureError(ValueError):
    pass


@dataclass
class PilotFixtureReport:
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


def _write_tsv(path: Path, fieldnames: list[str], rows: Iterable[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=fieldnames,
            delimiter="\t",
            lineterminator="\n",
            extrasaction="raise",
        )
        writer.writeheader()
        writer.writerows(rows)


def _artifact(
    path: Path, *, artifact_type: str, logical_locator: str
) -> dict[str, Any]:
    return {
        "artifact_type": artifact_type,
        "logical_locator": logical_locator,
        "byte_size": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def _read_checksum_manifest(root: Path) -> None:
    path = root / "checksums.sha256"
    if not path.is_file():
        raise PilotFixtureError(f"checksum manifest missing: {path}")
    seen: set[str] = set()
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw:
            continue
        try:
            expected, relative = raw.split("  ", 1)
        except ValueError as exc:
            raise PilotFixtureError(
                f"invalid checksum line {line_number}: {raw!r}"
            ) from exc
        relative_path = Path(relative)
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise PilotFixtureError(f"unsafe checksum path: {relative}")
        target = root / relative_path
        if not target.is_file() or sha256_file(target) != expected:
            raise PilotFixtureError(f"checksum mismatch: {relative}")
        if relative in seen:
            raise PilotFixtureError(f"duplicate checksum path: {relative}")
        seen.add(relative)
    if not seen:
        raise PilotFixtureError("checksum manifest is empty")


def _source_tree_hashes(paths: Iterable[Path]) -> dict[Path, str]:
    return {path: sha256_file(path) for path in paths}


def _assert_source_hashes(hashes: dict[Path, str]) -> None:
    changed = [str(path) for path, digest in hashes.items() if sha256_file(path) != digest]
    if changed:
        raise PilotFixtureError(f"source artifacts changed during fixture build: {changed}")


def _read_fasta(path: Path) -> dict[str, str]:
    records: dict[str, str] = {}
    current: str | None = None
    chunks: list[str] = []

    def commit() -> None:
        nonlocal current, chunks
        if current is None:
            return
        sequence = "".join(chunks).upper()
        if not sequence or not re.fullmatch(r"[A-Z*]+", sequence):
            raise PilotFixtureError(f"invalid FASTA sequence for {current}")
        observed = hashlib.sha256(sequence.encode("ascii")).hexdigest()
        if observed != current:
            raise PilotFixtureError(f"FASTA sequence hash mismatch: {current}")
        records[current] = sequence
        current = None
        chunks = []

    with path.open("r", encoding="ascii") as handle:
        for line_number, raw in enumerate(handle, 1):
            line = raw.strip()
            if not line:
                continue
            if line.startswith(">"):
                commit()
                match = FASTA_NAME_RE.match(line[1:])
                if not match:
                    raise PilotFixtureError(f"invalid FASTA header at line {line_number}")
                current = match.group(1)
                if current in records:
                    raise PilotFixtureError(f"duplicate FASTA execution: {current}")
            elif current is None:
                raise PilotFixtureError(f"sequence before FASTA header at line {line_number}")
            else:
                chunks.append(line)
    commit()
    if not records:
        raise PilotFixtureError("target FASTA is empty")
    return records


def _read_subject_map(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        if reader.fieldnames is None:
            raise PilotFixtureError("scan subject map has no header")
        rows = list(reader)
        fieldnames = list(reader.fieldnames)
    required = {
        "scientific_subject_key",
        "protein_accession_version",
        "stable_gene_id",
        "gene_symbol",
        "sequence_sha256",
        "sequence_length",
        "shared_sequence_subject_count",
    }
    if not required.issubset(fieldnames):
        raise PilotFixtureError("scan subject map lacks required columns")
    return fieldnames, rows


def _read_legacy_evidence(
    path: Path, selected_subjects: set[str]
) -> tuple[list[str], list[dict[str, str]]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        if reader.fieldnames is None:
            raise PilotFixtureError("legacy Pfam evidence has no header")
        rows = [row for row in reader if row.get("protein_id") in selected_subjects]
        return list(reader.fieldnames), rows


def _write_fasta(path: Path, sequences: dict[str, str]) -> None:
    with path.open("w", encoding="ascii", newline="\n") as handle:
        for digest in sorted(sequences):
            sequence = sequences[digest]
            handle.write(f">sha256_{digest}\n")
            for start in range(0, len(sequence), 60):
                handle.write(sequence[start : start + 60] + "\n")


def _write_checksums(root: Path) -> None:
    paths = sorted(
        (path for path in root.rglob("*") if path.is_file() and path.name != "checksums.sha256"),
        key=lambda path: path.relative_to(root).as_posix(),
    )
    payload = "".join(
        f"{sha256_file(path)}  {path.relative_to(root).as_posix()}\n" for path in paths
    )
    (root / "checksums.sha256").write_text(payload, encoding="utf-8", newline="\n")


def build_pilot_fixture_package(
    *,
    output: Path,
    p0_root: Path,
    legacy_pfam_hits: Path,
    pfam_hmm: Path,
    contracts_root: Path,
    created_at_utc: str,
) -> Path:
    if output.exists():
        raise FileExistsError(f"create-only Pilot fixture package already exists: {output}")
    contract_report = validate_p1_contracts(contracts_root)
    if not contract_report.ok:
        raise PilotFixtureError(f"P1 contracts failed: {contract_report.errors}")
    target_manifest = p0_root / "target-universe" / "target-universe-manifest.json"
    target_fasta = p0_root / "target-universe" / "target-scan-executions.fasta"
    subject_map_path = p0_root / "target-universe" / "scan-subject-map.tsv"
    required_sources = [
        target_manifest,
        target_fasta,
        subject_map_path,
        legacy_pfam_hits,
        pfam_hmm,
        contracts_root / "pilot-fixture-selection-v1.json",
    ]
    missing = [str(path) for path in required_sources if not path.is_file()]
    if missing:
        raise PilotFixtureError(f"fixture source artifacts missing: {missing}")
    _read_checksum_manifest(p0_root)
    if sha256_file(target_manifest) != P0_TARGET_MANIFEST_SHA256:
        raise PilotFixtureError("P0 target manifest hash drift")
    source_hashes = _source_tree_hashes(required_sources)
    selection = json.loads(
        (contracts_root / "pilot-fixture-selection-v1.json").read_text(encoding="utf-8")
    )
    if selection.get("p0_target_manifest_sha256") != P0_TARGET_MANIFEST_SHA256:
        raise PilotFixtureError("fixture selection does not bind P0")
    selections = selection.get("fixtures")
    if not isinstance(selections, list) or not selections:
        raise PilotFixtureError("fixture selection is empty")
    selected_subjects = {item["scientific_subject_key"] for item in selections}
    if len(selected_subjects) != len(selections):
        raise PilotFixtureError("duplicate selected scientific subject")
    sequences = _read_fasta(target_fasta)
    subject_fields, subject_rows = _read_subject_map(subject_map_path)
    by_subject = {row["scientific_subject_key"]: row for row in subject_rows}
    if len(by_subject) != len(subject_rows):
        raise PilotFixtureError("duplicate subject in P0 scan subject map")
    missing_subjects = sorted(selected_subjects - set(by_subject))
    if missing_subjects:
        raise PilotFixtureError(f"selected subjects absent from P0: {missing_subjects}")
    subjects_by_sequence: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in subject_rows:
        subjects_by_sequence[row["sequence_sha256"]].append(row)
    legacy_fields, legacy_rows = _read_legacy_evidence(
        legacy_pfam_hits, selected_subjects
    )
    legacy_by_subject: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in legacy_rows:
        legacy_by_subject[row["protein_id"]].append(row)

    thresholds = read_pfam_ga_thresholds(pfam_hmm)
    model_by_base: dict[str, str] = {}
    for accession in thresholds:
        base = accession.split(".", 1)[0]
        if base in model_by_base:
            raise PilotFixtureError(f"multiple versioned models for {base}")
        model_by_base[base] = accession

    fixture_rows: list[dict[str, Any]] = []
    selected_sequences: dict[str, str] = {}
    selected_subject_rows: list[dict[str, str]] = []
    selected_sequence_keys: set[str] = set()
    for item in selections:
        subject = item["scientific_subject_key"]
        row = by_subject[subject]
        digest = row["sequence_sha256"]
        if digest not in sequences:
            raise PilotFixtureError(f"selected sequence missing from P0 FASTA: {digest}")
        selected_sequences[digest] = sequences[digest]
        selected_sequence_keys.add(digest)
        base_accessions = item.get("expected_pfam_base_accessions", [])
        missing_models = [base for base in base_accessions if base not in model_by_base]
        if missing_models:
            raise PilotFixtureError(f"fixture references models absent from Pfam 35: {missing_models}")
        expected_accessions = sorted(model_by_base[base] for base in base_accessions)
        forbidden_bases = item.get("must_not_report_base_accessions", [])
        missing_forbidden = [base for base in forbidden_bases if base not in model_by_base]
        if missing_forbidden:
            raise PilotFixtureError(
                f"fixture forbidden models absent from Pfam 35: {missing_forbidden}"
            )
        forbidden_accessions = sorted(model_by_base[base] for base in forbidden_bases)
        legacy_bases = {
            legacy["pfam_acc"] for legacy in legacy_by_subject.get(subject, [])
        }
        expected_outcome = item["expected_authoritative_scan_outcome"]
        if expected_outcome == "reported_hits_expected":
            unsupported = sorted(set(base_accessions) - legacy_bases)
            if unsupported:
                raise PilotFixtureError(
                    f"legacy fixture evidence lacks expected accessions for {subject}: {unsupported}"
                )
        elif legacy_by_subject.get(subject):
            raise PilotFixtureError(
                f"authoritative no-hit fixture has legacy Pfam rows: {subject}"
            )
        else:
            if expected_outcome != "no_reported_hits_expected":
                raise PilotFixtureError(f"invalid authoritative outcome: {expected_outcome}")
        reexpansion_count = len(subjects_by_sequence[digest])
        if int(row["shared_sequence_subject_count"]) != reexpansion_count:
            raise PilotFixtureError(f"P0 re-expansion count drift for {subject}")
        status = (
            "completed_with_hits"
            if expected_outcome == "reported_hits_expected"
            else "completed_no_hits"
        )
        evidence_payload = {
            "selection": item,
            "subject_map_row": row,
            "legacy_rows": sorted(
                legacy_by_subject.get(subject, []),
                key=lambda legacy: (
                    legacy.get("pfam_acc", ""),
                    legacy.get("ali_from", ""),
                    legacy.get("ali_to", ""),
                ),
            ),
            "resolved_pfam35_accessions": expected_accessions,
        }
        fixture_rows.append(
            {
                "fixture_id": item["fixture_id"],
                "scientific_subject_key": subject,
                "scan_execution_key": digest,
                "sequence_sha256": digest,
                "expected_authoritative_scan_outcome": expected_outcome,
                "expected_diagnostic_scan_outcome": item[
                    "expected_diagnostic_scan_outcome"
                ],
                "expected_pfam_accessions": expected_accessions,
                "expected_sequence_ga_pass": True if expected_accessions else None,
                "expected_domain_ga_pass": True if expected_accessions else None,
                "expected_reexpansion_count": reexpansion_count,
                "expected_execution_status": status,
                "expected_subject_status": status,
                "must_not_report_accessions": forbidden_accessions,
                "fixture_evidence_hash": canonical_json_sha256(evidence_payload),
            }
        )
    for digest in sorted(selected_sequence_keys):
        selected_subject_rows.extend(
            sorted(
                subjects_by_sequence[digest],
                key=lambda row: row["scientific_subject_key"],
            )
        )

    output.parent.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix=f".{output.name}.tmp-", dir=output.parent))
    try:
        readme = temp / "README.md"
        readme.write_text(
            "# RC2-B.2-P1 Pilot fixtures v001\n\n"
            "This immutable engineering package contains eight frozen Pfam scan "
            "fixtures selected from the P0 target universe. Expected outcomes are "
            "scan outcomes, not E1/E2/E3/DUB classifications. Legacy Pfam rows are "
            "historical fixture support only.\n",
            encoding="utf-8",
        )
        pilot_fasta = temp / "pilot.fasta"
        _write_fasta(pilot_fasta, selected_sequences)
        pilot_subject_map = temp / "pilot-subject-map.tsv"
        _write_tsv(pilot_subject_map, subject_fields, selected_subject_rows)
        evidence_path = temp / "fixture-legacy-evidence.tsv"
        _write_tsv(
            evidence_path,
            legacy_fields,
            sorted(
                legacy_rows,
                key=lambda row: (
                    row.get("protein_id", ""),
                    row.get("pfam_acc", ""),
                    row.get("ali_from", ""),
                ),
            ),
        )
        source_artifacts = [
            _artifact(
                target_manifest,
                artifact_type="p0_target_manifest",
                logical_locator="p0:target-universe/target-universe-manifest.json",
            ),
            _artifact(
                target_fasta,
                artifact_type="p0_target_scan_fasta",
                logical_locator="p0:target-universe/target-scan-executions.fasta",
            ),
            _artifact(
                subject_map_path,
                artifact_type="p0_scan_subject_map",
                logical_locator="p0:target-universe/scan-subject-map.tsv",
            ),
            _artifact(
                legacy_pfam_hits,
                artifact_type="legacy_pfam_evidence",
                logical_locator="gene-family:all_pfam_hits.tsv",
            ),
            _artifact(
                pfam_hmm,
                artifact_type="pfam35_uncompressed_hmm",
                logical_locator="hmmer-db:Pfam-A.hmm",
            ),
        ]
        artifacts = [
            _artifact(
                pilot_fasta,
                artifact_type="pilot_fasta",
                logical_locator="fixture-package:pilot.fasta",
            ),
            _artifact(
                pilot_subject_map,
                artifact_type="pilot_subject_map",
                logical_locator="fixture-package:pilot-subject-map.tsv",
            ),
            _artifact(
                evidence_path,
                artifact_type="fixture_legacy_evidence",
                logical_locator="fixture-package:fixture-legacy-evidence.tsv",
            ),
        ]
        manifest = {
            "schema_version": "1.0",
            "fixture_set_id": FIXTURE_SET_ID,
            "package_id": PACKAGE_ID,
            "state": "frozen",
            "created_at_utc": created_at_utc,
            "p0_target_manifest_sha256": P0_TARGET_MANIFEST_SHA256,
            "source_artifacts": source_artifacts,
            "counts": {
                "fixture_records": len(fixture_rows),
                "unique_scan_executions": len(selected_sequences),
                "scientific_subjects": len(selected_subject_rows),
                "shared_execution_fixtures": sum(
                    1 for row in fixture_rows if row["expected_reexpansion_count"] > 1
                ),
                "expected_no_hit_executions": sum(
                    1
                    for row in fixture_rows
                    if row["expected_execution_status"] == "completed_no_hits"
                ),
            },
            "fixtures": sorted(fixture_rows, key=lambda row: row["fixture_id"]),
            "artifacts": artifacts,
            "scientific_classification_claimed": False,
        }
        _write_json(temp / "pilot-fixture-manifest.json", manifest)
        _write_checksums(temp)
        _assert_source_hashes(source_hashes)
        os.replace(temp, output)
    except Exception:
        if temp.exists():
            shutil.rmtree(temp)
        raise
    return output


def validate_pilot_fixture_package(root: Path) -> PilotFixtureReport:
    report = PilotFixtureReport()
    try:
        _read_checksum_manifest(root)
    except (OSError, UnicodeError, PilotFixtureError) as exc:
        report.error(str(exc))
        return report
    report.check("fixture_package_checksums_verified")
    try:
        manifest = json.loads(
            (root / "pilot-fixture-manifest.json").read_text(encoding="utf-8")
        )
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        report.error(f"cannot load Pilot fixture manifest: {exc}")
        return report
    if (
        manifest.get("package_id") != PACKAGE_ID
        or manifest.get("fixture_set_id") != FIXTURE_SET_ID
        or manifest.get("state") != "frozen"
        or manifest.get("p0_target_manifest_sha256") != P0_TARGET_MANIFEST_SHA256
    ):
        report.error("Pilot fixture identity or P0 binding drift")
    fixtures = manifest.get("fixtures")
    if not isinstance(fixtures, list) or len(fixtures) != 8:
        report.error("Pilot fixture record count must be exactly eight")
        return report
    ids = [row.get("fixture_id") for row in fixtures if isinstance(row, dict)]
    if len(ids) != len(set(ids)):
        report.error("Pilot fixture IDs are not unique")
    fasta = _read_fasta(root / "pilot.fasta")
    execution_keys = {row.get("scan_execution_key") for row in fixtures}
    if set(fasta) != execution_keys:
        report.error("Pilot FASTA execution set differs from fixture manifest")
    counts = manifest.get("counts", {})
    if (
        counts.get("unique_scan_executions") != len(fasta)
        or counts.get("expected_no_hit_executions", 0) < 1
        or counts.get("shared_execution_fixtures", 0) < 1
    ):
        report.error("Pilot fixture denominator or boundary coverage drift")
    if manifest.get("scientific_classification_claimed") is not False:
        report.error("Pilot fixtures improperly claim scientific classification")
    if not report.errors:
        report.check("fixture_identity_denominators_and_boundaries_verified")
    return report


def project_paths() -> tuple[Path, Path, Path, Path]:
    project_root = Path(__file__).resolve().parent.parent
    data_root = Path(r"D:\jbrowsedata\projectdata")
    return (
        data_root / "gene family" / "analysis" / "rc2b2-curation-submission-v001",
        data_root / "gene family" / "all_pfam_hits.tsv",
        data_root / "hmmer_db" / "Pfam-A.hmm",
        project_root / "contracts" / "gene-family" / "rc2b2-p1",
    )


def main(argv: list[str] | None = None) -> int:
    default_p0, default_legacy, default_hmm, default_contracts = project_paths()
    parser = argparse.ArgumentParser(description="Build or validate P1 Pilot fixtures")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--p0-root", type=Path, default=default_p0)
    parser.add_argument("--legacy-pfam-hits", type=Path, default=default_legacy)
    parser.add_argument("--pfam-hmm", type=Path, default=default_hmm)
    parser.add_argument("--contracts", type=Path, default=default_contracts)
    parser.add_argument("--created-at-utc")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args(argv)
    if args.validate_only:
        report = validate_pilot_fixture_package(args.output)
        print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2))
        return 0 if report.ok else 1
    if not args.created_at_utc:
        parser.error("--created-at-utc is required for a build")
    build_pilot_fixture_package(
        output=args.output,
        p0_root=args.p0_root,
        legacy_pfam_hits=args.legacy_pfam_hits,
        pfam_hmm=args.pfam_hmm,
        contracts_root=args.contracts,
        created_at_utc=args.created_at_utc,
    )
    report = validate_pilot_fixture_package(args.output)
    print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2))
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
