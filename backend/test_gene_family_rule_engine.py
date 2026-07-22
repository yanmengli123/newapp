"""Synthetic tests for the RC2-B compiler and tri-state engine."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from backend.gene_family_rule_engine import (
    ContractError,
    EvaluationOutcome,
    EMITTED_TRACE_DIAGNOSTIC_CODES,
    NodeResult,
    compile_rule_bundle,
    content_hash,
    evaluate_catalog,
    evaluate_rule,
    load_authoring,
    strong_and,
    strong_not,
    strong_or,
    validate_rule_catalog,
)


ROOT = Path(__file__).resolve().parent.parent
TESTDATA = Path(__file__).resolve().parent / "testdata" / "gene_family_rules"
VOCABULARY = json.loads((TESTDATA / "synthetic-vocabulary.json").read_text(encoding="utf-8"))
CATALOG = json.loads((TESTDATA / "synthetic-rule-catalog.json").read_text(encoding="utf-8"))
CONTRACT_HASH = "a" * 64
REASON_HASH = "b" * 64


def compile_fixture(catalog=None):
    return compile_rule_bundle(
        VOCABULARY, catalog or CATALOG,
        contract_bundle_hash=CONTRACT_HASH,
        reason_registry_hash=REASON_HASH,
    )


def evidence(*domains, complete=True):
    return {
        "subject": {"namespace": "synthetic_protein", "identifier": "SYNTHETIC_1"},
        "domains": [
            {
                "evidence_id": f"evidence-{index}",
                "database": "SYNDB",
                "accession": accession,
                "threshold_pass": threshold,
                "admissible_for_presence": True,
                "admissible_for_absence": True,
                "admissible_for_domain_order": True,
                "ali_from": index * 100 + 1,
            }
            for index, (accession, threshold) in enumerate(domains)
        ],
        "facts": {},
        "completeness": {
            "scan_complete": complete,
            "database_known": complete,
            "model_known": complete,
            "threshold_known": complete,
            "evidence_set_complete": complete,
            "presence_admissibility_known": complete,
            "absence_admissibility_known": complete,
            "domain_order_admissibility_known": complete,
        },
    }


def context(bundle, rule):
    return {
        "source_artifact_hashes": {"synthetic.tsv": "c" * 64},
        "contract_bundle_hash": CONTRACT_HASH,
        "rule_hash": content_hash(rule),
        "vocabulary_hash": bundle["vocabulary"]["authoring_hash"],
        "reason_registry_hash": REASON_HASH,
        "engine_commit": "f" * 40,
        "dependency_lock_hash": "d" * 64,
        "engine_config_hash": "e" * 64,
    }


def test_schema_files_are_strict_json_schema_documents():
    for name in (
        "domain-vocabulary.schema.json",
        "rule-catalog.schema.json",
        "scan-evidence.schema.json",
        "regression-fixture.schema.json",
        "approval-attestation.schema.json",
        "rollup-policy.schema.json",
        "publication-policy.schema.json",
        "mapping-consistency.schema.json",
    ):
        schema = json.loads(
            (ROOT / "rules" / "gene-family" / "ubiquitin" / "v1" / name).read_text(encoding="utf-8")
        )
        assert schema["$schema"].endswith("2020-12/schema")
        assert schema["additionalProperties"] is False


def test_every_emitted_trace_diagnostic_is_registered_separately_from_assertion_reasons():
    root = ROOT / "rules" / "gene-family" / "ubiquitin" / "v1"
    registry = json.loads((root / "trace-diagnostic-codes-v1.json").read_text(encoding="utf-8"))
    diagnostic_codes = {row["code"] for row in registry["codes"]}
    assertion_reasons = json.loads(
        (ROOT / "contracts" / "gene-family" / "rc2" / "reason-codes-v1.json").read_text(encoding="utf-8")
    )
    assertion_codes = {row["code"] for row in assertion_reasons["codes"]}
    assert EMITTED_TRACE_DIAGNOSTIC_CODES <= diagnostic_codes
    assert diagnostic_codes.isdisjoint(assertion_codes)
    assert registry["scientific_approval_implied"] is False


def test_domain_presence_is_unknown_when_evidence_admissibility_is_unknown():
    compiled = compile_fixture()
    rule = compiled["catalog"]["rules"][0]
    snapshot = evidence(("SYN_A", True))
    snapshot["domains"][0].pop("admissible_for_presence")
    snapshot["completeness"]["presence_admissibility_known"] = False
    record = evaluate_rule(rule, compiled, snapshot, context(compiled, rule))
    assert record.evaluation_outcome == "insufficient_evidence"
    assert any(
        trace.failure_reason_code == "evidence_completeness_unknown"
        for trace in record.traces
    )


def test_compiler_is_deterministic_and_executes_no_authoring_payload():
    first = compile_fixture()
    second = compile_fixture(copy.deepcopy(CATALOG))
    assert first == second
    assert first["compiled_content_hash"] == content_hash(
        {key: value for key, value in first.items() if key != "compiled_content_hash"}
    )
    assert first["catalog"]["status"] == "draft"


def test_domain_predicates_reject_display_labels_and_unknown_terms():
    changed = copy.deepcopy(CATALOG)
    changed["rules"][0]["root"]["children"][0]["value"] = "Synthetic domain A"
    with pytest.raises(ContractError, match="controlled term IDs"):
        validate_rule_catalog(changed, VOCABULARY)


def test_approved_rule_requires_scientific_signoff_and_references():
    changed = copy.deepcopy(CATALOG)
    changed["rules"][0]["status"] = "approved"
    with pytest.raises(ContractError, match="scientific sign-off"):
        validate_rule_catalog(changed, VOCABULARY)


def test_yaml_tags_anchors_and_aliases_are_rejected_before_loading(tmp_path: Path):
    unsafe = tmp_path / "unsafe.yaml"
    unsafe.write_text("value: !!python/object/apply:os.system ['echo unsafe']\n", encoding="utf-8")
    with pytest.raises(ContractError, match="tags, anchors and aliases"):
        load_authoring(unsafe)


def test_strong_kleene_truth_tables():
    assert strong_and([NodeResult.FALSE, NodeResult.UNKNOWN]) is NodeResult.FALSE
    assert strong_and([NodeResult.TRUE, NodeResult.UNKNOWN]) is NodeResult.UNKNOWN
    assert strong_or([NodeResult.TRUE, NodeResult.UNKNOWN]) is NodeResult.TRUE
    assert strong_or([NodeResult.FALSE, NodeResult.UNKNOWN]) is NodeResult.UNKNOWN
    assert strong_not(NodeResult.UNKNOWN) is NodeResult.UNKNOWN


def test_complete_absence_can_match_and_incomplete_absence_is_unknown():
    bundle = compile_fixture()
    rule = bundle["catalog"]["rules"][0]
    matched = evaluate_rule(rule, bundle, evidence(("SYN_A", True)), context(bundle, rule))
    incomplete = evaluate_rule(
        rule, bundle, evidence(("SYN_A", True), complete=False), context(bundle, rule)
    )
    assert matched.evaluation_outcome == EvaluationOutcome.MATCHED.value
    assert matched.emitted_assertion_version_id is None
    assert incomplete.evaluation_outcome == EvaluationOutcome.INSUFFICIENT_EVIDENCE.value
    assert next(trace for trace in incomplete.traces if trace.node_id == "exclusion-absent").node_result == "unknown"


def test_passing_exclusion_hit_is_a_non_match_with_evidence_trace():
    bundle = compile_fixture()
    rule = bundle["catalog"]["rules"][0]
    result = evaluate_rule(
        rule, bundle,
        evidence(("SYN_A", True), ("SYN_X", True)),
        context(bundle, rule),
    )
    assert result.evaluation_outcome == EvaluationOutcome.NOT_MATCHED.value
    trace = next(item for item in result.traces if item.node_id == "exclusion-absent")
    assert trace.node_result == "false"
    assert trace.evidence_ids == ("evidence-1",)


def test_catalog_conflicts_are_recorded_as_evaluations_not_assertions():
    changed = copy.deepcopy(CATALOG)
    alternative = copy.deepcopy(changed["rules"][0])
    alternative["rule_id"] = "synthetic.include-a-alternative"
    alternative["output_entry_id"] = "synthetic:class-b"
    alternative["root"]["node_id"] = "alternative-root"
    for node in alternative["root"]["children"]:
        node["node_id"] = "alternative-" + node["node_id"]
    changed["rules"].append(alternative)
    bundle = compile_fixture(changed)
    base = context(bundle, bundle["catalog"]["rules"][0])
    base.pop("rule_hash")
    results = evaluate_catalog(bundle, evidence(("SYN_A", True)), base)
    assert [item.evaluation_outcome for item in results] == ["conflicted", "conflicted"]
    assert all(item.emitted_assertion_version_id is None for item in results)


def test_compiled_bundle_tampering_is_rejected():
    bundle = compile_fixture()
    rule = bundle["catalog"]["rules"][0]
    bundle["catalog"]["status"] = "approved"
    with pytest.raises(ContractError, match="bundle hash mismatch"):
        evaluate_rule(rule, bundle, evidence(("SYN_A", True)), context(bundle, rule))
