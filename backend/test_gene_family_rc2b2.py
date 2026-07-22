"""Tests for the RC2-B.2 readiness contracts and read-only universe builder."""

from __future__ import annotations

import csv
import gzip
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from backend.gene_family_handoff_contracts import sha256_file
from backend.gene_family_rc2b2_contracts import validate_rc2b2_contracts
from backend.gene_family_target_universe import (
    UniverseExpectations,
    build_target_universe_submission,
    validate_target_universe_submission,
)


ROOT = Path(__file__).resolve().parent.parent
CONTRACTS = ROOT / "contracts" / "gene-family" / "rc2b2"
PARENT_HANDOFF = (
    ROOT
    / "contracts"
    / "gene-family"
    / "rc2b1"
    / "handoff-contract-manifest-v1.json"
)
SYNTHETIC_EXPECTATIONS = UniverseExpectations(
    target_genes=2,
    target_transcripts=3,
    target_protein_subjects=2,
    noncoding_transcript_exclusions=1,
    scan_execution_sequences=1,
    shared_sequence_groups=1,
    subjects_in_shared_sequence_groups=2,
    scan_execution_reuse_savings=1,
    multi_placement_genes=1,
    annotation_exception_proteins=1,
)


def _write_subjects(path: Path) -> None:
    fieldnames = [
        "assertion_id",
        "source_namespace",
        "source_identifier",
        "gene_symbol",
        "internal_gene_id",
        "mapping_state",
    ]
    rows = [
        {
            "assertion_id": "a1",
            "source_namespace": "ncbigene",
            "source_identifier": "415944",
            "gene_symbol": "BAP1",
            "internal_gene_id": "gene-BAP1",
            "mapping_state": "ambiguous",
        },
        {
            "assertion_id": "a2",
            "source_namespace": "ncbigene",
            "source_identifier": "100859273",
            "gene_symbol": "LOC100859273",
            "internal_gene_id": "",
            "mapping_state": "unmapped",
        },
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=fieldnames, delimiter="\t", lineterminator="\n"
        )
        writer.writeheader()
        writer.writerows(rows)


def _synthetic_inputs(tmp_path: Path):
    parent = tmp_path / "batch-002"
    (parent / "inputs").mkdir(parents=True)
    subjects = parent / "inputs" / "subject-universe.tsv"
    _write_subjects(subjects)
    parent_manifest = parent / "curation-batch-manifest.json"
    parent_manifest.write_text(
        json.dumps(
            {
                "batch_id": "gg-gf-ubiquitin-curation-rc2-batch-002",
                "status": "draft",
                "evaluator_tag": "gene-family-rc2b-evaluator-core-v1.0",
                "scientific_shadow_authorized": False,
                "rc2c_build_authorized": False,
            }
        ),
        encoding="utf-8",
    )
    parent_checksums = parent / "checksums.sha256"
    parent_checksums.write_text(
        f"{sha256_file(parent_manifest)}  curation-batch-manifest.json\n"
        f"{sha256_file(subjects)}  inputs/subject-universe.tsv\n",
        encoding="utf-8",
    )

    assembly_report = tmp_path / "assembly_report.txt"
    assembly_report.write_text(
        "12\tassembled-molecule\t12\tChromosome\tCM12\t=\tNC_006099.5\tPrimary Assembly\t1000\tchr12\n"
        "26\tassembled-molecule\t26\tChromosome\tCM26\t=\tNC_006113.5\tPrimary Assembly\t1000\tchr26\n"
        "CHRUN_59\tunplaced-scaffold\tna\tna\tKZ1\t=\tNW_020110163.1\tPrimary Assembly\t1000\tchrUn\n"
        "\n解释\n",
        encoding="utf-8",
    )
    gff = tmp_path / "annotation.gff.gz"
    gff_rows = [
        "##gff-version 3",
        "#!genome-build GRCg6a",
        "#!genome-build-accession NCBI_Assembly:GCF_000002315.6",
        "#!annotation-source NCBI Gallus gallus Annotation Release 104",
        "NC_006099.5\tRefSeq\tgene\t1\t100\t.\t+\t.\tID=gene-BAP1;Dbxref=GeneID:415944;gene=BAP1;gene_biotype=protein_coding",
        "NC_006099.5\tRefSeq\tmRNA\t1\t100\t.\t+\t.\tID=rna-NM_BAP1;Parent=gene-BAP1;Dbxref=GeneID:415944;gene=BAP1;transcript_id=NM_BAP1.1",
        "NC_006099.5\tRefSeq\tCDS\t1\t90\t.\t+\t0\tID=cds-NP_BAP1;Parent=rna-NM_BAP1;Dbxref=GeneID:415944;gene=BAP1;protein_id=NP_BAP1.1;exception=annotated by transcript or proteomic data",
        "NC_006113.5\tRefSeq\tgene\t10\t30\t.\t+\t.\tID=gene-BAP1-2;Dbxref=GeneID:415944;gene=BAP1;gene_biotype=protein_coding",
        "NC_006113.5\tRefSeq\tmRNA\t10\t30\t.\t+\t.\tID=rna-NM_BAP1-2;Parent=gene-BAP1-2;Dbxref=GeneID:415944;gene=BAP1;transcript_id=NM_BAP1.1",
        "NC_006113.5\tRefSeq\tCDS\t10\t30\t.\t+\t0\tID=cds-NP_BAP1-2;Parent=rna-NM_BAP1-2;Dbxref=GeneID:415944;gene=BAP1;protein_id=NP_BAP1.1;exception=annotated by transcript or proteomic data",
        "NW_020110163.1\tRefSeq\tgene\t1\t500\t.\t+\t.\tID=gene-LOC100859273;Dbxref=GeneID:100859273;gene=LOC100859273;gene_biotype=protein_coding",
        "NW_020110163.1\tRefSeq\tmRNA\t1\t400\t.\t+\t.\tID=rna-XM_025146279.1;Parent=gene-LOC100859273;Dbxref=GeneID:100859273;gene=LOC100859273;transcript_id=XM_025146279.1",
        "NW_020110163.1\tRefSeq\tCDS\t1\t300\t.\t+\t0\tID=cds-XP_025002047.1;Parent=rna-XM_025146279.1;Dbxref=GeneID:100859273;gene=LOC100859273;protein_id=XP_025002047.1",
        "NW_020110163.1\tRefSeq\ttranscript\t450\t500\t.\t+\t.\tID=rna-XR_1;Parent=gene-LOC100859273;Dbxref=GeneID:100859273;gene=LOC100859273;transcript_id=XR_1.1",
    ]
    with gzip.open(gff, "wt", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(gff_rows) + "\n")
    protein = tmp_path / "protein.faa.gz"
    with gzip.open(protein, "wt", encoding="ascii", newline="\n") as handle:
        handle.write(">NP_BAP1.1 test\nMAAA\n>XP_025002047.1 test\nMAAA\n")
    return parent, gff, protein, assembly_report


