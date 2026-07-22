"""Engineering-only evidence adaptation, gene rollup and shadow publication.

No function in this module writes an RC2 database or emits a formal assertion.
Draft policies may run only in explicit engineering dry-run mode.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any, Mapping, Sequence


class ShadowFrameworkError(ValueError):
    pass


class ProteinOutcome(str, Enum):
    SUPPORTED = "supported"
    NOT_SUPPORTED = "not_supported"
    CONFLICTED = "conflicted"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"
    NOT_EVALUABLE = "not_evaluable"


class RollupOutcome(str, Enum):
    SUPPORTED = "supported"
    NOT_SUPPORTED = "not_supported"
    CONFLICTED = "conflicted"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"
    MAPPING_UNRESOLVED = "mapping_unresolved"


class PublicationDecision(str, Enum):
    PROPOSED_ACCEPTED = "proposed_accepted"
    PROPOSED_CANDIDATE = "proposed_candidate"
    NO_PUBLICATION = "no_publication"
    NEEDS_CURATOR_REVIEW = "needs_curator_review"


@dataclass(frozen=True)
class ProteinClassificationProposal:
    source_protein_id: str
    evaluation_ids: tuple[str, ...]
    output_entry_id: str | None
    protein_outcome: str
    evidence_complete: bool
    accepted_classification_admissible: bool
    candidate_classification_admissible: bool
    evidence_rank: int
    protein_length: int | None
    gene_mapping_state: str = "exact"


@dataclass(frozen=True)
class GeneRollupProposal:
    rollup_proposal_id: str
    source_gene_namespace: str
    source_gene_identifier: str
    output_entry_id: str | None
    alternative_entry_ids: tuple[str, ...]
    rollup_outcome: str
    supporting_proteins: tuple[str, ...]
    conflicting_proteins: tuple[str, ...]
    insufficient_proteins: tuple[str, ...]
    representative_protein: str | None
    input_evaluation_ids: tuple[str, ...]
    supporting_evaluation_ids: tuple[str, ...]
    input_evaluation_set_hash: str
    evidence_complete: bool
    accepted_classification_admissible: bool
    candidate_classification_admissible: bool
    rollup_policy_id: str
    rollup_policy_version: str
    rollup_policy_hash: str
    policy_disposition: str | None
    diagnostic_code: str | None
    formal_assertion_emitted: bool = False

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ShadowPublicationProposal:
    publication_proposal_id: str
    rollup_proposal_id: str
    publication_policy_id: str
    publication_decision: str
    proposed_assertion_state: str | None
    proposed_entry_id: str | None
    selected_evaluation_id: str | None
    alternative_evaluation_ids: tuple[str, ...]
    decision_input_hash: str
    publication_policy_version: str
    publication_policy_hash: str
    diagnostic_code: str | None
    scientific_shadow_authorized: bool
    formal_assertion_emitted: bool = False

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


ROLLUP_REQUIRED_FIELDS = {
    "policy_id", "version", "status", "positive_isoform_policy",
    "conflict_policy", "representative_protein_policy",
    "unresolved_mapping_policy", "approval_attestation_id",
}
PUBLICATION_REQUIRED_FIELDS = {
    "policy_id", "version", "status", "shadow_only",
    "matched_complete_action", "matched_incomplete_action", "conflict_action",
    "not_evaluable_action", "mapping_exception_action", "approval_attestation_id",
}
APPROVAL_SCOPES = {
    "approved_for_rule_testing": 1,
    "approved_for_shadow_run": 2,
    "approved_for_rc2c_build": 3,
    "approved_for_release": 4,
}


def canonical_json(value: Any) -> str:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    )


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _decimal(value: Any, field: str) -> Decimal:
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ShadowFrameworkError(f"{field} is not a decimal") from exc
    if not result.is_finite():
        raise ShadowFrameworkError(f"{field} cannot be NaN or Infinity")
    return result


def _sha256(value: Any, field: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ShadowFrameworkError(f"{field} must be a lowercase SHA-256")
    return value


def _validate_exact_fields(value: Mapping[str, Any], fields: set[str], label: str) -> None:
    missing = fields - set(value)
    extra = set(value) - fields
    if missing or extra:
        raise ShadowFrameworkError(f"{label} fields mismatch; missing={sorted(missing)} extra={sorted(extra)}")


def validate_rollup_policy(policy: Mapping[str, Any]) -> None:
    _validate_exact_fields(policy, ROLLUP_REQUIRED_FIELDS, "rollup policy")
    if policy["status"] not in {"draft", "approved", "deprecated"}:
        raise ShadowFrameworkError("invalid rollup policy status")
    if policy["positive_isoform_policy"] not in {
        "any_admissible_isoform", "all_evaluated_isoforms", "representative_isoform_only",
    }:
        raise ShadowFrameworkError("invalid positive isoform policy")
    if policy["conflict_policy"] not in {
        "needs_curator_review", "candidate_with_conflict", "no_publication",
    }:
        raise ShadowFrameworkError("invalid conflict policy")
    if policy["representative_protein_policy"] not in {
        "highest_evidence_rank", "longest_admissible_isoform", "curator_selected",
    }:
        raise ShadowFrameworkError("invalid representative protein policy")
    if policy["unresolved_mapping_policy"] not in {
        "needs_curator_review", "source_level_candidate", "no_publication",
    }:
        raise ShadowFrameworkError("invalid unresolved mapping policy")


def validate_publication_policy(policy: Mapping[str, Any]) -> None:
    _validate_exact_fields(policy, PUBLICATION_REQUIRED_FIELDS, "publication policy")
    if policy["status"] not in {"draft", "approved", "deprecated"}:
        raise ShadowFrameworkError("invalid publication policy status")
    if policy["shadow_only"] is not True:
        raise ShadowFrameworkError("publication planner is shadow-only")
    allowed_by_field = {
        "matched_complete_action": {
            "proposed_accepted", "proposed_candidate", "needs_curator_review",
            "no_publication",
        },
        "matched_incomplete_action": {
            "proposed_candidate", "needs_curator_review", "no_publication",
        },
        "conflict_action": {
            "proposed_candidate", "needs_curator_review", "no_publication",
        },
        "not_evaluable_action": {
            "proposed_candidate", "needs_curator_review", "no_publication",
        },
        "mapping_exception_action": {
            "proposed_candidate", "needs_curator_review", "no_publication",
        },
    }
    for field, allowed in allowed_by_field.items():
        if policy[field] not in allowed:
            raise ShadowFrameworkError(f"invalid publication action in {field}")


def _authorized(
    policy: Mapping[str, Any], attestation: Mapping[str, Any] | None,
    engineering_dry_run: bool, artifact_type: str,
) -> bool:
    if engineering_dry_run:
        return False
    if policy["status"] != "approved" or not policy.get("approval_attestation_id"):
        raise ShadowFrameworkError("formal shadow planning requires an approved policy and attestation")
    if not attestation or attestation.get("attestation_id") != policy["approval_attestation_id"]:
        raise ShadowFrameworkError("policy approval attestation is missing or mismatched")
    if attestation.get("artifact_type") != artifact_type:
        raise ShadowFrameworkError("policy approval attestation has the wrong artifact type")
    if attestation.get("artifact_hash_algorithm") != "gf-canonical-json-sha256-v1":
        raise ShadowFrameworkError("policy approval attestation hash algorithm is invalid")
    if attestation.get("decision") != "approved":
        raise ShadowFrameworkError("policy attestation is not approved")
    scope = attestation.get("approval_scope")
    if APPROVAL_SCOPES.get(str(scope), 0) < APPROVAL_SCOPES["approved_for_shadow_run"]:
        raise ShadowFrameworkError("policy attestation does not authorize a shadow run")
    artifact_hash = _sha256(
        attestation.get("artifact_sha256"), "attestation artifact_sha256"
    )
    if artifact_hash != content_hash(policy):
        raise ShadowFrameworkError("policy approval attestation artifact hash does not match policy")
    return True


class EvidenceAdapter:
    """Convert versioned scan facts into the evaluator's evidence snapshot."""

    def __init__(
        self,
        *, compiled_bundle: Mapping[str, Any], scan_run: Mapping[str, Any],
        thresholds: Sequence[Mapping[str, Any]],
        admissibility: Sequence[Mapping[str, Any]],
    ) -> None:
        if compiled_bundle.get("compiled_format") != "gf-canonical-rule-bundle-1.0":
            raise ShadowFrameworkError("evidence adapter requires a compiled rule bundle")
        self.bundle = compiled_bundle
        self.scan_run = dict(scan_run)
        self.thresholds: dict[str, Mapping[str, Any]] = {}
        for threshold in thresholds:
            accession = threshold.get("pfam_accession")
            key = f"Pfam:{accession}"
            if key in self.thresholds:
                raise ShadowFrameworkError(f"duplicate threshold record: {key}")
            self.thresholds[key] = threshold
        self.required_models = set(compiled_bundle["vocabulary"]["accession_index"])
        non_pfam_models = sorted(
            model for model in self.required_models if not model.startswith("Pfam:")
        )
        if non_pfam_models:
            raise ShadowFrameworkError(
                "Pfam evidence adapter received non-Pfam vocabulary mappings: "
                + ", ".join(non_pfam_models)
            )
        source_id = self.scan_run.get("evidence_source_id")
        matching_admissibility = [
            record for record in admissibility
            if record.get("evidence_source_id") == source_id
        ]
        if len(matching_admissibility) > 1:
            raise ShadowFrameworkError(
                f"duplicate evidence admissibility records for {source_id}"
            )
        self.admissibility = (
            dict(matching_admissibility[0]) if matching_admissibility else None
        )

    def _database_known(self) -> bool:
        return self.scan_run.get("provenance_status") == "complete" and all(
            isinstance(self.scan_run.get(field), str) and self.scan_run.get(field)
            for field in (
                "pfam_release", "pfam_hmm_sha256", "hmmer_version",
                "proteome_version", "proteome_sha256",
            )
        ) and all(
            re.fullmatch(r"[0-9a-f]{64}", str(self.scan_run[field])) is not None
            for field in ("pfam_hmm_sha256", "proteome_sha256")
        )

    def _thresholds_known(self) -> bool:
        return all(
            key in self.thresholds
            and self.thresholds[key].get("provenance_status") == "complete"
            and self.thresholds[key].get("sequence_threshold") is not None
            and self.thresholds[key].get("domain_threshold") is not None
            and self.thresholds[key].get("sequence_threshold_value_status")
            in {"observed", "derived"}
            and self.thresholds[key].get("domain_threshold_value_status")
            in {"observed", "derived"}
            for key in self.required_models
        )

    def _admissibility_capabilities(self) -> dict[str, bool]:
        record = self.admissibility
        known = (
            isinstance(record, dict)
            and record.get("assessment_status")
            in {"engineering_assessment", "curator_approved"}
        )
        return {
            "presence": bool(known and record.get("supports_presence") is True),
            "absence": bool(known and record.get("supports_absence") is True),
            "domain_order": bool(known and record.get("supports_domain_order") is True),
        }

    def adapt(
        self,
        *, subject: Mapping[str, Any], scan_subject: Mapping[str, Any],
        domain_hits: Sequence[Mapping[str, Any]],
    ) -> dict[str, Any]:
        namespace, identifier = subject.get("namespace"), subject.get("identifier")
        if not isinstance(namespace, str) or not isinstance(identifier, str):
            raise ShadowFrameworkError("subject namespace/identifier are required")
        if scan_subject.get("source_protein_id") != identifier:
            raise ShadowFrameworkError("scan subject does not match evaluated protein")
        hit_count = scan_subject.get("hit_count")
        if not isinstance(hit_count, int) or isinstance(hit_count, bool) or hit_count < 0:
            raise ShadowFrameworkError("scan subject hit_count must be a non-negative integer")
        if scan_subject.get("no_hit_confirmed") is True and not (
            scan_subject.get("scan_completed") is True and hit_count == 0
        ):
            raise ShadowFrameworkError(
                "no_hit_confirmed requires a completed scan with zero hits"
            )
        scan_complete = (
            self.scan_run.get("scan_status") == "completed"
            and scan_subject.get("scan_attempted") is True
            and scan_subject.get("scan_completed") is True
            and scan_subject.get("evidence_completeness") == "complete"
        )
        database_known = self._database_known()
        thresholds_known = self._thresholds_known()
        admissibility = self._admissibility_capabilities()
        expected_hits = hit_count
        evidence_set_complete = (
            scan_complete and isinstance(expected_hits, int) and expected_hits == len(domain_hits)
            and (
                expected_hits > 0
                or scan_subject.get("no_hit_confirmed") is True
            )
        )
        adapted_hits: list[dict[str, Any]] = []
        for index, hit in enumerate(domain_hits):
            database = "Pfam"
            accession = hit.get("pfam_accession")
            key = f"{database}:{accession}"
            threshold = self.thresholds.get(key)
            threshold_pass: bool | str = "unknown"
            sequence_pass: bool | str = "unknown"
            domain_pass: bool | str = "unknown"
            if threshold and threshold.get("provenance_status") == "complete":
                sequence_score_status = hit.get("sequence_score_value_status") or (
                    "observed" if hit.get("sequence_score") is not None else "not_reported"
                )
                domain_score_status = hit.get("domain_score_value_status") or (
                    "observed" if hit.get("domain_score") is not None else "not_reported"
                )
                if (
                    sequence_score_status in {"observed", "derived"}
                    and domain_score_status in {"observed", "derived"}
                    and hit.get("sequence_score") is not None
                    and hit.get("domain_score") is not None
                ):
                    sequence_pass = _decimal(hit.get("sequence_score"), "sequence_score") >= _decimal(
                        threshold.get("sequence_threshold"), "sequence_threshold"
                    )
                    domain_pass = _decimal(hit.get("domain_score"), "domain_score") >= _decimal(
                        threshold.get("domain_threshold"), "domain_threshold"
                    )
                    threshold_pass = sequence_pass and domain_pass
            adapted_hits.append({
                "evidence_id": str(hit.get("evidence_id") or f"adapted-hit-{index}"),
                "database": database,
                "accession": accession,
                "accession_version": hit.get("pfam_accession_version"),
                "sequence_score": (
                    str(hit["sequence_score"]) if hit.get("sequence_score") is not None else None
                ),
                "domain_score": (
                    str(hit["domain_score"]) if hit.get("domain_score") is not None else None
                ),
                "sequence_threshold_pass": sequence_pass,
                "domain_threshold_pass": domain_pass,
                "threshold_pass": threshold_pass,
                "admissible_for_presence": admissibility["presence"],
                "admissible_for_absence": admissibility["absence"],
                "admissible_for_domain_order": admissibility["domain_order"],
                "hmm_from": hit.get("hmm_from"),
                "hmm_to": hit.get("hmm_to"),
                "ali_from": hit.get("ali_from"),
                "ali_to": hit.get("ali_to"),
                "env_from": hit.get("env_from"),
                "env_to": hit.get("env_to"),
            })
        protein_length = subject.get("protein_length")
        facts = {
            "scan.run_id": {
                "value": self.scan_run.get("scan_run_id"),
                "value_status": "observed" if self.scan_run.get("scan_run_id") else "not_reported",
                "evidence_ids": [],
            },
            "protein.length": {
                "value": protein_length,
                "value_status": "observed" if isinstance(protein_length, int) else "not_reported",
                "evidence_ids": [],
            },
        }
        return {
            "subject": {"namespace": namespace, "identifier": identifier},
            "domains": adapted_hits,
            "facts": facts,
            "completeness": {
                "scan_complete": scan_complete,
                "database_known": database_known,
                "model_known": thresholds_known,
                "threshold_known": thresholds_known,
                "evidence_set_complete": evidence_set_complete,
                "presence_admissibility_known": admissibility["presence"],
                "absence_admissibility_known": admissibility["absence"],
                "domain_order_admissibility_known": admissibility["domain_order"],
                "accepted_classification_admissible": bool(
                    self.admissibility
                    and self.admissibility.get("supports_accepted_classification") is True
                ),
                "candidate_classification_admissible": bool(
                    self.admissibility
                    and self.admissibility.get("supports_candidate_classification") is True
                ),
            },
            "scan_context": {
                "scan_run_id": self.scan_run.get("scan_run_id"),
                "expected_hit_count": expected_hits,
                "adapted_hit_count": len(adapted_hits),
            },
        }


