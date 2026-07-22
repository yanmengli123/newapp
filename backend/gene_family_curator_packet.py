"""Create a read-only, machine-proposed RC2-B curator review packet.

The packet contains facts and templates, never scientific approvals. RC1 is
opened through an immutable SQLite URI and every manifest-declared source is
rehashed before any output is created.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


PACKET_FORMAT = "gf-rc2b-curator-packet-1.1"
PACKET_ID = "rc2b-curator-packet-v1.1"
TRACE_DIAGNOSTIC_PROPOSALS = (
    "alignment_coordinate_not_reported",
    "child_result_unknown",
    "domain_order_not_evaluable",
    "evidence_completeness_unknown",
    "evidence_source_admissible",
    "evidence_source_candidate_only",
    "evidence_source_not_admissible",
    "evidence_source_admissibility_unknown",
    "excluded_domain_present",
    "fact_not_reported",
    "fact_value_unknown",
    "isoform_classification_conflict",
    "multiple_candidate_rules",
    "protein_mapping_unresolved",
    "required_domain_for_order_missing",
    "required_domain_unknown",
    "scan_not_confirmed",
    "subject_not_in_scan_universe",
    "threshold_policy_unknown",
)


class CuratorPacketError(ValueError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_json(value: Any) -> str:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    )


def short_hash(value: Any, length: int = 16) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()[:length]


def _immutable_connection(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        raise CuratorPacketError(f"RC1 database is missing: {path}")
    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro&immutable=1", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


def _validate_sources(source_root: Path, manifest_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    declared = manifest.get("source_files")
    if not isinstance(declared, list) or not declared:
        raise CuratorPacketError("release manifest has no source_files")
    facts: list[dict[str, Any]] = []
    for record in declared:
        relative = record.get("relative_path")
        if not isinstance(relative, str) or not relative:
            raise CuratorPacketError("source manifest contains an invalid relative_path")
        path = source_root / relative
        if not path.is_file():
            raise CuratorPacketError(f"manifest source is missing: {relative}")
        actual_hash = sha256_file(path)
        actual_size = path.stat().st_size
        if actual_hash != record.get("sha256") or actual_size != record.get("byte_size"):
            raise CuratorPacketError(f"manifest source changed: {relative}")
        facts.append({
            "relative_path": relative,
            "sha256": actual_hash,
            "byte_size": actual_size,
            "row_count": record.get("row_count"),
            "validation_status": record.get("validation_status"),
        })
    return manifest, facts


def _query(connection: sqlite3.Connection, sql: str, parameters: Sequence[Any] = ()) -> list[dict[str, Any]]:
    return [dict(row) for row in connection.execute(sql, parameters).fetchall()]


def _ubiquitin_subject_universe(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    return _query(
        connection,
        """
        SELECT
            a.assertion_id,
            s.source_namespace,
            s.source_accession AS source_identifier,
            s.gene_symbol,
            s.internal_gene_id,
            s.mapping_state,
            s.mapping_method,
            e.accession AS current_class,
            a.assertion_state AS current_assertion_state,
            a.support_tier,
            a.review_state,
            a.representative_protein_id,
            a.source_record_id,
            a.rule_id
        FROM gf_assertion a
        JOIN gf_subject s ON s.subject_pk = a.subject_pk
        JOIN gf_entry e ON e.entry_id = a.entry_id
        WHERE a.scheme_id = 'ubiquitin_core'
        ORDER BY s.source_namespace, s.source_accession, e.accession
        """,
    )


def _mapping_rows(connection: sqlite3.Connection) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows = _query(
        connection,
        """
        SELECT
            a.assertion_id,
            a.assertion_state,
            e.accession AS current_class,
            s.source_namespace,
            s.source_accession AS source_identifier,
            s.gene_symbol,
            s.mapping_state AS gf_subject_status,
            s.internal_gene_id AS gf_subject_internal_gene_id,
            m.mapping_state AS registry_mapping_status,
            m.internal_gene_id AS registry_internal_gene_id,
            COALESCE(m.candidate_gene_ids_json, '[]') AS registry_candidate_gene_ids_json,
            m.mapping_method AS registry_mapping_method,
            a.representative_protein_id,
            a.review_state
        FROM gf_assertion a
        JOIN gf_subject s ON s.subject_pk = a.subject_pk
        JOIN gf_entry e ON e.entry_id = a.entry_id
        LEFT JOIN gf_identifier_mapping m
          ON m.release_id = s.release_id
         AND m.source_namespace = s.source_namespace
         AND m.source_accession = s.source_accession
        WHERE a.scheme_id = 'ubiquitin_core'
        ORDER BY s.source_namespace, s.source_accession, e.accession
        """,
    )
    consistency: list[dict[str, Any]] = []
    review: list[dict[str, Any]] = []
    for row in rows:
        registry = row["registry_mapping_status"]
        subject = row["gf_subject_status"]
        if registry is None:
            status = "registry_row_missing"
            action = "engineering_investigation"
            scientific = "false"
        elif registry != subject:
            status = "cross_table_mismatch"
            action = "engineering_reconcile_in_future_derived_build"
            scientific = "false"
        else:
            status = "consistent"
            if subject in {"ambiguous", "unmapped"}:
                action = "curator_review" if row["assertion_state"] == "accepted" else "review_before_promotion"
                scientific = "true"
            else:
                action = "none"
                scientific = "false"
        item = {
            **row,
            "consistency_status": status,
            "engineering_reason": "",
            "scientific_review_required": scientific,
            "proposed_action": action,
        }
        consistency.append(item)
        if status != "consistent" or subject in {"ambiguous", "unmapped"}:
            review.append({
                **item,
                "curator_disposition": "",
                "curator_rationale": "",
                "curator_reference": "",
            })
    return consistency, review


def _scan_rows(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = _query(
        connection,
        """
        SELECT
            s.source_namespace,
            s.source_accession AS source_protein_id,
            s.protein_accession,
            s.internal_gene_id,
            s.gene_symbol,
            COUNT(d.evidence_id) AS observed_hit_count
        FROM gf_subject s
        LEFT JOIN gf_domain_hit d ON d.subject_pk = s.subject_pk
        WHERE s.subject_type = 'protein'
        GROUP BY s.subject_pk
        ORDER BY s.source_namespace, s.source_accession
        """,
    )
    return [
        {
            **row,
            "scan_attempted": "unknown_legacy",
            "scan_completed": "unknown_legacy",
            "threshold_known": "false",
            "no_hit_confirmed": "false",
            "evidence_completeness": "unknown_legacy",
            "failure_code": "scan_not_confirmed",
        }
        for row in rows
    ]


def _threshold_rows(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = _query(
        connection,
        """
        SELECT
            d.pfam_accession,
            d.pfam_accession_version,
            d.pfam_name,
            COUNT(*) AS observed_hit_count,
            SUM(CASE WHEN d.threshold_pass IS NULL THEN 1 ELSE 0 END) AS threshold_pass_missing_count,
            MIN(d.domain_score) AS min_domain_score,
            MAX(d.domain_score) AS max_domain_score
        FROM gf_domain_hit d
        GROUP BY d.pfam_accession, d.pfam_accession_version, d.pfam_name
        ORDER BY d.pfam_accession
        """,
    )
    return [
        {
            **row,
            "pfam_release": "",
            "hmmer_version": "",
            "threshold_type": "source_policy_unknown",
            "sequence_threshold": "",
            "domain_threshold": "",
            "threshold_source": "not_reported",
            "threshold_version": "",
            "provenance_status": "unknown_legacy",
        }
        for row in rows
    ]


def _pfam_inventory(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    return _query(
        connection,
        """
        SELECT
            d.pfam_accession,
            d.pfam_accession_version,
            d.pfam_name,
            COUNT(*) AS observed_hit_count,
            COUNT(DISTINCT d.subject_pk) AS observed_protein_count,
            MIN(d.ali_from) AS min_alignment_start,
            MAX(d.ali_to) AS max_alignment_end
        FROM gf_domain_hit d
        GROUP BY d.pfam_accession, d.pfam_accession_version, d.pfam_name
        ORDER BY d.pfam_accession
        """,
    )


def _read_primary_members(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        required = {
            "gene_key", "gene_ids", "gene_symbols", "protein_ids", "family_or_set",
            "subfamily", "classification_basis", "evidence_source", "evidence_level",
            "manual_check_required", "pfam_names", "pfam_accs", "products",
        }
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise CuratorPacketError(f"primary member table lacks columns: {sorted(missing)}")
        return [dict(row) for row in reader]


def _isoform_rows(
    primary_rows: Sequence[Mapping[str, str]], universe: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    universe_by_source = {str(row["source_identifier"]): row for row in universe}
    rows: list[dict[str, Any]] = []
    for source in primary_rows:
        proteins = [item.strip() for item in source["protein_ids"].split(",") if item.strip()]
        gene_ids = [item.strip() for item in source["gene_ids"].split(",") if item.strip()]
        primary_gene = gene_ids[0] if gene_ids else source["gene_key"].removeprefix("gene_id:")
        current = universe_by_source.get(primary_gene, {})
        rows.append({
            "gene_key": source["gene_key"],
            "source_gene_identifier": primary_gene,
            "gene_symbols": source["gene_symbols"],
            "current_class": source["family_or_set"],
            "current_assertion_state": current.get("current_assertion_state", ""),
            "representative_protein": current.get("representative_protein_id", ""),
            "protein_count": len(proteins),
            "protein_ids": ",".join(proteins),
            "isoform_evaluation_status": "not_evaluated",
            "conflict_status": "unknown",
            "rollup_policy_status": "not_defined",
            "review_priority": "multi_isoform" if len(proteins) > 1 else "single_protein",
        })
    return sorted(rows, key=lambda row: (str(row["source_gene_identifier"]), str(row["current_class"])))


def _domain_proposals(
    primary_rows: Sequence[Mapping[str, str]], threshold_rows: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    versions = {
        row["pfam_accession"]: row["pfam_accession_version"] for row in threshold_rows
    }
    aggregate: dict[str, dict[str, Any]] = {}
    for row in primary_rows:
        accessions = [item.strip() for item in row["pfam_accs"].split(",") if item.strip()]
        names = [item.strip() for item in row["pfam_names"].split(",") if item.strip()]
        for index, accession in enumerate(accessions):
            name = names[index] if index < len(names) else ""
            item = aggregate.setdefault(accession, {
                "proposal_id": f"PROP-DOM-{accession}",
                "suggested_term_id": f"SUGGESTED:{accession}",
                "pfam_accession": accession,
                "pfam_accession_version": versions.get(accession, ""),
                "pfam_name": name,
                "observed_gene_ids": set(),
                "observed_classes": set(),
                "intended_use_proposal": set(),
            })
            item["observed_gene_ids"].update(
                part.strip() for part in row["gene_ids"].split(",") if part.strip()
            )
            item["observed_classes"].add(row["family_or_set"])
            item["intended_use_proposal"].add("candidate_evidence_inventory")
    return [
        {
            "proposal_id": item["proposal_id"],
            "suggested_term_id": item["suggested_term_id"],
            "display_name_proposal": item["pfam_name"],
            "biological_definition_proposal": "",
            "pfam_accession": item["pfam_accession"],
            "pfam_accession_version": item["pfam_accession_version"],
            "model_version_status": "accession_version_observed_global_release_unknown",
            "intended_use_proposal": ",".join(sorted(item["intended_use_proposal"])),
            "observed_gene_count": len(item["observed_gene_ids"]),
            "observed_classes": ",".join(sorted(item["observed_classes"])),
            "known_caveats": "threshold policy and scan completeness not reported",
            "proposal_status": "machine_proposal_only",
            "curator_decision": "",
            "curator_comment": "",
        }
        for _, item in sorted(aggregate.items())
    ]


def _rule_proposals(primary_rows: Sequence[Mapping[str, str]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in primary_rows:
        key = (row["family_or_set"], row["subfamily"], row["classification_basis"])
        item = grouped.setdefault(key, {
            "genes": set(), "evidence_levels": set(), "manual_states": set(),
        })
        item["genes"].update(part.strip() for part in row["gene_ids"].split(",") if part.strip())
        item["evidence_levels"].add(row["evidence_level"])
        item["manual_states"].add(row["manual_check_required"])
    output: list[dict[str, Any]] = []
    for key, item in sorted(grouped.items()):
        class_name, subfamily, basis = key
        proposal_id = "PROP-RULE-" + short_hash({"class": class_name, "subfamily": subfamily, "basis": basis})
        output.append({
            "proposal_id": proposal_id,
            "suggested_rule_id": "",
            "current_output_class": class_name,
            "current_subfamily": subfamily,
            "legacy_classification_basis": basis,
            "observed_gene_count": len(item["genes"]),
            "observed_evidence_levels": ",".join(sorted(item["evidence_levels"])),
            "observed_manual_check_states": ",".join(sorted(item["manual_states"])),
            "positive_condition_proposal": "",
            "negative_condition_proposal": "",
            "candidate_condition_proposal": "",
            "priority_proposal": "",
            "reason_code_proposal": "",
            "proposal_status": "machine_inventory_only",
            "curator_decision": "",
        })
    return output


def _regression_candidates(
    universe: Sequence[Mapping[str, Any]], primary_rows: Sequence[Mapping[str, str]],
) -> list[dict[str, Any]]:
    primary_by_gene: dict[str, Mapping[str, str]] = {}
    for row in primary_rows:
        for gene_id in (part.strip() for part in row["gene_ids"].split(",")):
            if gene_id:
                primary_by_gene[gene_id] = row
    output: list[dict[str, Any]] = []
    for row in universe:
        symbol = str(row.get("gene_symbol") or "")
        mapping_issue = row.get("mapping_state") in {"ambiguous", "unmapped"}
        if symbol.upper() != "CFTR" and not mapping_issue:
            continue
        source = primary_by_gene.get(str(row["source_identifier"]), {})
        if symbol.upper() == "CFTR":
            fixture_type = "explicit_negative_exclusion_candidate"
            review_focus = "ABC transporter architecture; must not emit accepted E3_RBR"
        else:
            fixture_type = "mapping_boundary_candidate"
            review_focus = "mapping disposition and accepted-metric impact"
        output.append({
            "proposal_id": "PROP-FIXTURE-" + short_hash({
                "subject": row["source_identifier"], "class": row["current_class"],
            }),
            "fixture_type_proposal": fixture_type,
            "subject_namespace": row["source_namespace"],
            "subject_identifier": row["source_identifier"],
            "gene_symbol": symbol,
            "current_class": row["current_class"],
            "current_assertion_state": row["current_assertion_state"],
            "protein_ids": source.get("protein_ids", row.get("representative_protein_id", "")),
            "pfam_accessions": source.get("pfam_accs", ""),
            "review_focus": review_focus,
            "expected_rule_outcome": "",
            "expected_publication_decision": "",
            "proposal_status": "requires_curator_decision",
        })
    return output


def _evidence_admissibility() -> list[dict[str, Any]]:
    return [
        {
            "evidence_source_id": "rc1_all_pfam_hits",
            "source_artifact": "all_pfam_hits.tsv",
            "supports_observed_hit": "true",
            "supports_passing_hit": "false",
            "supports_absence": "false",
            "supports_domain_order": "conditional_on_future_threshold_admission",
            "supports_accepted_classification": "false",
            "supports_candidate_classification": "true",
            "reason_code": "threshold_policy_unknown",
            "admissibility_status": "engineering_assessment_not_curator_approved",
        },
        {
            "evidence_source_id": "rc1_ubiquitin_primary",
            "source_artifact": "chicken_ubiquitin_core_primary_members.tsv",
            "supports_observed_hit": "false",
            "supports_passing_hit": "false",
            "supports_absence": "false",
            "supports_domain_order": "false",
            "supports_accepted_classification": "false",
            "supports_candidate_classification": "legacy_only",
            "reason_code": "legacy_provenance_incomplete",
            "admissibility_status": "engineering_assessment_not_curator_approved",
        },
        {
            "evidence_source_id": "rc1_product_annotation",
            "source_artifact": "chicken_ubiquitin_core_primary_members.tsv:products",
            "supports_observed_hit": "false",
            "supports_passing_hit": "false",
            "supports_absence": "false",
            "supports_domain_order": "false",
            "supports_accepted_classification": "false",
            "supports_candidate_classification": "true",
            "reason_code": "candidate_product_only",
            "admissibility_status": "engineering_assessment_not_curator_approved",
        },
    ]


def _write_tsv(path: Path, rows: Sequence[Mapping[str, Any]], fields: Sequence[str] | None = None) -> int:
    if fields is None:
        fields = list(rows[0]) if rows else []
    if not fields:
        raise CuratorPacketError(f"cannot write fieldless TSV: {path.name}")
    with path.open("x", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(fields), delimiter="\t", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


def _write_text(path: Path, value: str) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(value.rstrip() + "\n")


def _write_json(path: Path, value: Any) -> None:
    _write_text(path, json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False))


def _packet_readme(summary: Mapping[str, Any]) -> str:
    return f"""# RC2-B curator review packet v1.1

