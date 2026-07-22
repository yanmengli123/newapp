"""Synthetic-only tests for evidence adaptation, rollup and publication."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from backend.gene_family_rule_engine import compile_rule_bundle
from backend.gene_family_shadow_framework import (
    EvidenceAdapter,
    ProteinClassificationProposal,
    ShadowFrameworkError,
    content_hash,
    plan_shadow_publication,
    rollup_gene,
    semantic_proposal_hash,
)


TESTDATA = Path(__file__).resolve().parent / "testdata" / "gene_family_rules"
VOCABULARY = json.loads((TESTDATA / "synthetic-vocabulary.json").read_text(encoding="utf-8"))
CATALOG = json.loads((TESTDATA / "synthetic-rule-catalog.json").read_text(encoding="utf-8"))


def bundle():
    compiled = compile_rule_bundle(
        VOCABULARY, CATALOG,
        contract_bundle_hash="a" * 64,
        reason_registry_hash="b" * 64,
    )
    compiled["vocabulary"]["accession_index"] = {
        "Pfam:PF99997": ["SYN:DOMAIN_A"],
        "Pfam:PF99998": ["SYN:DOMAIN_B"],
        "Pfam:PF99999": ["SYN:EXCLUSION"],
    }
    return compiled


def rollup_policy(status="draft", attestation_id=None, positive="any_admissible_isoform"):
    return {
        "policy_id": "synthetic-rollup",
        "version": "1.0.0",
        "status": status,
        "positive_isoform_policy": positive,
        "conflict_policy": "needs_curator_review",
        "representative_protein_policy": "highest_evidence_rank",
        "unresolved_mapping_policy": "needs_curator_review",
        "approval_attestation_id": attestation_id,
    }


def publication_policy(status="draft", attestation_id=None):
    return {
        "policy_id": "synthetic-publication",
        "version": "1.0.0",
        "status": status,
        "shadow_only": True,
        "matched_complete_action": "proposed_accepted",
        "matched_incomplete_action": "proposed_candidate",
        "conflict_action": "needs_curator_review",
        "not_evaluable_action": "no_publication",
        "mapping_exception_action": "needs_curator_review",
        "approval_attestation_id": attestation_id,
    }


def protein(
    protein_id, entry="synthetic:class-a", outcome="supported", complete=True,
    rank=1, mapping="exact", accepted_admissible=True,
    candidate_admissible=True,
):
    return ProteinClassificationProposal(
        source_protein_id=protein_id,
        evaluation_ids=(f"eval-{protein_id}",),
        output_entry_id=entry,
        protein_outcome=outcome,
        evidence_complete=complete,
        accepted_classification_admissible=accepted_admissible,
        candidate_classification_admissible=candidate_admissible,
        evidence_rank=rank,
        protein_length=100 + rank,
        gene_mapping_state=mapping,
    )


def test_evidence_adapter_computes_sequence_and_domain_threshold_pass():
    scan_run = {
        "scan_run_id": "synthetic-scan",
        "evidence_source_id": "synthetic-pfam-hmmer",
        "proteome_source": "synthetic-fixture",
        "proteome_version": "synthetic-proteome-1",
        "proteome_sha256": "d" * 64,
        "expected_subject_count": 1,
        "subject_universe_value_status": "observed",
        "pfam_release": "synthetic-pfam-fixture-1",
        "pfam_hmm_sha256": "c" * 64,
        "hmmer_version": "synthetic-hmmer-fixture-1",
        "command": ["synthetic-hmmscan", "--cut_ga"],
        "threshold_policy": "pfam_ga",
        "provenance_status": "complete",
        "scan_status": "completed",
    }
    scan_subject = {
        "source_protein_id": "P1", "scan_attempted": True,
        "scan_completed": True, "hit_count": 1, "no_hit_confirmed": False,
        "evidence_completeness": "complete",
    }
    thresholds = [
        {
            "pfam_accession": accession, "threshold_type": "GA",
            "sequence_threshold": "50", "domain_threshold": "20",
            "sequence_threshold_value_status": "observed",
            "domain_threshold_value_status": "observed",
            "threshold_source": "synthetic-fixture", "threshold_version": "1.0.0",
            "provenance_status": "complete",
        }
        for accession in ("PF99997", "PF99998", "PF99999")
    ]
    admissibility = [{
        "evidence_source_id": "synthetic-pfam-hmmer",
        "evidence_source_hash": "e" * 64,
        "supports_presence": True,
        "supports_absence": True,
        "supports_domain_order": True,
        "supports_accepted_classification": False,
        "supports_candidate_classification": True,
        "diagnostic_code": "evidence_source_candidate_only",
        "assessment_status": "engineering_assessment",
        "approval_attestation_id": None,
    }]
    scan_contract = {
        "scan_run": scan_run,
        "subjects": [scan_subject],
        "thresholds": thresholds,
        "admissibility": admissibility,
    }
    schema = json.loads(
        (Path(__file__).resolve().parent.parent / "rules" / "gene-family" /
         "ubiquitin" / "v1" / "scan-evidence.schema.json").read_text(encoding="utf-8")
    )
    Draft202012Validator(schema).validate(scan_contract)
    adapter = EvidenceAdapter(
        compiled_bundle=bundle(),
        scan_run=scan_run,
        thresholds=thresholds,
        admissibility=admissibility,
    )
    snapshot = adapter.adapt(
        subject={"namespace": "synthetic_protein", "identifier": "P1", "protein_length": 200},
        scan_subject=scan_subject,
        domain_hits=[{
            "evidence_id": "hit-1", "pfam_accession": "PF99997",
            "pfam_accession_version": "PF99997.1", "sequence_score": "60",
            "domain_score": "30", "hmm_from": 1, "hmm_to": 20,
            "ali_from": 10, "ali_to": 29, "env_from": 9, "env_to": 30,
        }],
    )
    assert snapshot["domains"][0]["threshold_pass"] is True
    assert all(
        snapshot["completeness"][field] is True
        for field in (
            "scan_complete", "database_known", "model_known", "threshold_known",
            "evidence_set_complete", "presence_admissibility_known",
            "absence_admissibility_known", "domain_order_admissibility_known",
            "candidate_classification_admissible",
        )
    )
    assert snapshot["completeness"]["accepted_classification_admissible"] is False


def test_evidence_adapter_preserves_unknown_when_threshold_or_scan_is_incomplete():
    adapter = EvidenceAdapter(
        compiled_bundle=bundle(),
        scan_run={
            "scan_run_id": "legacy", "scan_status": "partial",
            "pfam_release": "", "pfam_hmm_sha256": "", "hmmer_version": "",
            "proteome_version": "", "proteome_sha256": "",
        },
        thresholds=[],
        admissibility=[],
    )
    snapshot = adapter.adapt(
        subject={"namespace": "synthetic_protein", "identifier": "P1"},
        scan_subject={
            "source_protein_id": "P1", "scan_attempted": False,
            "scan_completed": False, "hit_count": 1, "no_hit_confirmed": False,
            "evidence_completeness": "unknown_legacy",
        },
        domain_hits=[{
            "evidence_id": "legacy-hit", "pfam_accession": "PF99997",
            "sequence_score": "60", "domain_score": "30",
        }],
    )
    assert snapshot["domains"][0]["threshold_pass"] == "unknown"
    assert not any(snapshot["completeness"].values())


def test_any_isoform_rollup_and_shadow_publication_are_proposals_only():
    rollup = rollup_gene(
        source_gene_namespace="synthetic_gene", source_gene_identifier="G1",
        protein_proposals=[protein("P1", rank=2), protein("P2", outcome="not_supported")],
        policy=rollup_policy(), engineering_dry_run=True,
    )
    publication = plan_shadow_publication(
        rollup=rollup, mapping_state="exact", policy=publication_policy(),
        engineering_dry_run=True,
    )
    assert rollup.rollup_outcome == "supported"
    assert rollup.representative_protein == "P1"
    assert publication.publication_decision == "proposed_accepted"
    assert publication.scientific_shadow_authorized is False
    assert publication.formal_assertion_emitted is False


def test_isoform_entry_conflict_requires_review():
    rollup = rollup_gene(
        source_gene_namespace="synthetic_gene", source_gene_identifier="G1",
        protein_proposals=[
            protein("P1", entry="synthetic:class-a"),
            protein("P2", entry="synthetic:class-b"),
        ],
        policy=rollup_policy(),
    )
    publication = plan_shadow_publication(
        rollup=rollup, mapping_state="exact", policy=publication_policy(),
    )
    assert rollup.rollup_outcome == "conflicted"
    assert rollup.alternative_entry_ids == ("synthetic:class-a", "synthetic:class-b")
    assert publication.publication_decision == "needs_curator_review"


def test_mapping_exception_never_uses_matched_complete_action():
    rollup = rollup_gene(
        source_gene_namespace="synthetic_gene", source_gene_identifier="G1",
        protein_proposals=[protein("P1")], policy=rollup_policy(),
    )
    publication = plan_shadow_publication(
        rollup=rollup, mapping_state="ambiguous", policy=publication_policy(),
    )
    assert publication.publication_decision == "needs_curator_review"
    assert publication.proposed_assertion_state is None


def test_candidate_only_evidence_cannot_propose_an_accepted_assertion():
    rollup = rollup_gene(
        source_gene_namespace="synthetic_gene", source_gene_identifier="G1",
        protein_proposals=[protein("P1", accepted_admissible=False)],
        policy=rollup_policy(),
    )
    publication = plan_shadow_publication(
        rollup=rollup, mapping_state="exact", policy=publication_policy(),
    )
    assert publication.publication_decision == "proposed_candidate"
    assert publication.proposed_assertion_state == "candidate"


def test_draft_policies_cannot_authorize_a_formal_shadow():
    with pytest.raises(ShadowFrameworkError, match="approved policy"):
        rollup_gene(
            source_gene_namespace="synthetic_gene", source_gene_identifier="G1",
            protein_proposals=[protein("P1")], policy=rollup_policy(),
            engineering_dry_run=False,
        )


def test_attestation_must_bind_the_exact_policy_artifact():
    policy = rollup_policy(status="approved", attestation_id="attestation-1")
    attestation = {
        "attestation_id": "attestation-1",
        "artifact_type": "rollup_policy",
        "artifact_hash_algorithm": "gf-canonical-json-sha256-v1",
        "artifact_sha256": "f" * 64,
        "decision": "approved",
        "approval_scope": "approved_for_shadow_run",
    }
    with pytest.raises(ShadowFrameworkError, match="does not match policy"):
        rollup_gene(
            source_gene_namespace="synthetic_gene", source_gene_identifier="G1",
            protein_proposals=[protein("P1")], policy=policy,
            engineering_dry_run=False, attestation=attestation,
        )
    attestation["artifact_sha256"] = content_hash(policy)
    proposal = rollup_gene(
        source_gene_namespace="synthetic_gene", source_gene_identifier="G1",
        protein_proposals=[protein("P1")], policy=policy,
        engineering_dry_run=False, attestation=attestation,
    )
    assert proposal.formal_assertion_emitted is False


def test_semantic_proposal_hash_is_order_independent():
    first = rollup_gene(
        source_gene_namespace="synthetic_gene", source_gene_identifier="G1",
        protein_proposals=[protein("P1")], policy=rollup_policy(),
    )
    second = rollup_gene(
        source_gene_namespace="synthetic_gene", source_gene_identifier="G2",
        protein_proposals=[protein("P2")], policy=rollup_policy(),
    )
    pub1 = plan_shadow_publication(rollup=first, mapping_state="exact", policy=publication_policy())
    pub2 = plan_shadow_publication(rollup=second, mapping_state="exact", policy=publication_policy())
    assert semantic_proposal_hash([first, second], [pub1, pub2]) == semantic_proposal_hash(
        [second, first], [pub2, pub1]
    )