def _representative(
    proposals: Sequence[ProteinClassificationProposal], policy: Mapping[str, Any],
    curator_selected_protein_id: str | None,
) -> str | None:
    if not proposals:
        return None
    mode = policy["representative_protein_policy"]
    if mode == "curator_selected":
        if not curator_selected_protein_id or curator_selected_protein_id not in {
            proposal.source_protein_id for proposal in proposals
        }:
            raise ShadowFrameworkError("curator-selected representative is missing from inputs")
        return curator_selected_protein_id
    if mode == "longest_admissible_isoform":
        eligible = [proposal for proposal in proposals if proposal.protein_length is not None]
        if not eligible:
            return None
        return sorted(eligible, key=lambda item: (-int(item.protein_length or 0), item.source_protein_id))[0].source_protein_id
    return sorted(proposals, key=lambda item: (-item.evidence_rank, item.source_protein_id))[0].source_protein_id


def rollup_gene(
    *, source_gene_namespace: str, source_gene_identifier: str,
    protein_proposals: Sequence[ProteinClassificationProposal],
    policy: Mapping[str, Any], engineering_dry_run: bool = True,
    attestation: Mapping[str, Any] | None = None,
    curator_selected_protein_id: str | None = None,
) -> GeneRollupProposal:
    validate_rollup_policy(policy)
    _authorized(policy, attestation, engineering_dry_run, "rollup_policy")
    if not protein_proposals:
        raise ShadowFrameworkError("gene rollup requires at least one protein proposal")
    protein_ids = [proposal.source_protein_id for proposal in protein_proposals]
    if len(protein_ids) != len(set(protein_ids)):
        raise ShadowFrameworkError("gene rollup protein proposals must be unique")
    if any(proposal.gene_mapping_state != "exact" for proposal in protein_proposals):
        outcome = RollupOutcome.MAPPING_UNRESOLVED
        diagnostic = "protein_mapping_unresolved"
        policy_disposition = str(policy["unresolved_mapping_policy"])
        selected_entry = None
        alternatives: tuple[str, ...] = ()
    else:
        supporters = [
            proposal for proposal in protein_proposals
            if proposal.protein_outcome == ProteinOutcome.SUPPORTED.value and proposal.output_entry_id
        ]
        entries = sorted({str(proposal.output_entry_id) for proposal in supporters})
        explicit_conflict = any(
            proposal.protein_outcome == ProteinOutcome.CONFLICTED.value for proposal in protein_proposals
        )
        if len(entries) > 1 or explicit_conflict:
            outcome = RollupOutcome.CONFLICTED
            diagnostic = "isoform_classification_conflict"
            policy_disposition = str(policy["conflict_policy"])
            selected_entry = None
            alternatives = tuple(entries)
        elif entries:
            selected_entry = entries[0]
            alternatives = ()
            mode = policy["positive_isoform_policy"]
            if mode == "all_evaluated_isoforms" and any(
                proposal.protein_outcome != ProteinOutcome.SUPPORTED.value
                or proposal.output_entry_id != selected_entry
                for proposal in protein_proposals
            ):
                if any(
                    proposal.protein_outcome in {
                        ProteinOutcome.INSUFFICIENT_EVIDENCE.value,
                        ProteinOutcome.NOT_EVALUABLE.value,
                    }
                    for proposal in protein_proposals
                ):
                    outcome = RollupOutcome.INSUFFICIENT_EVIDENCE
                    diagnostic = "evidence_completeness_unknown"
                    policy_disposition = None
                else:
                    outcome = RollupOutcome.NOT_SUPPORTED
                    diagnostic = None
                    policy_disposition = None
            elif mode == "representative_isoform_only":
                representative = _representative(protein_proposals, policy, curator_selected_protein_id)
                selected = next(item for item in protein_proposals if item.source_protein_id == representative)
                if selected.protein_outcome == ProteinOutcome.SUPPORTED.value:
                    outcome = RollupOutcome.SUPPORTED
                    diagnostic = None
                    policy_disposition = None
                    selected_entry = selected.output_entry_id
                elif selected.protein_outcome in {
                    ProteinOutcome.INSUFFICIENT_EVIDENCE.value,
                    ProteinOutcome.NOT_EVALUABLE.value,
                }:
                    outcome = RollupOutcome.INSUFFICIENT_EVIDENCE
                    diagnostic = "evidence_completeness_unknown"
                    policy_disposition = None
                    selected_entry = None
                else:
                    outcome = RollupOutcome.NOT_SUPPORTED
                    diagnostic = None
                    policy_disposition = None
                    selected_entry = None
            else:
                outcome = RollupOutcome.SUPPORTED
                diagnostic = None
                policy_disposition = None
        elif any(
            proposal.protein_outcome in {
                ProteinOutcome.INSUFFICIENT_EVIDENCE.value,
                ProteinOutcome.NOT_EVALUABLE.value,
            }
            for proposal in protein_proposals
        ):
            outcome = RollupOutcome.INSUFFICIENT_EVIDENCE
            diagnostic = "evidence_completeness_unknown"
            policy_disposition = None
            selected_entry = None
            alternatives = ()
        else:
            outcome = RollupOutcome.NOT_SUPPORTED
            diagnostic = None
            policy_disposition = None
            selected_entry = None
            alternatives = ()
    representative = _representative(protein_proposals, policy, curator_selected_protein_id)
    supporting = tuple(sorted(
        proposal.source_protein_id for proposal in protein_proposals
        if proposal.protein_outcome == ProteinOutcome.SUPPORTED.value
    ))
    conflicting = tuple(sorted(
        proposal.source_protein_id for proposal in protein_proposals
        if proposal.protein_outcome == ProteinOutcome.CONFLICTED.value
        or (
            selected_entry is not None
            and proposal.output_entry_id is not None
            and proposal.output_entry_id != selected_entry
        )
    ))
    insufficient = tuple(sorted(
        proposal.source_protein_id for proposal in protein_proposals
        if proposal.protein_outcome in {
            ProteinOutcome.INSUFFICIENT_EVIDENCE.value,
            ProteinOutcome.NOT_EVALUABLE.value,
        }
    ))
    evaluation_ids = tuple(sorted({
        evaluation_id
        for proposal in protein_proposals
        for evaluation_id in proposal.evaluation_ids
    }))
    supporting_evaluation_ids = tuple(sorted({
        evaluation_id
        for proposal in protein_proposals
        if (
            proposal.protein_outcome == ProteinOutcome.SUPPORTED.value
            and proposal.output_entry_id == selected_entry
        )
        for evaluation_id in proposal.evaluation_ids
    }))
    evaluation_hash = content_hash(evaluation_ids)
    policy_hash = content_hash(policy)
    proposal_payload = {
        "source_gene_namespace": source_gene_namespace,
        "source_gene_identifier": source_gene_identifier,
        "output_entry_id": selected_entry,
        "alternative_entry_ids": alternatives,
        "rollup_outcome": outcome.value,
        "input_evaluation_set_hash": evaluation_hash,
        "rollup_policy_id": policy["policy_id"],
        "rollup_policy_version": policy["version"],
        "rollup_policy_hash": policy_hash,
        "policy_disposition": policy_disposition,
    }
    return GeneRollupProposal(
        rollup_proposal_id="gfgrp1:" + content_hash(proposal_payload),
        source_gene_namespace=source_gene_namespace,
        source_gene_identifier=source_gene_identifier,
        output_entry_id=selected_entry,
        alternative_entry_ids=alternatives,
        rollup_outcome=outcome.value,
        supporting_proteins=supporting,
        conflicting_proteins=conflicting,
        insufficient_proteins=insufficient,
        representative_protein=representative,
        input_evaluation_ids=evaluation_ids,
        supporting_evaluation_ids=supporting_evaluation_ids,
        input_evaluation_set_hash=evaluation_hash,
        evidence_complete=all(proposal.evidence_complete for proposal in protein_proposals),
        accepted_classification_admissible=all(
            proposal.accepted_classification_admissible
            for proposal in protein_proposals
            if proposal.source_protein_id in supporting
        ),
        candidate_classification_admissible=all(
            proposal.candidate_classification_admissible
            for proposal in protein_proposals
            if proposal.source_protein_id in supporting
        ),
        rollup_policy_id=str(policy["policy_id"]),
        rollup_policy_version=str(policy["version"]),
        rollup_policy_hash=policy_hash,
        policy_disposition=policy_disposition,
        diagnostic_code=diagnostic,
    )


