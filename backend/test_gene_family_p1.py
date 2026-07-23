"""Tests for RC2-B.2-P1 contracts and strict HMMER parsing."""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from backend.gene_family_hmmer_parser import (
    HmmerParseError,
    canonical_decimal,
    enrich_domain_records_with_ga,
    parse_hmmer_table,
    read_pfam_ga_thresholds,
    semantic_sha256,
)
from backend.gene_family_p1_contracts import validate_p1_contracts


ROOT = Path(__file__).resolve().parent.parent
CONTRACTS = ROOT / "contracts" / "gene-family" / "rc2b2-p1"
QUERY = "sha256_" + "a" * 64
MODEL = "PF00001.1"


def _write_domtblout(path: Path, records: list[str]) -> None:
    path.write_text(
        "\n".join(
            records
            + [
                "# Program:         hmmscan",
                "# Version:         3.4 (Aug 2023)",
                "# [ok]",
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def _dom_line(*, score: str = "19.0", ali_to: int = 100) -> str:
    return (
        f"PF00001.1 PF00001.1 100 {QUERY} - 200 1e-5 20.0 0.0 "
        f"1 1 1e-6 1e-5 {score} 0.0 1 90 10 {ali_to} 8 105 0.95 test domain"
    )


def _write_tblout(path: Path) -> None:
    path.write_text(
        f"PF00001.1 PF00001.1 {QUERY} - 1e-5 20.0 0.0 1e-6 19.0 0.0 "
        "1.0 1 0 0 1 1 1 1 test domain\n"
        "# Program:         hmmscan\n"
        "# Version:         3.4 (Aug 2023)\n",
        encoding="utf-8",
    )


def test_repository_p1_contracts_and_json_schemas_validate() -> None:
    report = validate_p1_contracts(CONTRACTS)
    assert report.ok, report.errors
    assert "independent_p1_state_systems_verified" in report.checks
    assert "strict_parser_and_semantic_hash_policy_verified" in report.checks
    for path in sorted(CONTRACTS.glob("*.schema.json")):
        Draft202012Validator.check_schema(json.loads(path.read_text(encoding="utf-8")))


def test_strict_domtblout_parser_and_semantic_hash_are_order_stable(tmp_path: Path) -> None:
    first = tmp_path / "first.domtblout"
    second = tmp_path / "second.domtblout"
    row_a = _dom_line(score="19.00")
    row_b = row_a.replace("PF00001.1 PF00001.1", "PF00002.2 PF00002.2").replace(
        "test domain", "second domain"
    )
    _write_domtblout(first, [row_a, row_b])
    _write_domtblout(second, [row_b, row_a])
    models = {"PF00001.1", "PF00002.2"}
    parsed_a = parse_hmmer_table(
        first, format_name="domtblout", model_accessions=models, query_names={QUERY}
    )
    parsed_b = parse_hmmer_table(
        second, format_name="domtblout", model_accessions=models, query_names={QUERY}
    )
    assert len(parsed_a.records) == 2
    assert semantic_sha256(parsed_a.records) == semantic_sha256(parsed_b.records)
    assert canonical_decimal(Decimal("19.00")) == "19"
    assert canonical_decimal(Decimal("-0.000")) == "0"


def test_strict_tblout_parser_supports_no_query_accession(tmp_path: Path) -> None:
    path = tmp_path / "test.tblout"
    _write_tblout(path)
    parsed = parse_hmmer_table(
        path,
        format_name="tblout",
        model_accessions={MODEL},
        query_names={QUERY},
    )
    assert len(parsed.records) == 1
    assert parsed.records[0]["query_accession"] is None
    assert parsed.records[0]["reported_domains"] == 1


@pytest.mark.parametrize(
    ("line", "reason"),
    [
        (_dom_line(score="nan"), "malformed_numeric_field"),
        (_dom_line(ali_to=300), "invalid_coordinates"),
        (_dom_line().replace("PF00001.1", "PF99999.9"), "unknown_model_accession"),
    ],
)
def test_strict_parser_rejects_blocking_records(
    tmp_path: Path, line: str, reason: str
) -> None:
    path = tmp_path / "bad.domtblout"
    _write_domtblout(path, [line])
    with pytest.raises(HmmerParseError) as caught:
        parse_hmmer_table(
            path,
            format_name="domtblout",
            model_accessions={MODEL},
            query_names={QUERY},
        )
    assert caught.value.reason_code == reason


def test_duplicate_record_is_a_blocker(tmp_path: Path) -> None:
    path = tmp_path / "duplicate.domtblout"
    _write_domtblout(path, [_dom_line(), _dom_line()])
    with pytest.raises(HmmerParseError) as caught:
        parse_hmmer_table(
            path,
            format_name="domtblout",
            model_accessions={MODEL},
            query_names={QUERY},
        )
    assert caught.value.reason_code == "duplicate_record"


def test_ga_thresholds_are_versioned_and_authoritative_rows_must_pass(tmp_path: Path) -> None:
    hmm = tmp_path / "test.hmm"
    hmm.write_text(
        "HMMER3/f\nNAME  test\nACC   PF00001.1\nGA    18.0 17.0;\n//\n",
        encoding="ascii",
    )
    thresholds = read_pfam_ga_thresholds(hmm)
    assert thresholds == {MODEL: (Decimal("18.0"), Decimal("17.0"))}
    path = tmp_path / "test.domtblout"
    _write_domtblout(path, [_dom_line(score="19")])
    parsed = parse_hmmer_table(
        path,
        format_name="domtblout",
        model_accessions={MODEL},
        query_names={QUERY},
    )
    enriched = enrich_domain_records_with_ga(
        parsed.records, thresholds, scan_role="authoritative"
    )
    assert enriched[0]["sequence_ga_pass"] is True
    assert enriched[0]["domain_ga_pass"] is True
    failing = [dict(parsed.records[0], domain_score=Decimal("16.9"))]
    with pytest.raises(ValueError, match="failed GA checks"):
        enrich_domain_records_with_ga(failing, thresholds, scan_role="authoritative")