Status: machine-generated review material; not a scientific approval.

This create-only packet was derived from immutable RC1 sources. It separates
machine proposals from curator decisions. Empty decision templates do not grant
permission for a scientific shadow run.

## Frozen facts

- RC1 ubiquitin primary assertions: {summary['ubiquitin_total']}
- Accepted: {summary['accepted']}; candidate: {summary['candidate']}
- Accepted mapping exceptions: {summary['accepted_mapping_exceptions']}
- Mapping cross-table mismatches: {summary['mapping_cross_table_mismatches']}
- Protein subjects represented in RC1: {summary['protein_subjects']}
- Protein subjects with one or more observed Pfam hits: {summary['proteins_with_hits']}
- Pfam observed hits with unknown threshold pass: {summary['threshold_pass_unknown_hits']}

## Interpretation boundary

Observed Pfam rows prove only that a hit was emitted. The packet does not claim
that the original threshold policy, complete scan universe, Pfam release,
HMMER version or proteome version is known. It cannot prove domain absence or a
complete Gallus gallus ubiquitin catalog.

KCTD12 cross-table mapping inconsistencies are engineering review items. BAP1
and LOC100859273 remain scientific/data-curation review items. No RC1 table is
modified by this packet.

Files under `machine-proposals/` are suggestions or inventories. Files under
`curator-decisions/` are unapproved templates and must be completed and bound to
artifact hashes by an identified curator before use.
"""


def generate_curator_packet(
    *, rc1_db: Path, source_root: Path, manifest_path: Path,
    primary_members: Path, output_dir: Path, generator_commit: str,
) -> dict[str, Any]:
    if output_dir.exists():
        raise FileExistsError(f"packet output already exists: {output_dir}")
    if not generator_commit or len(generator_commit) < 7:
        raise CuratorPacketError("generator_commit is required")
    manifest, source_facts = _validate_sources(source_root, manifest_path)
    primary_hash_before = sha256_file(primary_members)
    db_hash_before = sha256_file(rc1_db)
    primary_rows = _read_primary_members(primary_members)
    with _immutable_connection(rc1_db) as connection:
        universe = _ubiquitin_subject_universe(connection)
        mapping_consistency, mapping_review = _mapping_rows(connection)
        scan_rows = _scan_rows(connection)
        threshold_rows = _threshold_rows(connection)
        pfam_inventory = _pfam_inventory(connection)
        domain_proposals = _domain_proposals(primary_rows, threshold_rows)
        rule_proposals = _rule_proposals(primary_rows)
        isoform_rows = _isoform_rows(primary_rows, universe)
        regression_candidates = _regression_candidates(universe, primary_rows)

    if sha256_file(primary_members) != primary_hash_before or sha256_file(rc1_db) != db_hash_before:
        raise CuratorPacketError("an input changed while the packet was being assembled")
    state_counts = Counter(str(row["current_assertion_state"]) for row in universe)
    summary = {
        "ubiquitin_total": len(universe),
        "accepted": state_counts["accepted"],
        "candidate": state_counts["candidate"],
        "accepted_mapping_exceptions": sum(
            row["current_assertion_state"] == "accepted" and row["mapping_state"] in {"ambiguous", "unmapped"}
            for row in universe
        ),
        "mapping_cross_table_mismatches": sum(
            row["consistency_status"] == "cross_table_mismatch" for row in mapping_consistency
        ),
        "protein_subjects": len(scan_rows),
        "proteins_with_hits": sum(int(row["observed_hit_count"]) > 0 for row in scan_rows),
        "threshold_pass_unknown_hits": sum(int(row["threshold_pass_missing_count"]) for row in threshold_rows),
        "pfam_entry_versions": len(threshold_rows),
    }

    output_dir.mkdir(parents=True, exist_ok=False)
    machine_dir = output_dir / "machine-proposals"
    decisions_dir = output_dir / "curator-decisions"
    examples_dir = output_dir / "evidence-examples"
    machine_dir.mkdir()
    decisions_dir.mkdir()
    examples_dir.mkdir()

    row_counts: dict[str, int] = {}
    def emit(relative: str, rows: Sequence[Mapping[str, Any]], fields: Sequence[str] | None = None) -> None:
        row_counts[relative] = _write_tsv(output_dir / relative, rows, fields)

    emit("subject-universe.tsv", universe)
    emit("evidence-admissibility.tsv", _evidence_admissibility())
    emit("scan-completeness.tsv", scan_rows)
    emit("threshold-provenance.tsv", threshold_rows)
    emit("mapping-consistency.tsv", mapping_consistency)
    emit("mapping-review.tsv", mapping_review)
    emit("isoform-rollup-cases.tsv", isoform_rows)
    emit("pfam-accession-inventory.tsv", pfam_inventory)
    emit("regression-candidates.tsv", regression_candidates)
    emit("machine-proposals/domain-term-proposals.tsv", domain_proposals)
    emit("machine-proposals/rule-proposals.tsv", rule_proposals)
    emit("machine-proposals/reason-code-proposals.tsv", [
        {
            "proposal_id": f"PROP-DIAG-{code.upper()}",
            "suggested_diagnostic_code": code,
            "namespace": "trace_diagnostic",
            "proposal_status": "engineering_proposal",
            "curator_decision_required": "false",
        }
        for code in TRACE_DIAGNOSTIC_PROPOSALS
    ])

    cftr = [row for row in universe if str(row.get("gene_symbol") or "").upper() == "CFTR"]
    cftr_ids = {str(row["source_identifier"]) for row in cftr}
    cftr_primary = [
        row for row in primary_rows
        if any(part.strip() in cftr_ids for part in row["gene_ids"].split(","))
    ]
    emit("evidence-examples/cftr-legacy-evidence.tsv", cftr_primary)

    _write_text(decisions_dir / "domain-vocabulary.template.yaml", """
