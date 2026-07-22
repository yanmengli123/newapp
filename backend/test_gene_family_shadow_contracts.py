"""Tests for the RC2-B shadow-preparation contract gate."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from backend.gene_family_shadow_contracts import validate_shadow_contracts


ROOT = Path(__file__).resolve().parent.parent
SHADOW_CONTRACTS = ROOT / "rules" / "gene-family" / "ubiquitin" / "v1"
RC2_CONTRACTS = ROOT / "contracts" / "gene-family" / "rc2"


def test_repository_shadow_contracts_validate():
    report = validate_shadow_contracts(SHADOW_CONTRACTS, RC2_CONTRACTS)
    assert report.ok, report.errors
    assert "evaluator_diagnostic_registry_coverage_verified" in report.checks
    assert "shadow_gates_extend_without_mutating_rc2a" in report.checks


def test_unregistered_evaluator_diagnostic_is_rejected(tmp_path):
    copied = tmp_path / "contracts"
    shutil.copytree(SHADOW_CONTRACTS, copied)
    path = copied / "trace-diagnostic-codes-v1.json"
    registry = json.loads(path.read_text(encoding="utf-8"))
    registry["codes"] = [
        item for item in registry["codes"]
        if item["code"] != "evidence_completeness_unknown"
    ]
    path.write_text(json.dumps(registry), encoding="utf-8")
    report = validate_shadow_contracts(copied, RC2_CONTRACTS)
    assert not report.ok
    assert any("unregistered" in error for error in report.errors)


def test_shadow_authorization_cannot_be_enabled_in_gate_contract(tmp_path):
    copied = tmp_path / "contracts"
    shutil.copytree(SHADOW_CONTRACTS, copied)
    path = copied / "shadow-qc-gates-v1.json"
    gates = json.loads(path.read_text(encoding="utf-8"))
    gates["scientific_shadow_authorized"] = True
    path.write_text(json.dumps(gates), encoding="utf-8")
    report = validate_shadow_contracts(copied, RC2_CONTRACTS)
    assert not report.ok
    assert any("must not authorize" in error for error in report.errors)