def plan_shadow_publication(
    *, rollup: GeneRollupProposal, mapping_state: str,
    policy: Mapping[str, Any], engineering_dry_run: bool = True,
    attestation: Mapping[str, Any] | None = None,
) -> ShadowPublicationProposal:
    validate_publication_policy(policy)
    authorized = _authorized(
        policy, attestation, engineering_dry_run, "publication_policy"
    )
    if mapping_state not in {"exact", "ambiguous", "unmapped", "not_applicable"}:
        raise ShadowFrameworkError("invalid mapping state")
    diagnostic = rollup.diagnostic_code
    if mapping_state in {"ambiguous", "unmapped"}:
        action = policy["mapping_exception_action"]
        diagnostic = "protein_mapping_unresolved"
        if rollup.policy_disposition == "no_publication":
            action = PublicationDecision.NO_PUBLICATION.value
        elif rollup.policy_disposition == "needs_curator_review":
            action = PublicationDecision.NEEDS_CURATOR_REVIEW.value
    elif rollup.rollup_outcome == RollupOutcome.SUPPORTED.value:
        action = (
            policy["matched_complete_action"]
            if (
                rollup.evidence_complete
                and rollup.accepted_classification_admissible
            )
            else policy["matched_incomplete_action"]
        )
    elif rollup.rollup_outcome == RollupOutcome.CONFLICTED.value:
        action = policy["conflict_action"]
        if rollup.policy_disposition == "no_publication":
            action = PublicationDecision.NO_PUBLICATION.value
        elif rollup.policy_disposition == "needs_curator_review":
            action = PublicationDecision.NEEDS_CURATOR_REVIEW.value
    elif rollup.rollup_outcome in {
        RollupOutcome.INSUFFICIENT_EVIDENCE.value,
        RollupOutcome.MAPPING_UNRESOLVED.value,
    }:
        action = policy["not_evaluable_action"]
    else:
        action = PublicationDecision.NO_PUBLICATION.value
    decision = PublicationDecision(action)
    if (
        decision is PublicationDecision.PROPOSED_ACCEPTED
        and not rollup.accepted_classification_admissible
    ):
        decision = PublicationDecision.NEEDS_CURATOR_REVIEW
    if (
        decision is PublicationDecision.PROPOSED_CANDIDATE
        and not rollup.candidate_classification_admissible
    ):
        decision = PublicationDecision.NEEDS_CURATOR_REVIEW
    state = {
        PublicationDecision.PROPOSED_ACCEPTED: "accepted",
        PublicationDecision.PROPOSED_CANDIDATE: "candidate",
    }.get(decision)
    proposed_entry = rollup.output_entry_id if decision in {
        PublicationDecision.PROPOSED_ACCEPTED,
        PublicationDecision.PROPOSED_CANDIDATE,
    } else None
    selected_evaluation_id = (
        rollup.supporting_evaluation_ids[0]
        if proposed_entry and rollup.supporting_evaluation_ids
        else None
    )
    alternative_evaluation_ids = tuple(
        evaluation_id for evaluation_id in rollup.input_evaluation_ids
        if evaluation_id != selected_evaluation_id
    )
    policy_hash = content_hash(policy)
    decision_input = {
        "rollup_proposal_id": rollup.rollup_proposal_id,
        "rollup_hash": content_hash(rollup.as_dict()),
        "mapping_state": mapping_state,
        "publication_policy_id": policy["policy_id"],
        "publication_policy_version": policy["version"],
        "publication_policy_hash": policy_hash,
        "publication_decision": decision.value,
    }
    return ShadowPublicationProposal(
        publication_proposal_id="gfpp1:" + content_hash(decision_input),
        rollup_proposal_id=rollup.rollup_proposal_id,
        publication_policy_id=str(policy["policy_id"]),
        publication_decision=decision.value,
        proposed_assertion_state=state,
        proposed_entry_id=proposed_entry,
        selected_evaluation_id=selected_evaluation_id,
        alternative_evaluation_ids=alternative_evaluation_ids,
        decision_input_hash=content_hash(decision_input),
        publication_policy_version=str(policy["version"]),
        publication_policy_hash=policy_hash,
        diagnostic_code=diagnostic,
        scientific_shadow_authorized=authorized,
    )


def semantic_proposal_hash(
    rollups: Sequence[GeneRollupProposal], publications: Sequence[ShadowPublicationProposal],
) -> str:
    return content_hash({
        "rollups": sorted((item.as_dict() for item in rollups), key=lambda item: item["rollup_proposal_id"]),
        "publications": sorted(
            (item.as_dict() for item in publications),
            key=lambda item: item["publication_proposal_id"],
        ),
    })
