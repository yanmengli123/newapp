"""Synthetic tests for projected ubiquitin evidence auditing."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest

from backend.ubiquitin_evidence_audit import (
    EvidenceAuditError,
    audit_projected_evidence,
    write_audit_report,
)


FULL_FIELDS = [
    "protein_id", "pfam_acc", "pfam_acc_version", "domain_index",
    "hmm_from", "hmm_to", "ali_from", "ali_to", "env_from", "env_to",
]


def write_tsv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, delimiter="\t", fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def full_row(protein: str, accession: str, start: int) -> dict[str, str]:
    return {
        "protein_id": protein,
        "pfam_acc": accession,
        "pfam_acc_version": accession + ".1",
        "domain_index": "1",
        "hmm_from": "1", "hmm_to": "50",
        "ali_from": str(start), "ali_to": str(start + 49),
        "env_from": str(start), "env_to": str(start + 50),
    }


def fixture_files(tmp_path: Path) -> tuple[Path, Path]:
    full = tmp_path / "all_pfam_hits.tsv"
    legacy = tmp_path / "chicken_ubiquitin_domain_evidence.tsv"
    write_tsv(
        full, FULL_FIELDS,
        [full_row("p1.1", "pf00001", 10), full_row("P1.1", "PF00001", 100), full_row("P2.1", "PF00002", 20)],
    )
    write_tsv(
        legacy, ["protein_id", "pfam_acc"],
        [
            {"protein_id": "P1.1", "pfam_acc": "PF00001"},
            {"protein_id": "p2.1", "pfam_acc": "PF00002.99"},
            {"protein_id": "P3.1", "pfam_acc": "PF00003"},
        ],
    )
    return full, legacy


def test_projected_audit_never_claims_coordinate_equivalence(tmp_path: Path):
    full, legacy = fixture_files(tmp_path)
    report = audit_projected_evidence(full, legacy)
    projected = report["projected_comparison"]
    assert report["coordinate_level_equivalence_claimed"] is False
    assert report["comparison_resolution"] == "canonical_protein_id+pfam_accession"
    assert projected["matched_legacy_rows"] == 2
    assert projected["legacy_rows_without_projected_match"] == 1
    assert projected["additional_all_pfam_rows_on_legacy_keys"] == 1
    assert projected["legacy_keys_that_are_projected_subsets"] == 1
    assert report["derivation_policy"]["future_filtered_evidence_source"] == "all_pfam_hits.tsv only"


def test_full_identity_uses_coordinates_and_detects_exact_duplicates(tmp_path: Path):
    full, legacy = fixture_files(tmp_path)
    rows = [full_row("P1.1", "PF00001", 10)] * 2
    write_tsv(full, FULL_FIELDS, rows)
    write_tsv(legacy, ["protein_id", "pfam_acc"], [{"protein_id": "P1.1", "pfam_acc": "PF00001"}])
    report = audit_projected_evidence(full, legacy)
    assert report["full_identity"]["duplicate_key_count"] == 1
    assert report["full_identity"]["duplicate_row_excess"] == 1
    assert report["full_identity_duplicate_rows"][0]["ali_from"] == "10"


def test_missing_required_coordinates_fail_closed(tmp_path: Path):
    full = tmp_path / "full.tsv"
    legacy = tmp_path / "legacy.tsv"
    write_tsv(full, ["protein_id", "pfam_acc"], [{"protein_id": "P1", "pfam_acc": "PF1"}])
    write_tsv(legacy, ["protein_id", "pfam_acc"], [{"protein_id": "P1", "pfam_acc": "PF1"}])
    with pytest.raises(EvidenceAuditError, match="missing columns"):
        audit_projected_evidence(full, legacy)


def test_report_writer_is_non_overwriting_and_splits_detail_tables(tmp_path: Path):
    full, legacy = fixture_files(tmp_path)
    report = audit_projected_evidence(full, legacy)
    output = tmp_path / "analysis"
    write_audit_report(report, output)
    summary = json.loads((output / "audit-summary.json").read_text(encoding="utf-8"))
    assert "projected_key_rows" not in summary
    assert (output / "projected-key-comparison.tsv").is_file()
    assert (output / "full-identity-duplicates.tsv").is_file()
    with pytest.raises(FileExistsError):
        write_audit_report(report, output)