vocabulary_id: gallus-ubiquitin-domain-vocabulary
version: 0.0.0
status: draft
curator: null
approved_by: null
approval_date: null
terms: []
""")
    _write_text(decisions_dir / "rule-catalog.template.yaml", """
catalog_id: gallus-ubiquitin-rule-catalog
version: 0.0.0
status: draft
domain_vocabulary: null
rules: []
""")
    emit(
        "curator-decisions/mapping-decisions.template.tsv", [],
        [
            "proposal_id", "source_namespace", "source_identifier", "decision",
            "rationale", "reference", "curator", "decision_date",
            "source_artifact_hash", "evidence_snapshot_hash",
        ],
    )
    _write_text(decisions_dir / "rollup-policy.template.yaml", """
policy_id: gallus-ubiquitin-rollup-policy
version: 0.0.0
status: draft
positive_isoform_policy: null
conflict_policy: null
representative_protein_policy: null
unresolved_mapping_policy: null
approval_attestation_id: null
""")
    _write_text(decisions_dir / "publication-policy.template.yaml", """
policy_id: gallus-ubiquitin-publication-policy
version: 0.0.0
status: draft
shadow_only: true
matched_complete_action: null
matched_incomplete_action: null
conflict_action: null
not_evaluable_action: null
mapping_exception_action: null
approval_attestation_id: null
""")
    _write_json(decisions_dir / "evidence-admissibility.template.json", {
        "evidence_source_id": None,
        "evidence_source_hash": None,
        "supports_presence": None,
        "supports_absence": None,
        "supports_domain_order": None,
        "supports_accepted_classification": None,
        "supports_candidate_classification": None,
        "diagnostic_code": None,
        "assessment_status": None,
        "approval_attestation_id": None,
    })
    _write_json(decisions_dir / "approval-attestation.template.json", {
        "attestation_id": None,
        "artifact_type": None,
        "artifact_hash_algorithm": "gf-canonical-json-sha256-v1",
        "artifact_sha256": None,
        "approval_scope": None,
        "decision": None,
        "curator": None,
        "approved_at": None,
        "limitations": [],
    })
    _write_text(output_dir / "README.md", _packet_readme(summary))

    packet_manifest = {
        "packet_format": PACKET_FORMAT,
        "packet_id": PACKET_ID,
        "status": "machine_generated_unapproved",
        "generator_commit": generator_commit,
        "source_release_id": manifest.get("release_id"),
        "source_manifest_sha256": sha256_file(manifest_path),
        "source_database_sha256": db_hash_before,
        "source_file_count": len(source_facts),
        "all_source_files_reconciled": True,
        "summary": summary,
        "scientific_shadow_authorized": False,
        "rc2_build_authorized": False,
        "row_counts": dict(sorted(row_counts.items())),
    }
    _write_json(output_dir / "packet-manifest.json", packet_manifest)

    artifact_records: list[dict[str, Any]] = []
    for path in sorted(item for item in output_dir.rglob("*") if item.is_file()):
        relative = path.relative_to(output_dir).as_posix()
        artifact_records.append({
            "relative_path": relative,
            "sha256": sha256_file(path),
            "byte_size": path.stat().st_size,
        })
    _write_text(
        output_dir / "checksums.sha256",
        "\n".join(f"{row['sha256']}  {row['relative_path']}" for row in artifact_records),
    )
    return packet_manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create a read-only RC2-B curator review packet")
    parser.add_argument("--rc1-db", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--primary-members", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--generator-commit", required=True)
    args = parser.parse_args(argv)
    result = generate_curator_packet(
        rc1_db=args.rc1_db,
        source_root=args.source_root,
        manifest_path=args.manifest,
        primary_members=args.primary_members,
        output_dir=args.output,
        generator_commit=args.generator_commit,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