def _build(tmp_path: Path):
    parent, gff, protein, assembly_report = _synthetic_inputs(tmp_path)
    output = tmp_path / "rc2b2-curation-submission-v001"
    source_hashes = {
        path: sha256_file(path)
        for path in (
            parent / "curation-batch-manifest.json",
            parent / "checksums.sha256",
            parent / "inputs/subject-universe.tsv",
            gff,
            protein,
            assembly_report,
        )
    }
    build_target_universe_submission(
        output=output,
        parent_batch_root=parent,
        gff=gff,
        protein_fasta=protein,
        assembly_report=assembly_report,
        contracts_root=CONTRACTS,
        parent_handoff_manifest=PARENT_HANDOFF,
        evaluator_commit="1" * 40,
        generator_commit="2" * 40,
        created_by="test-engineer",
        created_at="2026-07-22T12:00:00Z",
        runtime_name="docker",
        runtime_version="28.4.0",
        expectations=SYNTHETIC_EXPECTATIONS,
    )
    assert all(sha256_file(path) == digest for path, digest in source_hashes.items())
    return output, parent


def test_repository_rc2b2_contracts_validate_and_schemas_are_draft_2020_12():
    report = validate_rc2b2_contracts(CONTRACTS, PARENT_HANDOFF)
    assert report.ok, report.errors
    assert "target_denominators_and_identity_verified" in report.checks
    assert "dual_scan_evidence_separation_verified" in report.checks
    for path in sorted(CONTRACTS.glob("*.schema.json")):
        Draft202012Validator.check_schema(json.loads(path.read_text(encoding="utf-8")))


def test_builder_is_read_only_create_only_and_keeps_every_authorization_false(
    tmp_path: Path,
):
    output, parent = _build(tmp_path)
    report = validate_target_universe_submission(
        output, parent, SYNTHETIC_EXPECTATIONS
    )
    assert report.ok, report.errors
    manifest = json.loads(
        (output / "decision-submission-manifest.json").read_text(encoding="utf-8")
    )
    Draft202012Validator(
        json.loads(
            (CONTRACTS / "decision-submission-manifest.schema.json").read_text(
                encoding="utf-8"
            )
        )
    ).validate(manifest)
    environment = json.loads(
        (output / "scan-environment-manifest.json").read_text(encoding="utf-8")
    )
    Draft202012Validator(
        json.loads(
            (CONTRACTS / "scan-environment-manifest.schema.json").read_text(
                encoding="utf-8"
            )
        )
    ).validate(environment)
    assert manifest["scientific_decision_count"] == 0
    assert manifest["pilot_scan_authorized"] is False
    assert manifest["full_targeted_scan_authorized"] is False
    assert manifest["formal_shadow_authorized"] is False
    assert environment["status"] == "draft_missing_inputs"
    assert (
        sum(
            1
            for _ in (
                output / "mapping-evidence/source-format-anomalies.tsv"
            ).read_text(encoding="utf-8").splitlines()[1:]
        )
        == 1
    )
    assert all(
        item["status"] == "expected_curator_artifact"
        and item["sha256"] is None
        for item in manifest["artifacts"]
        if item["artifact_type"]
        in {
            "evidence_admissibility",
            "domain_vocabulary",
            "mapping_decisions",
            "rollup_policy",
            "publication_policy",
            "rule_bundle",
            "regression_fixture_bundle",
            "approval_attestation_bundle",
        }
    )
    with pytest.raises(FileExistsError):
        build_target_universe_submission(
            output=output,
            parent_batch_root=parent,
            gff=tmp_path / "annotation.gff.gz",
            protein_fasta=tmp_path / "protein.faa.gz",
            assembly_report=tmp_path / "assembly_report.txt",
            contracts_root=CONTRACTS,
            parent_handoff_manifest=PARENT_HANDOFF,
            evaluator_commit="1" * 40,
            generator_commit="2" * 40,
            created_by="test-engineer",
            created_at="2026-07-22T12:00:00Z",
            expectations=SYNTHETIC_EXPECTATIONS,
        )


def test_validator_rejects_checksum_drift(tmp_path: Path):
    output, parent = _build(tmp_path)
    path = output / "mapping-evidence/loc100859273-source-disposition.json"
    path.write_text(path.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    report = validate_target_universe_submission(
        output, parent, SYNTHETIC_EXPECTATIONS
    )
    assert not report.ok
    assert any("checksum mismatch" in error for error in report.errors)
