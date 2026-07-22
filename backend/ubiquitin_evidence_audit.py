"""Read-only projected audit of legacy ubiquitin evidence against all Pfam hits."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any, Iterable


FULL_REQUIRED = {
    "protein_id", "pfam_acc", "pfam_acc_version", "domain_index",
    "hmm_from", "hmm_to", "ali_from", "ali_to", "env_from", "env_to",
}
LEGACY_REQUIRED = {"protein_id", "pfam_acc"}
COORDINATE_FIELDS = (
    "domain_index", "hmm_from", "hmm_to", "ali_from", "ali_to", "env_from", "env_to",
)


class EvidenceAuditError(ValueError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def normalize_protein_id(value: str) -> str:
    return value.strip().upper()


def normalize_pfam_accession(value: str) -> str:
    return value.strip().upper().split(".", 1)[0]


def projected_key(row: dict[str, str]) -> tuple[str, str]:
    protein = normalize_protein_id(row.get("protein_id", ""))
    accession = normalize_pfam_accession(row.get("pfam_acc", ""))
    if not protein or not accession:
        raise EvidenceAuditError("protein_id and pfam_acc must be non-empty")
    return protein, accession


def full_identity_key(row: dict[str, str]) -> tuple[str, ...]:
    key = list(projected_key(row))
    key.append(row.get("pfam_acc_version", "").strip())
    for field in COORDINATE_FIELDS:
        value = row.get(field, "").strip()
        if not value:
            raise EvidenceAuditError(f"all_pfam row lacks required coordinate field {field}")
        try:
            key.append(str(int(value)))
        except ValueError as exc:
            raise EvidenceAuditError(f"all_pfam {field} is not an integer: {value!r}") from exc
    return tuple(key)


def _read_counters(
    path: Path, required: set[str], include_full_identity: bool,
) -> tuple[int, Counter[tuple[str, str]], Counter[tuple[str, ...]], set[str]]:
    projected: Counter[tuple[str, str]] = Counter()
    identities: Counter[tuple[str, ...]] = Counter()
    row_count = 0
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        headers = set(reader.fieldnames or [])
        missing = required - headers
        if missing:
            raise EvidenceAuditError(f"{path.name}: missing columns {sorted(missing)}")
        for row_number, row in enumerate(reader, 2):
            if None in row:
                raise EvidenceAuditError(f"{path.name}:{row_number}: excess fields")
            try:
                key = projected_key(row)
                projected[key] += 1
                if include_full_identity:
                    identities[full_identity_key(row)] += 1
            except EvidenceAuditError as exc:
                raise EvidenceAuditError(f"{path.name}:{row_number}: {exc}") from exc
            row_count += 1
    return row_count, projected, identities, headers


def _key_row(key: tuple[str, str], full_count: int, legacy_count: int) -> dict[str, Any]:
    if full_count == legacy_count:
        status = "exact_projected_multiplicity"
    elif full_count > legacy_count:
        status = "legacy_projected_subset"
    else:
        status = "legacy_projected_excess"
    return {
        "canonical_protein_id": key[0],
        "pfam_accession": key[1],
        "all_pfam_count": full_count,
        "legacy_count": legacy_count,
        "matched_count": min(full_count, legacy_count),
        "status": status,
    }


def audit_projected_evidence(all_pfam: Path, legacy: Path) -> dict[str, Any]:
    """Compare only the resolution the coordinate-free legacy file permits."""

    before = {"all_pfam": sha256_file(all_pfam), "legacy": sha256_file(legacy)}
    full_rows, full_projected, full_identities, _ = _read_counters(all_pfam, FULL_REQUIRED, True)
    legacy_rows, legacy_projected, _, legacy_headers = _read_counters(legacy, LEGACY_REQUIRED, False)
    after = {"all_pfam": sha256_file(all_pfam), "legacy": sha256_file(legacy)}
    if before != after:
        raise EvidenceAuditError("source file changed while the audit was running")

    comparison = [
        _key_row(key, full_projected.get(key, 0), legacy_count)
        for key, legacy_count in sorted(legacy_projected.items())
    ]
    duplicate_identities = [
        {
            "canonical_protein_id": key[0],
            "pfam_accession": key[1],
            "pfam_accession_version": key[2],
            "domain_index": key[3],
            "hmm_from": key[4], "hmm_to": key[5],
            "ali_from": key[6], "ali_to": key[7],
            "env_from": key[8], "env_to": key[9],
            "count": count,
        }
        for key, count in sorted(full_identities.items()) if count > 1
    ]
    matched_rows = sum(row["matched_count"] for row in comparison)
    legacy_excess = sum(max(0, row["legacy_count"] - row["all_pfam_count"]) for row in comparison)
    full_excess_on_legacy_keys = sum(
        max(0, row["all_pfam_count"] - row["legacy_count"]) for row in comparison
    )
    multiplicity_histogram = Counter(full_projected.values())
    return {
        "audit_format": "gf-ubiquitin-projected-evidence-audit-1.0",
        "comparison_resolution": "canonical_protein_id+pfam_accession",
        "coordinate_level_equivalence_claimed": False,
        "legacy_coordinate_fields_available": set(COORDINATE_FIELDS).issubset(legacy_headers),
        "normalization": {
            "protein_id": "trim+uppercase; version retained",
            "pfam_accession": "trim+uppercase; accession version removed",
        },
        "source_artifacts": {
            "all_pfam": {
                "file_name": all_pfam.name,
                "sha256_before": before["all_pfam"],
                "sha256_after": after["all_pfam"],
                "row_count": full_rows,
                "role": "authoritative_full_domain_evidence",
            },
            "legacy_ubiquitin": {
                "file_name": legacy.name,
                "sha256_before": before["legacy"],
                "sha256_after": after["legacy"],
                "row_count": legacy_rows,
                "role": "legacy_projected_selection",
            },
        },
        "full_identity": {
            "fields": [
                "canonical_protein_id", "pfam_accession", "pfam_accession_version",
                *COORDINATE_FIELDS,
            ],
            "unique_key_count": len(full_identities),
            "duplicate_key_count": len(duplicate_identities),
            "duplicate_row_excess": sum(row["count"] - 1 for row in duplicate_identities),
        },
        "projected_comparison": {
            "all_pfam_unique_key_count": len(full_projected),
            "legacy_unique_key_count": len(legacy_projected),
            "matched_legacy_rows": matched_rows,
            "legacy_rows_without_projected_match": legacy_excess,
            "additional_all_pfam_rows_on_legacy_keys": full_excess_on_legacy_keys,
            "legacy_keys_with_exact_multiplicity": sum(
                row["status"] == "exact_projected_multiplicity" for row in comparison
            ),
            "legacy_keys_that_are_projected_subsets": sum(
                row["status"] == "legacy_projected_subset" for row in comparison
            ),
            "legacy_keys_with_excess_rows": sum(
                row["status"] == "legacy_projected_excess" for row in comparison
            ),
            "all_pfam_projected_multiplicity_histogram": {
                str(key): value for key, value in sorted(multiplicity_histogram.items())
            },
        },
        "derivation_policy": {
            "future_filtered_evidence_source": "all_pfam_hits.tsv only",
            "legacy_file_may_select_projected_keys": True,
            "legacy_file_may_supply_coordinates_or_scores": False,
            "ambiguous_projected_multiplicity_requires_explicit_report": True,
        },
        "projected_key_rows": comparison,
        "full_identity_duplicate_rows": duplicate_identities,
    }


def _write_tsv(path: Path, rows: Iterable[dict[str, Any]], fields: list[str]) -> None:
    with path.open("x", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, delimiter="\t", fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def write_audit_report(report: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=False)
    summary = {key: value for key, value in report.items() if key not in {
        "projected_key_rows", "full_identity_duplicate_rows",
    }}
    (output_dir / "audit-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8", newline="\n",
    )
    _write_tsv(
        output_dir / "projected-key-comparison.tsv", report["projected_key_rows"],
        ["canonical_protein_id", "pfam_accession", "all_pfam_count", "legacy_count", "matched_count", "status"],
    )
    _write_tsv(
        output_dir / "full-identity-duplicates.tsv", report["full_identity_duplicate_rows"],
        [
            "canonical_protein_id", "pfam_accession", "pfam_accession_version",
            "domain_index", "hmm_from", "hmm_to", "ali_from", "ali_to",
            "env_from", "env_to", "count",
        ],
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit coordinate-free ubiquitin evidence against all Pfam hits")
    parser.add_argument("--all-pfam", type=Path, required=True)
    parser.add_argument("--legacy", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    report = audit_projected_evidence(args.all_pfam, args.legacy)
    if args.output:
        write_audit_report(report, args.output)
    if args.as_json or not args.output:
        printable = {key: value for key, value in report.items() if key not in {
            "projected_key_rows", "full_identity_duplicate_rows",
        }}
        print(json.dumps(printable, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
