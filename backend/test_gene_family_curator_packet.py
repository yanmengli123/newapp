"""Tests for the read-only RC2-B curator packet builder."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from backend.gene_family_curator_packet import (
    _domain_proposals,
    _mapping_rows,
    generate_curator_packet,
)


def mapping_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE gf_subject (
            subject_pk INTEGER PRIMARY KEY, release_id TEXT, source_namespace TEXT,
            source_accession TEXT, gene_symbol TEXT, mapping_state TEXT,
            internal_gene_id TEXT
        );
        CREATE TABLE gf_entry (entry_id TEXT PRIMARY KEY, accession TEXT);
        CREATE TABLE gf_assertion (
            assertion_id TEXT PRIMARY KEY, subject_pk INTEGER, entry_id TEXT,
            scheme_id TEXT, assertion_state TEXT, representative_protein_id TEXT,
            review_state TEXT
        );
        CREATE TABLE gf_identifier_mapping (
            release_id TEXT, source_namespace TEXT, source_accession TEXT,
            mapping_state TEXT, internal_gene_id TEXT,
            candidate_gene_ids_json TEXT, mapping_method TEXT
        );
        """
    )
    connection.execute("INSERT INTO gf_entry VALUES ('entry', 'E3_CRL_adaptor')")
    connection.executemany(
        "INSERT INTO gf_subject VALUES (?, 'rc1', 'ncbigene', ?, ?, ?, NULL)",
        [
            (1, "107051871", "KCTD12", "ambiguous"),
            (2, "415944", "BAP1", "ambiguous"),
        ],
    )
    connection.executemany(
        "INSERT INTO gf_assertion VALUES (?, ?, 'entry', 'ubiquitin_core', 'accepted', ?, 'needs_mapping')",
        [("a1", 1, "XP_1"), ("a2", 2, "XP_2")],
    )
    connection.executemany(
        "INSERT INTO gf_identifier_mapping VALUES ('rc1', 'ncbigene', ?, ?, ?, ?, 'ncbigene')",
        [
            ("107051871", "exact", "gene-KCTD12", '["gene-KCTD12"]'),
            ("415944", "ambiguous", None, '["gene-BAP1","gene-BAP1-2"]'),
        ],
    )
    return connection


def test_mapping_packet_separates_engineering_mismatch_from_curator_review():
    connection = mapping_connection()
    consistency, review = _mapping_rows(connection)
    by_id = {row["source_identifier"]: row for row in consistency}
    assert by_id["107051871"]["consistency_status"] == "cross_table_mismatch"
    assert by_id["107051871"]["scientific_review_required"] == "false"
    assert by_id["415944"]["consistency_status"] == "consistent"
    assert by_id["415944"]["scientific_review_required"] == "true"
    assert len(review) == 2
    connection.close()


def test_domain_inventory_uses_proposal_ids_not_approved_term_ids():
    proposals = _domain_proposals(
        [
            {
                "pfam_accs": "PF00005,PF00664",
                "pfam_names": "ABC_tran,ABC_membrane",
                "gene_ids": "100049619",
                "family_or_set": "E3_RBR",
            }
        ],
        [
            {"pfam_accession": "PF00005", "pfam_accession_version": "PF00005.34"},
            {"pfam_accession": "PF00664", "pfam_accession_version": "PF00664.29"},
        ],
    )
    assert {row["proposal_id"] for row in proposals} == {"PROP-DOM-PF00005", "PROP-DOM-PF00664"}
    assert all(row["suggested_term_id"].startswith("SUGGESTED:") for row in proposals)
    assert all(row["proposal_status"] == "machine_proposal_only" for row in proposals)


def test_packet_builder_refuses_to_overwrite_existing_output(tmp_path: Path):
    output = tmp_path / "existing"
    output.mkdir()
    with pytest.raises(FileExistsError):
        generate_curator_packet(
            rc1_db=tmp_path / "missing.sqlite",
            source_root=tmp_path,
            manifest_path=tmp_path / "missing.json",
            primary_members=tmp_path / "missing.tsv",
            output_dir=output,
            generator_commit="deadbeef",
        )

