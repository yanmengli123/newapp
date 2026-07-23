"""Read-only query service for the versioned gene-family annotation catalog."""

from __future__ import annotations

import base64
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


MAX_PAGE_SIZE = 100


def _encode_cursor(offset: int) -> str:
    payload = json.dumps({"offset": offset}, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
        offset = int(payload["offset"])
        if offset < 0:
            raise ValueError
        return offset
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid pagination cursor") from exc


def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


class GeneFamilyCatalogService:
    def __init__(self, db_path: Path, release_root: Path) -> None:
        self.db_path = db_path.resolve()
        self.release_root = release_root.resolve()

    def available(self) -> bool:
        return self.db_path.is_file()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        if not self.available():
            raise FileNotFoundError(f"Gene-family catalog is unavailable: {self.db_path}")
        uri = f"file:{self.db_path.as_posix()}?mode=ro&immutable=1"
        conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only = ON")
        conn.execute("PRAGMA temp_store = MEMORY")
        try:
            yield conn
        finally:
            conn.close()

    def current_release(self) -> dict[str, Any]:
        with self.connect() as conn:
            release = _row(conn.execute("SELECT * FROM gf_release LIMIT 1").fetchone())
            if release is None:
                raise LookupError("Catalog release metadata is missing")
            release["qc"] = {
                row["status"]: row["n"]
                for row in conn.execute(
                    "SELECT status, COUNT(*) AS n FROM gf_qc_result GROUP BY status"
                )
            }
            release["blocking_checks"] = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT check_name, observed_value, expected_value, details
                    FROM gf_qc_result
                    WHERE severity = 'error' AND status = 'failed'
                    ORDER BY qc_result_id
                    """
                )
            ]
            return release

    def summary(self) -> dict[str, Any]:
        with self.connect() as conn:
            release = _row(conn.execute("SELECT * FROM gf_release LIMIT 1").fetchone())
            if release is None:
                raise LookupError("Catalog release metadata is missing")
            release["blocking_checks"] = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT check_name, observed_value, expected_value, details
                    FROM gf_qc_result
                    WHERE severity = 'error' AND status = 'failed'
                    ORDER BY qc_result_id
                    """
                )
            ]
            schemes = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT
                        sc.scheme_id, sc.scheme_name, sc.source_name, sc.source_version,
                        sc.subject_level, sc.description,
                        ss.entry_count, ss.accepted_genes, ss.candidate_genes,
                        ss.unresolved_genes, ss.accepted_proteins,
                        ss.candidate_proteins, ss.annotated_proteins,
                        ss.domain_hits, ss.mapping_coverage,
                        (SELECT COUNT(*) FROM gf_assertion a
                         WHERE a.scheme_id = sc.scheme_id AND a.assertion_state = 'accepted') AS accepted_assertions,
                        (SELECT COUNT(*) FROM gf_assertion a
                         WHERE a.scheme_id = sc.scheme_id AND a.assertion_state = 'candidate') AS candidate_assertions,
                        (SELECT COUNT(DISTINCT a.subject_pk)
                         FROM gf_assertion a JOIN gf_subject s ON s.subject_pk = a.subject_pk
                         WHERE a.scheme_id = sc.scheme_id AND s.internal_gene_id IS NULL) AS mapping_unresolved
                    FROM gf_scheme sc
                    JOIN gf_scheme_summary ss ON ss.scheme_id = sc.scheme_id
                    ORDER BY CASE sc.scheme_id
                        WHEN 'pfam' THEN 1
                        WHEN 'animaltfdb_tf' THEN 2
                        WHEN 'animaltfdb_cofactor' THEN 3
                        WHEN 'kinomer' THEN 4
                        WHEN 'ubiquitin_core' THEN 5
                        ELSE 6 END
                    """
                )
            ]
            unique_genes = conn.execute(
                """
                SELECT COUNT(DISTINCT internal_gene_id)
                FROM gf_subject
                WHERE internal_gene_id IS NOT NULL
                """
            ).fetchone()[0]
            top_entries = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT e.entry_id, e.scheme_id, e.accession, e.name, e.entry_type,
                           es.accepted_genes, es.candidate_genes, es.accepted_proteins
                    FROM gf_entry_summary es JOIN gf_entry e ON e.entry_id = es.entry_id
                    WHERE es.accepted_genes > 0
                    ORDER BY es.accepted_genes DESC, e.name, e.entry_id
                    LIMIT 20
                    """
                )
            ]
            return {
                "release": release,
                "unique_annotated_genes": unique_genes,
                "schemes": schemes,
                "top_entries": top_entries,
            }

    def list_entries(
        self,
        *,
        scheme: str | None = None,
        entry_type: str | None = None,
        query: str | None = None,
        include_candidates: bool = False,
        sort: str = "accepted_genes",
        cursor: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        limit = max(1, min(limit, MAX_PAGE_SIZE))
        offset = _decode_cursor(cursor)
        where = ["1 = 1"]
        params: list[Any] = []
        if scheme:
            where.append("e.scheme_id = ?")
            params.append(scheme)
        if entry_type:
            where.append("e.entry_type = ?")
            params.append(entry_type)
        if query:
            where.append("(LOWER(e.name) LIKE ? OR LOWER(e.accession) LIKE ? OR LOWER(COALESCE(e.definition, '')) LIKE ?)")
            token = f"%{query.strip().lower()}%"
            params.extend([token, token, token])
        if not include_candidates:
            where.append("(es.accepted_genes > 0 OR es.accepted_proteins > 0)")

        order_by = {
            "name": "LOWER(e.name) ASC, e.entry_id ASC",
            "candidate_genes": "es.candidate_genes DESC, LOWER(e.name) ASC, e.entry_id ASC",
            "accepted_genes": "es.accepted_genes DESC, es.accepted_proteins DESC, LOWER(e.name) ASC, e.entry_id ASC",
        }.get(sort, "es.accepted_genes DESC, es.accepted_proteins DESC, LOWER(e.name) ASC, e.entry_id ASC")
        where_sql = " AND ".join(where)
        with self.connect() as conn:
            total = int(
                conn.execute(
                    f"SELECT COUNT(*) FROM gf_entry e JOIN gf_entry_summary es ON es.entry_id = e.entry_id WHERE {where_sql}",
                    params,
                ).fetchone()[0]
            )
            rows = [
                dict(row)
                for row in conn.execute(
                    f"""
                    SELECT
                        e.entry_id, e.scheme_id, sc.scheme_name, e.accession, e.name,
                        e.entry_type, e.definition, e.parent_entry_id, e.external_url,
                        es.accepted_genes, es.candidate_genes, es.unresolved_genes,
                        es.accepted_proteins, es.candidate_proteins,
                        es.evidence_coverage, es.mapping_coverage,
                        (SELECT COUNT(*) FROM gf_assertion a
                         WHERE a.entry_id = e.entry_id AND a.assertion_state = 'accepted') AS accepted_assertions,
                        (SELECT COUNT(*) FROM gf_assertion a
                         WHERE a.entry_id = e.entry_id AND a.assertion_state = 'candidate') AS candidate_assertions
                    FROM gf_entry e
                    JOIN gf_scheme sc ON sc.scheme_id = e.scheme_id
                    JOIN gf_entry_summary es ON es.entry_id = e.entry_id
                    WHERE {where_sql}
                    ORDER BY {order_by}
                    LIMIT ? OFFSET ?
                    """,
                    [*params, limit, offset],
                )
            ]
            next_cursor = _encode_cursor(offset + limit) if offset + limit < total else None
            release_id = conn.execute("SELECT release_id FROM gf_release LIMIT 1").fetchone()[0]
            return {
                "meta": {
                    "release_id": release_id,
                    "unit": "catalog_entries",
                    "total": total,
                    "limit": limit,
                    "next_cursor": next_cursor,
                    "sort": sort,
                    "include_candidates": include_candidates,
                },
                "data": rows,
            }

    def entry(self, entry_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            result = _row(
                conn.execute(
                    """
                    SELECT e.*, sc.scheme_name, sc.source_name, sc.source_version,
                           sc.subject_level, es.accepted_genes, es.candidate_genes,
                           es.unresolved_genes, es.accepted_proteins,
                           es.candidate_proteins, es.evidence_coverage,
                           es.mapping_coverage, p.name AS parent_name
                    FROM gf_entry e
                    JOIN gf_scheme sc ON sc.scheme_id = e.scheme_id
                    JOIN gf_entry_summary es ON es.entry_id = e.entry_id
                    LEFT JOIN gf_entry p ON p.entry_id = e.parent_entry_id
                    WHERE e.entry_id = ?
                    """,
                    (entry_id,),
                ).fetchone()
            )
            if result is None:
                return None
            result["children"] = [
                dict(row)
                for row in conn.execute(
                    "SELECT entry_id, accession, name, entry_type FROM gf_entry WHERE parent_entry_id = ? ORDER BY name",
                    (entry_id,),
                )
            ]
            result["assertion_states"] = {
                row["assertion_state"]: row["n"]
                for row in conn.execute(
                    "SELECT assertion_state, COUNT(*) AS n FROM gf_assertion WHERE entry_id = ? GROUP BY assertion_state",
                    (entry_id,),
                )
            }
            result["support_tiers"] = [
                dict(row)
                for row in conn.execute(
                    "SELECT support_tier, COUNT(*) AS count FROM gf_assertion WHERE entry_id = ? GROUP BY support_tier ORDER BY count DESC",
                    (entry_id,),
                )
            ]
            result["available_sections"] = {
                "domain_architecture": result["scheme_id"] == "pfam",
                "expression_profile": False,
                "genomic_distribution": False,
                "change_history": False,
            }
            return result

    def entry_members(
        self,
        entry_id: str,
        *,
        include_candidates: bool = False,
        assertion_state: str | None = None,
        support_tier: str | None = None,
        review_state: str | None = None,
        assignment_role: str | None = None,
        query: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        limit = max(1, min(limit, MAX_PAGE_SIZE))
        offset = _decode_cursor(cursor)
        where = ["a.entry_id = ?"]
        params: list[Any] = [entry_id]
        if assertion_state:
            where.append("a.assertion_state = ?")
            params.append(assertion_state)
        elif not include_candidates:
            where.append("a.assertion_state = 'accepted'")
        if support_tier:
            where.append("a.support_tier = ?")
            params.append(support_tier)
        if review_state:
            where.append("a.review_state = ?")
            params.append(review_state)
        if assignment_role:
            where.append("a.assignment_role = ?")
            params.append(assignment_role)
        if query:
            token = f"%{query.strip().lower()}%"
            where.append(
                "(LOWER(COALESCE(s.gene_symbol, '')) LIKE ? OR LOWER(COALESCE(s.internal_gene_id, '')) LIKE ? "
                "OR LOWER(COALESCE(s.ncbi_gene_id, '')) LIKE ? OR LOWER(COALESCE(s.ensembl_gene_id, '')) LIKE ? "
                "OR LOWER(COALESCE(s.protein_accession, '')) LIKE ?)"
            )
            params.extend([token] * 5)
        where_sql = " AND ".join(where)
        with self.connect() as conn:
            total = int(
                conn.execute(
                    f"SELECT COUNT(*) FROM gf_assertion a JOIN gf_subject s ON s.subject_pk = a.subject_pk WHERE {where_sql}",
                    params,
                ).fetchone()[0]
            )
            rows = [
                dict(row)
                for row in conn.execute(
                    f"""
                    SELECT
                        a.assertion_id, a.scheme_id, a.entry_id, a.assignment_role,
                        a.assertion_state, a.support_tier, a.review_state,
                        a.representative_protein_id, a.rule_id,
                        s.subject_type, s.internal_gene_id, s.gene_symbol,
                        s.ncbi_gene_id, s.ensembl_gene_id, s.protein_accession,
                        s.transcript_accession, s.protein_length, s.mapping_state,
                        s.mapping_method,
                        (SELECT COUNT(*) FROM gf_assertion_evidence ae WHERE ae.assertion_id = a.assertion_id) AS evidence_count
                    FROM gf_assertion a
                    JOIN gf_subject s ON s.subject_pk = a.subject_pk
                    WHERE {where_sql}
                    ORDER BY LOWER(COALESCE(NULLIF(s.gene_symbol, ''), s.source_accession)),
                             COALESCE(s.internal_gene_id, ''), COALESCE(s.protein_accession, ''), a.assertion_id
                    LIMIT ? OFFSET ?
                    """,
                    [*params, limit, offset],
                )
            ]
            for item in rows:
                item["internal_url"] = f"/gene/{item['internal_gene_id']}" if item["internal_gene_id"] else None
            return {
                "meta": {
                    "total": total,
                    "limit": limit,
                    "next_cursor": _encode_cursor(offset + limit) if offset + limit < total else None,
                    "include_candidates": include_candidates,
                },
                "data": rows,
            }

    def entry_evidence(self, entry_id: str, *, cursor: str | None = None, limit: int = 50) -> dict[str, Any]:
        limit = max(1, min(limit, MAX_PAGE_SIZE))
        offset = _decode_cursor(cursor)
        with self.connect() as conn:
            total = int(
                conn.execute(
                    """
                    SELECT COUNT(*) FROM gf_assertion_evidence ae
                    JOIN gf_assertion a ON a.assertion_id = ae.assertion_id
                    WHERE a.entry_id = ?
                    """,
                    (entry_id,),
                ).fetchone()[0]
            )
            rows = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT ev.evidence_id, ev.evidence_type, ev.source_record_id,
                           sf.file_name AS source_file, ev.method, ev.model_accession,
                           ev.score, ev.sequence_evalue, ev.domain_ievalue,
                           ev.threshold_type, ev.threshold_value, ev.threshold_pass,
                           ev.description, ae.evidence_role, ae.evidence_rank,
                           a.assertion_id, a.assertion_state,
                           s.internal_gene_id, s.gene_symbol, s.protein_accession,
                           s.protein_length,
                           CASE WHEN s.protein_length IS NULL THEN 'not_reported' ELSE 'observed' END AS protein_length_status,
                           dh.ali_from, dh.ali_to, dh.env_from, dh.env_to,
                           dh.domain_index, dh.domain_total
                    FROM gf_assertion_evidence ae
                    JOIN gf_assertion a ON a.assertion_id = ae.assertion_id
                    JOIN gf_evidence ev ON ev.evidence_id = ae.evidence_id
                    JOIN gf_source_file sf ON sf.source_file_id = ev.source_file_id
                    JOIN gf_subject s ON s.subject_pk = a.subject_pk
                    LEFT JOIN gf_domain_hit dh ON dh.evidence_id = ev.evidence_id
                    WHERE a.entry_id = ?
                    ORDER BY LOWER(COALESCE(s.gene_symbol, '')), s.protein_accession,
                             ev.domain_ievalue, ev.evidence_id
                    LIMIT ? OFFSET ?
                    """,
                    (entry_id, limit, offset),
                )
            ]
            return {
                "meta": {
                    "total": total,
                    "limit": limit,
                    "next_cursor": _encode_cursor(offset + limit) if offset + limit < total else None,
                },
                "data": rows,
            }

    def assertion(self, assertion_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            result = _row(
                conn.execute("SELECT * FROM gf_catalog_member WHERE assertion_id = ?", (assertion_id,)).fetchone()
            )
            if result is None:
                return None
            result["evidence"] = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT ev.*, sf.file_name AS source_file, ae.evidence_role, ae.evidence_rank
                    FROM gf_assertion_evidence ae
                    JOIN gf_evidence ev ON ev.evidence_id = ae.evidence_id
                    JOIN gf_source_file sf ON sf.source_file_id = ev.source_file_id
                    WHERE ae.assertion_id = ? ORDER BY ae.evidence_rank, ev.evidence_id
                    """,
                    (assertion_id,),
                )
            ]
            result["review_events"] = [
                dict(row)
                for row in conn.execute(
                    "SELECT * FROM gf_review_event WHERE assertion_id = ? ORDER BY reviewed_at",
                    (assertion_id,),
                )
            ]
            return result

    def gene_annotations(self, internal_gene_id: str) -> dict[str, Any]:
        with self.connect() as conn:
            release_id = conn.execute("SELECT release_id FROM gf_release LIMIT 1").fetchone()[0]
            classifications = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT a.assertion_id, a.scheme_id, sc.scheme_name, a.entry_id,
                           e.accession, e.name AS entry_name, e.entry_type,
                           a.assignment_role, a.assertion_state, a.support_tier,
                           a.review_state, a.representative_protein_id,
                           s.gene_symbol, s.ncbi_gene_id, s.ensembl_gene_id,
                           (SELECT COUNT(*) FROM gf_assertion_evidence ae WHERE ae.assertion_id = a.assertion_id) AS evidence_count
                    FROM gf_assertion a
                    JOIN gf_subject s ON s.subject_pk = a.subject_pk
                    JOIN gf_entry e ON e.entry_id = a.entry_id
                    JOIN gf_scheme sc ON sc.scheme_id = a.scheme_id
                    WHERE s.internal_gene_id = ? AND s.subject_type = 'gene'
                      AND a.scheme_id != 'pfam'
                    ORDER BY CASE a.assertion_state WHEN 'accepted' THEN 1 WHEN 'candidate' THEN 2 ELSE 3 END,
                             sc.scheme_name, e.name, a.assignment_role
                    """,
                    (internal_gene_id,),
                )
            ]
            domain_rows = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT s.protein_accession, s.protein_length, s.transcript_accession,
                           e.entry_id, e.accession AS pfam_accession, e.name AS pfam_name,
                           e.definition, a.assertion_id, dh.domain_index, dh.domain_total,
                           dh.ali_from, dh.ali_to, dh.env_from, dh.env_to,
                           dh.independent_evalue, dh.domain_score, dh.accuracy,
                           dh.threshold_pass
                    FROM gf_assertion a
                    JOIN gf_subject s ON s.subject_pk = a.subject_pk
                    JOIN gf_entry e ON e.entry_id = a.entry_id
                    JOIN gf_assertion_evidence ae ON ae.assertion_id = a.assertion_id
                    JOIN gf_domain_hit dh ON dh.evidence_id = ae.evidence_id
                    WHERE a.scheme_id = 'pfam' AND s.internal_gene_id = ?
                    ORDER BY s.protein_accession, dh.ali_from, dh.ali_to, e.accession
                    """,
                    (internal_gene_id,),
                )
            ]
            proteins: dict[str, dict[str, Any]] = {}
            for hit in domain_rows:
                protein_id = hit.pop("protein_accession")
                protein = proteins.setdefault(
                    protein_id,
                    {
                        "protein_id": protein_id,
                        "protein_length": hit.pop("protein_length"),
                        "transcript_accession": hit.pop("transcript_accession"),
                        "domain_hits": [],
                    },
                )
                hit.pop("protein_length", None)
                hit.pop("transcript_accession", None)
                protein["domain_hits"].append(hit)
            return {
                "release_id": release_id,
                "internal_gene_id": internal_gene_id,
                "summary": {
                    "classification_count": len(classifications),
                    "protein_count": len(proteins),
                    "domain_hit_count": len(domain_rows),
                    "candidate_count": sum(1 for row in classifications if row["assertion_state"] == "candidate"),
                },
                "classifications": classifications,
                "proteins": list(proteins.values()),
            }

    def protein_domain_hits(self, protein_id: str) -> dict[str, Any]:
        with self.connect() as conn:
            rows = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT s.protein_accession, s.protein_length, s.internal_gene_id,
                           e.entry_id, e.accession AS pfam_accession, e.name AS pfam_name,
                           dh.domain_index, dh.domain_total, dh.ali_from, dh.ali_to,
                           dh.env_from, dh.env_to, dh.independent_evalue,
                           dh.domain_score, dh.accuracy, dh.threshold_pass
                    FROM gf_subject s
                    JOIN gf_assertion a ON a.subject_pk = s.subject_pk AND a.scheme_id = 'pfam'
                    JOIN gf_entry e ON e.entry_id = a.entry_id
                    JOIN gf_assertion_evidence ae ON ae.assertion_id = a.assertion_id
                    JOIN gf_domain_hit dh ON dh.evidence_id = ae.evidence_id
                    WHERE s.protein_accession = ?
                    ORDER BY dh.ali_from, dh.ali_to, e.accession
                    """,
                    (protein_id,),
                )
            ]
            return {"protein_id": protein_id, "total": len(rows), "data": rows}

    def search(self, query: str, limit: int = 12) -> dict[str, Any]:
        query = query.strip()
        if not query:
            return {"query": query, "entries": [], "genes": [], "proteins": [], "source_assertions": []}
        limit = max(1, min(limit, 25))
        token = f"%{query.lower()}%"
        with self.connect() as conn:
            entries = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT e.entry_id, e.scheme_id, e.accession, e.name, e.entry_type,
                           es.accepted_genes, es.accepted_proteins
                    FROM gf_entry e JOIN gf_entry_summary es ON es.entry_id = e.entry_id
                    WHERE LOWER(e.accession) LIKE ? OR LOWER(e.name) LIKE ?
                    ORDER BY CASE WHEN LOWER(e.accession) = ? THEN 0 ELSE 1 END,
                             es.accepted_genes DESC, e.name, e.entry_id
                    LIMIT ?
                    """,
                    (token, token, query.lower(), limit),
                )
            ]
            genes = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT internal_gene_id, MAX(gene_symbol) AS gene_symbol,
                           MAX(ncbi_gene_id) AS ncbi_gene_id,
                           MAX(ensembl_gene_id) AS ensembl_gene_id,
                           COUNT(DISTINCT subject_pk) AS subject_count
                    FROM gf_subject
                    WHERE internal_gene_id IS NOT NULL AND (
                        LOWER(internal_gene_id) LIKE ? OR LOWER(COALESCE(gene_symbol, '')) LIKE ?
                        OR LOWER(COALESCE(ncbi_gene_id, '')) LIKE ? OR LOWER(COALESCE(ensembl_gene_id, '')) LIKE ?
                    )
                    GROUP BY internal_gene_id
                    ORDER BY CASE WHEN LOWER(COALESCE(MAX(gene_symbol), '')) = ? THEN 0 ELSE 1 END,
                             MAX(gene_symbol), internal_gene_id
                    LIMIT ?
                    """,
                    (token, token, token, token, query.lower(), limit),
                )
            ]
            for gene in genes:
                gene["internal_url"] = f"/gene/{gene['internal_gene_id']}"
            proteins = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT protein_accession, protein_length, internal_gene_id, gene_symbol
                    FROM gf_subject
                    WHERE subject_type = 'protein' AND LOWER(COALESCE(protein_accession, '')) LIKE ?
                    ORDER BY protein_accession LIMIT ?
                    """,
                    (token, limit),
                )
            ]
            source_assertions = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT a.assertion_id, s.subject_key, s.gene_symbol, s.ncbi_gene_id,
                           s.source_namespace, s.source_accession, a.scheme_id,
                           a.entry_id, e.name AS entry_name, a.assertion_state,
                           s.mapping_state, a.review_state, s.internal_gene_id
                    FROM gf_assertion a
                    JOIN gf_subject s ON s.subject_pk = a.subject_pk
                    JOIN gf_entry e ON e.entry_id = a.entry_id
                    WHERE s.subject_type = 'gene'
                      AND s.internal_gene_id IS NULL
                      AND s.mapping_state IN ('ambiguous', 'unmapped')
                      AND (
                          LOWER(COALESCE(s.gene_symbol, '')) LIKE ?
                          OR LOWER(COALESCE(s.ncbi_gene_id, '')) LIKE ?
                          OR LOWER(COALESCE(s.source_accession, '')) LIKE ?
                      )
                    ORDER BY CASE WHEN LOWER(COALESCE(s.gene_symbol, '')) = ? THEN 0 ELSE 1 END,
                             CASE a.assertion_state WHEN 'accepted' THEN 0 WHEN 'candidate' THEN 1 ELSE 2 END,
                             s.subject_key, a.scheme_id, a.entry_id, a.assertion_id
                    LIMIT ?
                    """,
                    (token, token, token, query.lower(), limit),
                )
            ]
            for assertion in source_assertions:
                assertion["entry_url"] = f"/gene-families/entry/{assertion['entry_id']}"
            return {
                "query": query,
                "entries": entries,
                "genes": genes,
                "proteins": proteins,
                "source_assertions": source_assertions,
            }

    def downloads(self, release_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            active = conn.execute("SELECT release_id FROM gf_release LIMIT 1").fetchone()[0]
            if release_id != active:
                return []
            rows = [dict(row) for row in conn.execute("SELECT * FROM gf_release_asset ORDER BY asset_name")]
            for row in rows:
                path = self.release_root / release_id / row["relative_path"]
                if path.is_file():
                    row["byte_size"] = path.stat().st_size
                row["download_url"] = (
                    f"/api/v1/gene-family-catalog/releases/{release_id}/downloads/{row['asset_name']}"
                )
            return rows

    def download_path(self, release_id: str, asset_name: str) -> Path | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT relative_path FROM gf_release_asset WHERE release_id = ? AND asset_name = ?",
                (release_id, asset_name),
            ).fetchone()
        if row is None:
            return None
        release_dir = (self.release_root / release_id).resolve()
        path = (release_dir / row["relative_path"]).resolve()
        try:
            path.relative_to(release_dir)
        except ValueError:
            return None
        return path if path.is_file() else None
