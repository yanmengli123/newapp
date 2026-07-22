"""Build the read-only RC2-B.2 targeted protein universe.

The output is an append-only engineering submission. Source files, the frozen
RC2-B.1 contracts and the parent curation batch are only read and are rehashed
before the atomic output commit. The builder does not run HMMER, emit a
scientific assertion, open a release database, or authorize a scan.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import locale
import os
import platform
import re
import shutil
import tempfile
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, TextIO
from urllib.parse import unquote

from backend.gene_family_handoff_contracts import sha256_file
from backend.gene_family_rc2b2_contracts import validate_rc2b2_contracts


ASSEMBLY_NAME = "GRCg6a"
ASSEMBLY_ACCESSION = "GCF_000002315.6"
ANNOTATION_RELEASE = "NCBI Gallus gallus Annotation Release 104"
SUBMISSION_ID_PATTERN = re.compile(
    r"^gg-gf-[a-z0-9-]+-curation-rc2b2-submission-v(?P<version>[0-9]{3})$"
)
PARENT_BATCH_ID_PATTERN = re.compile(
    r"^gg-gf-[a-z0-9-]+-curation-rc2-batch-[0-9]{3}$"
)
GENE_ID_PATTERN = re.compile(r"(?:^|,)GeneID:(\d+)(?:,|$)")
TRANSCRIPT_FEATURE_TYPES = {"mRNA", "transcript"}
PFAM_ARTIFACT_ROLES = (
    "pfam_hmm_compressed",
    "pfam_hmm_uncompressed",
    "pfam_hmm_dat",
    "pfam_hmm_h3f",
    "pfam_hmm_h3i",
    "pfam_hmm_h3m",
    "pfam_hmm_h3p",
    "pfam_clans",
    "pfam_dead_families",
    "pfam_version_record",
)
CURATOR_ARTIFACTS = (
    ("evidence_admissibility", "evidence-admissibility.canonical.json"),
    ("domain_vocabulary", "domain-vocabulary.canonical.json"),
    ("mapping_decisions", "mapping-decisions.tsv"),
    ("rollup_policy", "rollup-policy.canonical.json"),
    ("publication_policy", "publication-policy.canonical.json"),
    ("rule_bundle", "rule-bundle.canonical.json"),
    ("regression_fixture_bundle", "fixtures/fixture-bundle.json"),
    ("approval_attestation_bundle", "attestations/attestation-bundle.json"),
)


@dataclass(frozen=True)
class UniverseExpectations:
    target_genes: int = 1294
    target_transcripts: int = 4777
    target_protein_subjects: int = 4571
    noncoding_transcript_exclusions: int = 206
    scan_execution_sequences: int = 3525
    shared_sequence_groups: int = 460
    subjects_in_shared_sequence_groups: int = 1506
    scan_execution_reuse_savings: int = 1046
    multi_placement_genes: int = 4
    annotation_exception_proteins: int = 209


class TargetUniverseError(ValueError):
    pass


@dataclass
class TargetUniverseValidationReport:
    checks: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def check(self, name: str) -> None:
        self.checks.append(name)

    def error(self, message: str) -> None:
        self.errors.append(message)

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "check_count": len(self.checks),
            "error_count": len(self.errors),
            "checks": self.checks,
            "errors": self.errors,
        }


def _write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
            allow_nan=False,
        )
        + "\n",
        encoding="utf-8",
    )


def _write_tsv(
    path: Path, fieldnames: list[str], rows: Iterable[dict[str, Any]]
) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=fieldnames,
            delimiter="\t",
            lineterminator="\n",
            extrasaction="raise",
        )
        writer.writeheader()
        writer.writerows(rows)


def _open_text(path: Path) -> TextIO:
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8")
    return path.open("r", encoding="utf-8")


def _parse_attributes(raw: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for field in raw.split(";"):
        if "=" not in field:
            continue
        key, value = field.split("=", 1)
        result[key] = unquote(value)
    return result


def _gene_id(attributes: dict[str, str]) -> str | None:
    match = GENE_ID_PATTERN.search(attributes.get("Dbxref", ""))
    return match.group(1) if match else None


def _placement_id(
    gene_id: str, sequence_accession: str, start: int, end: int, strand: str
) -> str:
    raw = (
        f"{ASSEMBLY_ACCESSION}|{gene_id}|{sequence_accession}|"
        f"{start}|{end}|{strand}"
    )
    return "GFP_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def _sha256_json(value: Any) -> str:
    payload = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _artifact(path: Path, root: Path, artifact_type: str) -> dict[str, Any]:
    return {
        "artifact_type": artifact_type,
        "logical_locator": f"submission:{path.relative_to(root).as_posix()}",
        "sha256": sha256_file(path),
        "byte_size": path.stat().st_size,
    }


def _submission_artifact(
    path: Path, root: Path, artifact_type: str
) -> dict[str, Any]:
    return {
        "artifact_type": artifact_type,
        "relative_path": path.relative_to(root).as_posix(),
        "status": "observed_engineering_evidence",
        "sha256": sha256_file(path),
    }


def _read_checksum_manifest(root: Path, path: Path) -> int:
    count = 0
    for line_number, raw in enumerate(
        path.read_text(encoding="utf-8").splitlines(), 1
    ):
        if not raw.strip():
            continue
        try:
            expected, relative = raw.split("  ", 1)
        except ValueError as exc:
            raise TargetUniverseError(
                f"invalid parent checksum line {line_number}"
            ) from exc
        relative_path = Path(relative)
        if (
            relative_path.is_absolute()
            or ".." in relative_path.parts
            or re.match(r"^[A-Za-z]:", relative)
        ):
            raise TargetUniverseError(f"unsafe parent checksum path: {relative}")
        target = root / relative_path
        if not target.is_file() or sha256_file(target) != expected:
            raise TargetUniverseError(f"parent checksum mismatch: {relative}")
        count += 1
    if count == 0:
        raise TargetUniverseError("parent checksum manifest is empty")
    return count


def _checksum_records(path: Path) -> dict[str, str]:
    records: dict[str, str] = {}
    for line_number, raw in enumerate(
        path.read_text(encoding="utf-8").splitlines(), 1
    ):
        if not raw.strip():
            continue
        try:
            digest, relative = raw.split("  ", 1)
        except ValueError as exc:
            raise TargetUniverseError(
                f"invalid checksum line {line_number}"
            ) from exc
        relative_path = Path(relative)
        if (
            not re.fullmatch(r"[0-9a-f]{64}", digest)
            or relative_path.is_absolute()
            or ".." in relative_path.parts
            or re.match(r"^[A-Za-z]:", relative)
            or relative in records
        ):
            raise TargetUniverseError(f"invalid checksum record: {relative}")
        records[relative] = digest
    return records


def _read_targets(path: Path) -> dict[str, dict[str, str]]:
    targets: dict[str, dict[str, str]] = {}
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        required = {
            "source_namespace",
            "source_identifier",
            "gene_symbol",
            "internal_gene_id",
            "mapping_state",
        }
        if not reader.fieldnames or not required <= set(reader.fieldnames):
            raise TargetUniverseError("parent subject universe columns are incomplete")
        for row in reader:
            if row["source_namespace"] != "ncbigene":
                raise TargetUniverseError("target universe contains a non-NCBI Gene subject")
            gene_id = row["source_identifier"]
            if not gene_id.isdigit() or gene_id in targets:
                raise TargetUniverseError(f"invalid or duplicate target GeneID: {gene_id}")
            targets[gene_id] = dict(row)
    return targets


def _read_assembly_report(path: Path) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    with path.open("r", encoding="utf-8") as handle:
        for raw in handle:
            if raw.startswith("#") or not raw.strip():
                continue
            parts = raw.rstrip("\r\n").split("\t")
            if len(parts) != 10:
                raise TargetUniverseError("assembly report row does not have 10 columns")
            result[parts[6]] = {
                "sequence_name": parts[0],
                "sequence_role": parts[1],
                "assigned_molecule": parts[2],
                "assigned_molecule_type": parts[3],
                "genbank_accession": parts[4],
                "refseq_accession": parts[6],
                "assembly_unit": parts[7],
                "sequence_length": parts[8],
                "ucsc_style_name": parts[9],
            }
    return result


def _read_gff(
    path: Path, targets: dict[str, dict[str, str]]
) -> tuple[
    dict[str, list[dict[str, Any]]],
    dict[tuple[str, str], dict[str, Any]],
    dict[tuple[str, str], set[str]],
    dict[str, set[str]],
]:
    target_ids = set(targets)
    placements: dict[str, list[dict[str, Any]]] = defaultdict(list)
    transcripts: dict[tuple[str, str], dict[str, Any]] = {}
    parent_to_transcript: dict[str, tuple[str, str]] = {}
    cds_records: list[tuple[str, str, str, str]] = []
    protein_exception_reasons: dict[str, set[str]] = defaultdict(set)
    gff_metadata: dict[str, str] = {}

    with _open_text(path) as handle:
        for line_number, raw in enumerate(handle, 1):
            if raw.startswith("#"):
                for marker, name in (
                    ("#!genome-build ", "genome_build"),
                    (
                        "#!genome-build-accession NCBI_Assembly:",
                        "assembly_accession",
                    ),
                    ("#!annotation-source ", "annotation_release"),
                ):
                    if raw.startswith(marker):
                        gff_metadata[name] = raw[len(marker) :].strip()
                continue
            parts = raw.rstrip("\r\n").split("\t")
            if len(parts) != 9:
                raise TargetUniverseError(f"invalid GFF row at line {line_number}")
            sequence_accession, _, feature_type, start_raw, end_raw, _, strand, _, raw_attrs = parts
            attributes = _parse_attributes(raw_attrs)
            gene_id = _gene_id(attributes)
            if gene_id not in target_ids:
                continue
            start = int(start_raw)
            end = int(end_raw)
            if feature_type == "gene":
                placement = {
                    "placement_id": _placement_id(
                        gene_id, sequence_accession, start, end, strand
                    ),
                    "stable_gene_id": f"NCBIGene:{gene_id}",
                    "source_gene_id": gene_id,
                    "gene_symbol": attributes.get(
                        "gene", targets[gene_id].get("gene_symbol", "")
                    ),
                    "gff_feature_id": attributes.get("ID", ""),
                    "sequence_accession": sequence_accession,
                    "start": start,
                    "end": end,
                    "strand": strand,
                    "gene_biotype": attributes.get("gene_biotype", "not_reported"),
                }
                if placement not in placements[gene_id]:
                    placements[gene_id].append(placement)
                continue
            if feature_type in TRANSCRIPT_FEATURE_TYPES:
                transcript_id = attributes.get("transcript_id")
                feature_id = attributes.get("ID")
                if not transcript_id or not feature_id:
                    raise TargetUniverseError(
                        f"target transcript lacks ID/accession at GFF line {line_number}"
                    )
                key = (gene_id, transcript_id)
                record = transcripts.setdefault(
                    key,
                    {
                        "stable_gene_id": f"NCBIGene:{gene_id}",
                        "source_gene_id": gene_id,
                        "gene_symbol": attributes.get(
                            "gene", targets[gene_id].get("gene_symbol", "")
                        ),
                        "transcript_accession_version": transcript_id,
                        "transcript_type": feature_type,
                        "gene_biotype": attributes.get("gene_biotype", "not_reported"),
                        "placement_sequence_accessions": set(),
                        "placement_ids": set(),
                        "annotation_exception_reasons": set(),
                    },
                )
                record["placement_sequence_accessions"].add(sequence_accession)
                if attributes.get("exception"):
                    record["annotation_exception_reasons"].add(attributes["exception"])
                if feature_id in parent_to_transcript and parent_to_transcript[feature_id] != key:
                    raise TargetUniverseError(
                        f"GFF transcript feature ID maps to multiple subjects: {feature_id}"
                    )
                parent_to_transcript[feature_id] = key
                continue
            if feature_type == "CDS":
                protein_id = attributes.get("protein_id")
                parent = attributes.get("Parent")
                if not protein_id or not parent:
                    raise TargetUniverseError(
                        f"target CDS lacks protein_id/Parent at GFF line {line_number}"
                    )
                cds_records.append(
                    (gene_id, protein_id, parent, attributes.get("exception", ""))
                )
                if attributes.get("exception"):
                    protein_exception_reasons[protein_id].add(attributes["exception"])

    expected_metadata = {
        "genome_build": ASSEMBLY_NAME,
        "assembly_accession": ASSEMBLY_ACCESSION,
        "annotation_release": ANNOTATION_RELEASE,
    }
    if gff_metadata != expected_metadata:
        raise TargetUniverseError(f"GFF metadata drift: {gff_metadata}")

    for (gene_id, transcript_id), record in transcripts.items():
        sequence_accessions = record.pop("placement_sequence_accessions")
        record["placement_ids"] = {
            placement["placement_id"]
            for placement in placements.get(gene_id, [])
            if placement["sequence_accession"] in sequence_accessions
        }
        if not record["placement_ids"]:
            raise TargetUniverseError(
                f"transcript has no resolved gene placement: {gene_id}/{transcript_id}"
            )

    protein_by_transcript: dict[tuple[str, str], set[str]] = defaultdict(set)
    protein_genes: dict[str, set[str]] = defaultdict(set)
    unresolved_parents: set[str] = set()
    for gene_id, protein_id, parents_raw, _ in cds_records:
        for parent in parents_raw.split(","):
            key = parent_to_transcript.get(parent)
            if key is None:
                unresolved_parents.add(parent)
                continue
            if key[0] != gene_id:
                raise TargetUniverseError(
                    f"CDS/transcript GeneID mismatch for protein {protein_id}"
                )
            protein_by_transcript[key].add(protein_id)
            protein_genes[protein_id].add(gene_id)
    if unresolved_parents:
        sample = sorted(unresolved_parents)[:5]
        raise TargetUniverseError(f"unresolved target CDS parents: {sample}")
    multi_gene_proteins = {
        protein_id: genes for protein_id, genes in protein_genes.items() if len(genes) > 1
    }
    return placements, transcripts, protein_by_transcript, {
        **protein_exception_reasons,
        "__multi_gene_proteins__": set(multi_gene_proteins),
    }


def _read_target_sequences(
    path: Path, target_proteins: set[str]
) -> tuple[dict[str, str], int]:
    sequences: dict[str, str] = {}
    seen_headers: set[str] = set()
    record_count = 0
    current_id: str | None = None
    chunks: list[str] = []

    def finish() -> None:
        nonlocal record_count
        if current_id is None:
            return
        record_count += 1
        if current_id in seen_headers:
            raise TargetUniverseError(f"duplicate FASTA accession: {current_id}")
        seen_headers.add(current_id)
        if current_id in target_proteins:
            sequence = "".join(chunks).upper()
            if not sequence or re.search(r"[^A-Z*.-]", sequence):
                raise TargetUniverseError(f"invalid protein sequence: {current_id}")
            sequences[current_id] = sequence

    with _open_text(path) as handle:
        for raw in handle:
            if raw.startswith(">"):
                finish()
                current_id = raw[1:].split(None, 1)[0]
                chunks = []
            else:
                chunks.append("".join(raw.split()))
        finish()
    return sequences, record_count


def _write_scan_fasta(
    path: Path, sequence_groups: dict[str, list[str]], sequences: dict[str, str]
) -> None:
    with path.open("w", encoding="ascii", newline="\n") as handle:
        for sequence_hash in sorted(sequence_groups):
            accessions = sorted(sequence_groups[sequence_hash])
            sequence = sequences[accessions[0]]
            handle.write(
                f">sha256_{sequence_hash} representative_accession={accessions[0]} "
                f"subject_count={len(accessions)}\n"
            )
            for offset in range(0, len(sequence), 60):
                handle.write(sequence[offset : offset + 60] + "\n")


def _validate_expected_counts(
    observed: dict[str, int], expectations: UniverseExpectations
) -> None:
    expected = {
        field: getattr(expectations, field)
        for field in expectations.__dataclass_fields__
    }
    drift = {
        field: {"expected": expected[field], "observed": observed.get(field)}
        for field in expected
        if observed.get(field) != expected[field]
    }
    if drift:
        raise TargetUniverseError(f"target-universe count drift: {drift}")


def _environment_manifest(
    *,
    command_policy: dict[str, Any],
    target_fasta_sha256: str,
    subject_universe_sha256: str,
    runtime_name: str | None,
    runtime_version: str | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    authoritative = command_policy["authoritative"]
    diagnostic = command_policy["diagnostic"]
    command_manifest = {
        "manifest_id": "gg-gf-pfam-dual-scan-commands-v1",
        "cpu_parameter": "${CPU}",
        "authoritative_argv": authoritative["command_argv"],
        "diagnostic_argv": diagnostic["command_argv"],
        "commands_executed": False,
    }
    authoritative_command_hash = _sha256_json(authoritative["command_argv"])
    diagnostic_command_hash = _sha256_json(diagnostic["command_argv"])
    blockers = [
        "Pfam 35.0 library, metadata, clan/dead-family sidecars and pressed indexes are not present in the declared input set.",
        "HMMER 3.4 executable or immutable container image digest is not frozen.",
        "A separate Pilot authorization has not been issued.",
    ]
    environment = {
        "schema_version": "1.0",
        "environment_id": "gg-gf-pfam35-hmmer34-environment-v1",
        "status": "draft_missing_inputs",
        "pfam_release_target": "35.0",
        "pfam_artifacts": [
            {
                "artifact_role": role,
                "logical_locator": None,
                "sha256": None,
                "byte_size": None,
                "value_status": "not_reported",
            }
            for role in PFAM_ARTIFACT_ROLES
        ],
        "pfam_model_count_with_ga": None,
        "pfam_model_count_total": None,
        "hmmer_target_version": "3.4",
        "hmmer_observed_version": None,
        "container": {
            "image_reference": None,
            "image_digest": None,
            "value_status": "not_reported",
        },
        "runtime": {
            "name": runtime_name,
            "version": runtime_version,
            "value_status": "observed" if runtime_name and runtime_version else "not_reported",
        },
        "host_architecture": platform.machine() or None,
        "locale": locale.setlocale(locale.LC_ALL, None) or None,
        "authoritative_scan": {
            "evidence_role": "authoritative",
            "command_argv": authoritative["command_argv"],
            "command_sha256": authoritative_command_hash,
            "can_support_accepted": True,
            "can_support_candidate": True,
        },
        "diagnostic_scan": {
            "evidence_role": "diagnostic_only",
            "command_argv": diagnostic["command_argv"],
            "command_sha256": diagnostic_command_hash,
            "can_support_accepted": False,
            "can_support_candidate": "policy_dependent",
        },
        "protein_fasta_sha256": target_fasta_sha256,
        "subject_universe_sha256": subject_universe_sha256,
        "command_manifest_sha256": _sha256_json(command_manifest),
        "environment_manifest_sha256": None,
        "pilot_scan_authorized": False,
        "full_targeted_scan_authorized": False,
        "formal_shadow_authorized": False,
        "blocking_reasons": blockers,
    }
    return command_manifest, environment


def build_target_universe_submission(
    *,
    output: Path,
    parent_batch_root: Path,
    gff: Path,
    protein_fasta: Path,
    assembly_report: Path,
    contracts_root: Path,
    parent_handoff_manifest: Path,
    evaluator_commit: str,
    generator_commit: str,
    created_by: str,
    created_at: str,
    submission_id: str = "gg-gf-ubiquitin-curation-rc2b2-submission-v001",
    supersedes_submission_id: str | None = None,
    runtime_name: str | None = None,
    runtime_version: str | None = None,
    expectations: UniverseExpectations = UniverseExpectations(),
) -> Path:
    """Atomically create an unapproved, append-only RC2-B.2 P0 submission."""
    output = output.resolve()
    match = SUBMISSION_ID_PATTERN.fullmatch(submission_id)
    if not match:
        raise TargetUniverseError(f"invalid submission ID: {submission_id}")
    if supersedes_submission_id is not None:
        supersedes_match = SUBMISSION_ID_PATTERN.fullmatch(supersedes_submission_id)
        if not supersedes_match or supersedes_submission_id == submission_id:
            raise TargetUniverseError("invalid superseded submission ID")
        if int(supersedes_match.group("version")) >= int(match.group("version")):
            raise TargetUniverseError("a submission must supersede an earlier version")
    if output.exists():
        raise FileExistsError(f"append-only submission already exists: {output}")
    if not output.parent.is_dir():
        raise TargetUniverseError(f"output parent does not exist: {output.parent}")
    for name, commit in (
        ("evaluator_commit", evaluator_commit),
        ("generator_commit", generator_commit),
    ):
        if not re.fullmatch(r"[0-9a-f]{40}", commit):
            raise TargetUniverseError(f"{name} must be a full lowercase Git commit")

    contract_report = validate_rc2b2_contracts(
        contracts_root, parent_handoff_manifest
    )
    if not contract_report.ok:
        raise TargetUniverseError(
            f"RC2-B.2 contracts are invalid: {contract_report.errors}"
        )

    parent_manifest_path = parent_batch_root / "curation-batch-manifest.json"
    parent_checksums_path = parent_batch_root / "checksums.sha256"
    parent_subjects_path = parent_batch_root / "inputs" / "subject-universe.tsv"
    source_paths = (
        parent_manifest_path,
        parent_checksums_path,
        parent_subjects_path,
        gff,
        protein_fasta,
        assembly_report,
    )
    for path in source_paths:
        if not path.is_file():
            raise TargetUniverseError(f"required source is missing: {path}")
    source_hashes_before = {path: sha256_file(path) for path in source_paths}

    verified_parent_file_count = _read_checksum_manifest(
        parent_batch_root, parent_checksums_path
    )
    parent_manifest = json.loads(parent_manifest_path.read_text(encoding="utf-8"))
    parent_batch_id = parent_manifest.get("batch_id")
    if not isinstance(parent_batch_id, str) or not PARENT_BATCH_ID_PATTERN.fullmatch(
        parent_batch_id
    ):
        raise TargetUniverseError("parent curation batch ID is invalid")
    if (
        parent_manifest.get("status") != "draft"
        or parent_manifest.get("scientific_shadow_authorized") is not False
        or parent_manifest.get("rc2c_build_authorized") is not False
    ):
        raise TargetUniverseError("parent batch governance boundary changed")
    if parent_manifest.get("evaluator_tag") != "gene-family-rc2b-evaluator-core-v1.0":
        raise TargetUniverseError("parent evaluator tag drift")

    targets = _read_targets(parent_subjects_path)
    if len(targets) != expectations.target_genes:
        raise TargetUniverseError(
            f"target gene denominator drift: {len(targets)}"
        )
    assembly_sequences = _read_assembly_report(assembly_report)
    placements, transcripts, protein_by_transcript, exception_map = _read_gff(
        gff, targets
    )
    multi_gene_protein_ids = exception_map.pop("__multi_gene_proteins__", set())

    missing_gene_placements = sorted(set(targets) - set(placements))
    if missing_gene_placements:
        raise TargetUniverseError(
            f"target genes missing GFF placement: {missing_gene_placements[:5]}"
        )
    missing_gene_transcripts = sorted(
        set(targets) - {gene_id for gene_id, _ in transcripts}
    )
    if missing_gene_transcripts:
        raise TargetUniverseError(
            f"target genes missing transcript records: {missing_gene_transcripts[:5]}"
        )

    protein_to_transcript: dict[str, tuple[str, str]] = {}
    transcript_to_protein: dict[tuple[str, str], str] = {}
    for key, protein_ids in protein_by_transcript.items():
        if len(protein_ids) != 1:
            raise TargetUniverseError(
                f"transcript has multiple protein subjects: {key} -> {sorted(protein_ids)}"
            )
        protein_id = next(iter(protein_ids))
        previous = protein_to_transcript.get(protein_id)
        if previous is not None and previous != key:
            raise TargetUniverseError(
                f"protein maps to multiple transcripts: {protein_id}"
            )
        protein_to_transcript[protein_id] = key
        transcript_to_protein[key] = protein_id
    target_proteins = set(protein_to_transcript)
    sequences, source_fasta_record_count = _read_target_sequences(
        protein_fasta, target_proteins
    )
    missing_target_sequences = sorted(target_proteins - set(sequences))
    if missing_target_sequences:
        raise TargetUniverseError(
            f"target proteins missing FASTA records: {missing_target_sequences[:5]}"
        )

    sequence_hash_by_protein = {
        protein_id: hashlib.sha256(sequence.encode("ascii")).hexdigest()
        for protein_id, sequence in sequences.items()
    }
    sequence_groups: dict[str, list[str]] = defaultdict(list)
    for protein_id, sequence_hash in sequence_hash_by_protein.items():
        sequence_groups[sequence_hash].append(protein_id)
    shared_groups = {
        sequence_hash: sorted(protein_ids)
        for sequence_hash, protein_ids in sequence_groups.items()
        if len(protein_ids) > 1
    }
    multi_placement_gene_ids = {
        gene_id for gene_id, rows in placements.items() if len(rows) > 1
    }
    annotation_exception_proteins = set(exception_map) & target_proteins

    observed_counts = {
        "target_genes": len(targets),
        "target_transcripts": len(transcripts),
        "target_protein_subjects": len(target_proteins),
        "noncoding_transcript_exclusions": len(transcripts)
        - len(transcript_to_protein),
        "scan_execution_sequences": len(sequence_groups),
        "shared_sequence_groups": len(shared_groups),
        "subjects_in_shared_sequence_groups": sum(
            len(protein_ids) for protein_ids in shared_groups.values()
        ),
        "scan_execution_reuse_savings": sum(
            len(protein_ids) - 1 for protein_ids in shared_groups.values()
        ),
        "multi_placement_genes": len(multi_placement_gene_ids),
        "annotation_exception_proteins": len(annotation_exception_proteins),
    }
    _validate_expected_counts(observed_counts, expectations)
    if multi_gene_protein_ids:
        raise TargetUniverseError(
            f"proteins map to multiple genes: {sorted(multi_gene_protein_ids)[:5]}"
        )

    transcript_keys_by_gene: dict[str, list[tuple[str, str]]] = defaultdict(list)
    protein_ids_by_gene: dict[str, list[str]] = defaultdict(list)
    for key in transcripts:
        transcript_keys_by_gene[key[0]].append(key)
    for protein_id, key in protein_to_transcript.items():
        protein_ids_by_gene[key[0]].append(protein_id)

    gene_rows: list[dict[str, Any]] = []
    for gene_id in sorted(targets, key=int):
        target = targets[gene_id]
        gene_rows.append(
            {
                "stable_gene_id": f"NCBIGene:{gene_id}",
                "source_namespace": "ncbigene",
                "source_identifier": gene_id,
                "gene_symbol": target.get("gene_symbol", ""),
                "internal_gene_id": target.get("internal_gene_id", ""),
                "source_mapping_state": target.get("mapping_state", ""),
                "transcript_count": len(transcript_keys_by_gene[gene_id]),
                "protein_subject_count": len(protein_ids_by_gene[gene_id]),
                "placement_count": len(placements[gene_id]),
                "annotation_exception_protein_count": len(
                    set(protein_ids_by_gene[gene_id])
                    & annotation_exception_proteins
                ),
            }
        )

    transcript_rows: list[dict[str, Any]] = []
    noncoding_rows: list[dict[str, Any]] = []
    for key in sorted(transcripts, key=lambda item: (int(item[0]), item[1])):
        record = transcripts[key]
        protein_id = transcript_to_protein.get(key, "")
        included = bool(protein_id)
        row = {
            "stable_gene_id": record["stable_gene_id"],
            "source_gene_id": record["source_gene_id"],
            "gene_symbol": record["gene_symbol"],
            "transcript_accession_version": record["transcript_accession_version"],
            "transcript_type": record["transcript_type"],
            "included_in_protein_scan": str(included).lower(),
            "protein_accession_version": protein_id,
            "exclusion_reason": "" if included else "no_protein_product",
            "annotation_exception": str(
                bool(record["annotation_exception_reasons"])
            ).lower(),
            "annotation_exception_reasons": ";".join(
                sorted(record["annotation_exception_reasons"])
            ),
            "placement_ids": ";".join(sorted(record["placement_ids"])),
        }
        transcript_rows.append(row)
        if not included:
            noncoding_rows.append(
                {
                    **row,
                    "scan_status": "not_applicable",
                    "counts_as_missing_protein": "false",
                    "counts_as_scan_failed": "false",
                    "counts_as_not_attempted": "false",
                    "counts_as_gene_scan_incomplete": "false",
                }
            )

    protein_rows: list[dict[str, Any]] = []
    scan_subject_rows: list[dict[str, Any]] = []
    exception_rows: list[dict[str, Any]] = []
    for protein_id in sorted(target_proteins):
        key = protein_to_transcript[protein_id]
        record = transcripts[key]
        sequence_hash = sequence_hash_by_protein[protein_id]
        exception_reasons = sorted(exception_map.get(protein_id, set()))
        row = {
            "scientific_subject_key": protein_id,
            "protein_accession_version": protein_id,
            "stable_gene_id": record["stable_gene_id"],
            "source_gene_id": record["source_gene_id"],
            "gene_symbol": record["gene_symbol"],
            "transcript_accession_version": record["transcript_accession_version"],
            "sequence_sha256": sequence_hash,
            "sequence_length": len(sequences[protein_id]),
            "shared_scan_execution_id": f"sha256:{sequence_hash}",
            "shared_sequence_subject_count": len(sequence_groups[sequence_hash]),
            "annotation_exception": str(bool(exception_reasons)).lower(),
            "annotation_exception_reasons": ";".join(exception_reasons),
            "placement_ids": ";".join(sorted(record["placement_ids"])),
        }
        protein_rows.append(row)
        scan_subject_rows.append(
            {
                **row,
                "scan_execution_reused": str(
                    len(sequence_groups[sequence_hash]) > 1
                ).lower(),
                "reexpand_before_rule_evaluation": "true",
            }
        )
        if exception_reasons:
            exception_rows.append(
                {
                    "scientific_subject_key": protein_id,
                    "stable_gene_id": record["stable_gene_id"],
                    "gene_symbol": record["gene_symbol"],
                    "transcript_accession_version": record[
                        "transcript_accession_version"
                    ],
                    "annotation_exception_reasons": ";".join(exception_reasons),
                    "evidence_role": "annotation_source_fact",
                    "scientific_decision_emitted": "false",
                }
            )

    scan_execution_rows = []
    for sequence_hash in sorted(sequence_groups):
        protein_ids = sorted(sequence_groups[sequence_hash])
        representative = protein_ids[0]
        scan_execution_rows.append(
            {
                "shared_scan_execution_id": f"sha256:{sequence_hash}",
                "scan_execution_key": sequence_hash,
                "representative_protein_accession_version": representative,
                "subject_count": len(protein_ids),
                "sequence_length": len(sequences[representative]),
                "requires_accession_reexpansion": str(len(protein_ids) > 1).lower(),
                "scan_status": "not_attempted",
            }
        )
    shared_sequence_rows = [
        {
            "shared_scan_execution_id": f"sha256:{sequence_hash}",
            "sequence_sha256": sequence_hash,
            "subject_count": len(protein_ids),
            "protein_accession_version": protein_id,
            "scientific_subject_key": protein_id,
            "stable_gene_id": transcripts[protein_to_transcript[protein_id]][
                "stable_gene_id"
            ],
            "transcript_accession_version": protein_to_transcript[protein_id][1],
            "subjects_merged_biologically": "false",
        }
        for sequence_hash, protein_ids in sorted(shared_groups.items())
        for protein_id in protein_ids
    ]

    multi_placement_rows: list[dict[str, Any]] = []
    for gene_id in sorted(multi_placement_gene_ids, key=int):
        for placement in sorted(
            placements[gene_id],
            key=lambda row: (
                row["sequence_accession"],
                row["start"],
                row["end"],
            ),
        ):
            assembly_row = assembly_sequences.get(placement["sequence_accession"])
            if assembly_row is None:
                raise TargetUniverseError(
                    f"placement sequence absent from assembly report: {placement['sequence_accession']}"
                )
            placement_transcripts = sorted(
                key[1]
                for key in transcript_keys_by_gene[gene_id]
                if placement["placement_id"] in transcripts[key]["placement_ids"]
            )
            multi_placement_rows.append(
                {
                    **placement,
                    "assembly_accession": ASSEMBLY_ACCESSION,
                    "assembly_name": ASSEMBLY_NAME,
                    "sequence_role": assembly_row["sequence_role"],
                    "assigned_molecule": assembly_row["assigned_molecule"],
                    "ucsc_style_name": assembly_row["ucsc_style_name"],
                    "annotation_release": ANNOTATION_RELEASE,
                    "transcript_coverage": len(placement_transcripts),
                    "transcript_accessions": ";".join(placement_transcripts),
                    "historical_split_placement_proposal": str(
                        gene_id == "415944"
                    ).lower(),
                    "interpretation_status": "engineering_proposal_not_curator_decision",
                }
            )
    bap1_rows = [
        row for row in multi_placement_rows if row["source_gene_id"] == "415944"
    ]
    if len(bap1_rows) != 2 or {
        row["assigned_molecule"] for row in bap1_rows
    } != {"12", "26"}:
        raise TargetUniverseError("BAP1 GRCg6a chr12/chr26 placement evidence drift")

    loc_gene_id = "100859273"
    loc_target = targets.get(loc_gene_id)
    loc_proteins = sorted(protein_ids_by_gene.get(loc_gene_id, []))
    loc_placements = placements.get(loc_gene_id, [])
    if (
        loc_target is None
        or loc_proteins != ["XP_025002047.1"]
        or len(loc_placements) != 1
        or loc_placements[0]["sequence_accession"] != "NW_020110163.1"
    ):
        raise TargetUniverseError("LOC100859273 source evidence drift")
    loc_disposition = {
        "record_id": "gg-gf-loc100859273-source-disposition-proposal-v1",
        "status": "engineering_evidence_proposal_not_curator_decision",
        "source_gene_id": "NCBIGene:100859273",
        "source_gene_symbol": loc_target.get("gene_symbol", "LOC100859273"),
        "source_protein_id": "XP_025002047.1",
        "source_transcript_id": protein_to_transcript["XP_025002047.1"][1],
        "internal_gene_id": None,
        "assembly_accession": ASSEMBLY_ACCESSION,
        "sequence_accession": "NW_020110163.1",
        "sequence_role": assembly_sequences["NW_020110163.1"]["sequence_role"],
        "mapping_status_proposal": "source_resolved_internal_unmapped",
        "mapping_reason_proposal": "internal_scaffold_coverage_gap",
        "source_assertion_retained": True,
        "curator_decision_emitted": False,
        "formal_assertion_emitted": False,
    }

    stage = Path(tempfile.mkdtemp(prefix=f".{output.name}.staging-", dir=output.parent))
    try:
        target_root = stage / "target-universe"
        evidence_root = stage / "mapping-evidence"
        target_root.mkdir()
        evidence_root.mkdir()
        (stage / "fixtures").mkdir()
        (stage / "attestations").mkdir()

        gene_path = target_root / "target-gene-universe.tsv"
        transcript_path = target_root / "target-transcript-universe.tsv"
        protein_path = target_root / "target-protein-universe.tsv"
        scan_execution_path = target_root / "scan-execution-universe.tsv"
        scan_subject_path = target_root / "scan-subject-map.tsv"
        scan_fasta_path = target_root / "target-scan-executions.fasta"
        noncoding_path = target_root / "noncoding-transcript-exclusions.tsv"
        multi_placement_path = evidence_root / "multi-placement-genes.tsv"
        exception_path = evidence_root / "annotation-exception-proteins.tsv"
        shared_sequence_path = evidence_root / "shared-sequence-groups.tsv"
        bap1_path = evidence_root / "bap1-stable-gene-placements.tsv"
        loc_path = evidence_root / "loc100859273-source-disposition.json"

        _write_tsv(gene_path, list(gene_rows[0]), gene_rows)
        _write_tsv(transcript_path, list(transcript_rows[0]), transcript_rows)
        _write_tsv(protein_path, list(protein_rows[0]), protein_rows)
        _write_tsv(
            scan_execution_path, list(scan_execution_rows[0]), scan_execution_rows
        )
        _write_tsv(scan_subject_path, list(scan_subject_rows[0]), scan_subject_rows)
        _write_scan_fasta(scan_fasta_path, sequence_groups, sequences)
        _write_tsv(noncoding_path, list(noncoding_rows[0]), noncoding_rows)
        _write_tsv(
            multi_placement_path,
            list(multi_placement_rows[0]),
            multi_placement_rows,
        )
        _write_tsv(exception_path, list(exception_rows[0]), exception_rows)
        _write_tsv(
            shared_sequence_path,
            list(shared_sequence_rows[0]),
            shared_sequence_rows,
        )
        _write_tsv(bap1_path, list(bap1_rows[0]), bap1_rows)
        _write_json(loc_path, loc_disposition)

        output_paths = (
            (gene_path, "target_gene_universe"),
            (transcript_path, "target_transcript_universe"),
            (protein_path, "target_protein_universe"),
            (scan_execution_path, "scan_execution_universe"),
            (scan_subject_path, "scan_subject_map"),
            (scan_fasta_path, "target_scan_fasta"),
            (noncoding_path, "noncoding_transcript_exclusions"),
            (multi_placement_path, "multi_placement_evidence"),
            (exception_path, "annotation_exception_evidence"),
            (shared_sequence_path, "shared_sequence_evidence"),
            (bap1_path, "bap1_placement_evidence"),
            (loc_path, "loc100859273_source_disposition"),
        )
        source_artifacts = [
            {
                "artifact_type": "rc1_target_gene_subjects",
                "logical_locator": "parent-batch:inputs/subject-universe.tsv",
                "sha256": sha256_file(parent_subjects_path),
                "byte_size": parent_subjects_path.stat().st_size,
            },
            {
                "artifact_type": "grcg6a_annotation_gff",
                "logical_locator": "projectdata:GCF_000002315.6_GRCg6a_genomic.gff.gz",
                "sha256": sha256_file(gff),
                "byte_size": gff.stat().st_size,
            },
            {
                "artifact_type": "grcg6a_protein_fasta",
                "logical_locator": "projectdata:GCF_000002315.6_GRCg6a_protein.faa.gz",
                "sha256": sha256_file(protein_fasta),
                "byte_size": protein_fasta.stat().st_size,
            },
            {
                "artifact_type": "grcg6a_assembly_report",
                "logical_locator": "projectdata:GCF_000002315.6_GRCg6a_assembly_report.txt",
                "sha256": sha256_file(assembly_report),
                "byte_size": assembly_report.stat().st_size,
            },
        ]
        target_manifest = {
            "schema_version": "1.0",
            "universe_id": "gg-gf-ubiquitin-grcg6a-target-universe-v1",
            "status": "engineering_generated_unapproved",
            "assembly": {"name": ASSEMBLY_NAME, "accession": ASSEMBLY_ACCESSION},
            "annotation_release": ANNOTATION_RELEASE,
            "source_artifacts": source_artifacts,
            "identity_policy": {
                "gene_key": "NCBIGene identifier",
                "scientific_subject_key": "versioned_protein_accession",
                "scan_execution_key": "sequence_sha256",
                "equal_sequence_accessions_merged": False,
                "scan_results_reexpanded_before_rule_evaluation": True,
                "placement_is_biological_gene": False,
            },
            "counts": observed_counts,
            "quality": {
                "target_proteins_missing_fasta": len(missing_target_sequences),
                "protein_mapped_to_multiple_genes": len(multi_gene_protein_ids),
                "unexplained_transcript_exclusions": 0,
                "transcript_status_coverage_percent": 100.0,
                "protein_sequence_hash_coverage_percent": 100.0,
            },
            "output_artifacts": [
                _artifact(path, stage, artifact_type)
                for path, artifact_type in output_paths
            ],
            "created_at": created_at,
            "generator_commit": generator_commit,
            "source_modification_count": 0,
            "scan_executed": False,
            "scientific_decisions_emitted": False,
        }
        target_manifest_path = target_root / "target-universe-manifest.json"
        _write_json(target_manifest_path, target_manifest)

        policy_path = contracts_root / "dual-scan-policy-v1.json"
        command_policy = json.loads(policy_path.read_text(encoding="utf-8"))
        command_manifest, environment_manifest = _environment_manifest(
            command_policy=command_policy,
            target_fasta_sha256=sha256_file(scan_fasta_path),
            subject_universe_sha256=sha256_file(protein_path),
            runtime_name=runtime_name,
            runtime_version=runtime_version,
        )
        command_manifest_path = stage / "scan-command-manifest.json"
        environment_manifest_path = stage / "scan-environment-manifest.json"
        _write_json(command_manifest_path, command_manifest)
        _write_json(environment_manifest_path, environment_manifest)

        parent_lock_path = stage / "parent-batch-lock.json"
        _write_json(
            parent_lock_path,
            {
                "parent_batch_id": parent_batch_id,
                "parent_batch_manifest_sha256": sha256_file(parent_manifest_path),
                "parent_batch_checksums_sha256": sha256_file(parent_checksums_path),
                "verified_parent_file_count": verified_parent_file_count,
                "parent_batch_modified": False,
                "parent_batch_status": parent_manifest["status"],
                "parent_scientific_shadow_authorized": False,
            },
        )

        observed_submission_artifacts = [
            _submission_artifact(parent_lock_path, stage, "parent_batch_lock"),
            _submission_artifact(
                target_manifest_path, stage, "target_universe_manifest"
            ),
            *[
                _submission_artifact(path, stage, artifact_type)
                for path, artifact_type in output_paths
            ],
            _submission_artifact(
                command_manifest_path, stage, "scan_command_manifest"
            ),
            _submission_artifact(
                environment_manifest_path, stage, "scan_environment_manifest"
            ),
        ]
        expected_curator_artifacts = [
            {
                "artifact_type": artifact_type,
                "relative_path": relative_path,
                "status": "expected_curator_artifact",
                "sha256": None,
            }
            for artifact_type, relative_path in CURATOR_ARTIFACTS
        ]
        contract_manifest_path = contracts_root / "rc2b2-contract-manifest-v1.json"
        submission_manifest = {
            "schema_version": "1.0",
            "submission_id": submission_id,
            "submission_version": f"v{match.group('version')}",
            "scheme_id": "ubiquitin_core",
            "parent_batch_id": parent_batch_id,
            "parent_batch_manifest_sha256": sha256_file(parent_manifest_path),
            "contract_version": "gg-gf-rc2b2-readiness-1.0",
            "contract_manifest_sha256": sha256_file(contract_manifest_path),
            "evaluator_tag": "gene-family-rc2b-evaluator-core-v1.0",
            "evaluator_commit": evaluator_commit,
            "artifacts": observed_submission_artifacts
            + expected_curator_artifacts,
            "created_by": {"name": created_by, "role": "engineering_preparer"},
            "created_at": created_at,
            "status": "engineering_prepared_unapproved",
            "supersedes_submission_id": supersedes_submission_id,
            "scientific_decision_count": 0,
            "scientific_approval_implied": False,
            "pilot_scan_authorized": False,
            "full_targeted_scan_authorized": False,
            "formal_shadow_authorized": False,
            "rc2c_build_authorized": False,
            "api_frontend_switch_authorized": False,
            "limitations": [
                "This v001 package contains engineering evidence only and must not be edited in place.",
                "Every curator decision artifact is missing; a completed revision must be emitted as a new submission version.",
                "Pfam 35.0/HMMER 3.4 inputs and immutable container digest are not frozen.",
                "No Pilot, full targeted scan, formal Shadow, RC2-C build or API/frontend switch is authorized.",
            ],
        }
        submission_manifest_path = stage / "decision-submission-manifest.json"
        _write_json(submission_manifest_path, submission_manifest)
        (stage / "README.md").write_text(
            "# RC2-B.2 engineering-prepared submission v001\n\n"
            "This directory is append-only and unapproved. It freezes the read-only "
            "target universe and mapping evidence. It contains no curator decision and "
            "does not authorize a scan or Shadow run. Corrections and curator content "
            "must be emitted in a new submission version.\n",
            encoding="utf-8",
        )
        (stage / "fixtures" / "README.md").write_text(
            "# Fixtures\n\nNo Pilot or rule fixture has been approved in v001.\n",
            encoding="utf-8",
        )
        (stage / "attestations" / "README.md").write_text(
            "# Attestations\n\nNo curator attestation is present in v001.\n",
            encoding="utf-8",
        )

        source_hashes_after = {path: sha256_file(path) for path in source_paths}
        if source_hashes_after != source_hashes_before:
            raise TargetUniverseError("a read-only source changed during the build")
        checksummed = sorted(path for path in stage.rglob("*") if path.is_file())
        (stage / "checksums.sha256").write_text(
            "".join(
                f"{sha256_file(path)}  {path.relative_to(stage).as_posix()}\n"
                for path in checksummed
            ),
            encoding="utf-8",
        )
        validation = validate_target_universe_submission(
            stage, parent_batch_root, expectations
        )
        if not validation.ok:
            raise TargetUniverseError(
                f"staged target-universe submission failed validation: {validation.errors}"
            )
        os.replace(stage, output)
    except Exception:
        if stage.exists():
            shutil.rmtree(stage)
        raise
    return output


def _tsv_row_count(path: Path) -> int:
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle, delimiter="\t")
        try:
            next(reader)
        except StopIteration:
            return -1
        return sum(1 for _ in reader)


def _fasta_record_count(path: Path) -> int:
    with _open_text(path) as handle:
        return sum(1 for raw in handle if raw.startswith(">"))


def validate_target_universe_submission(
    root: Path,
    parent_batch_root: Path,
    expectations: UniverseExpectations = UniverseExpectations(),
) -> TargetUniverseValidationReport:
    """Validate a generated submission without approving its science."""
    report = TargetUniverseValidationReport()
    required = {
        "README.md",
        "checksums.sha256",
        "decision-submission-manifest.json",
        "parent-batch-lock.json",
        "scan-command-manifest.json",
        "scan-environment-manifest.json",
        "target-universe/target-universe-manifest.json",
        "target-universe/target-gene-universe.tsv",
        "target-universe/target-transcript-universe.tsv",
        "target-universe/target-protein-universe.tsv",
        "target-universe/scan-execution-universe.tsv",
        "target-universe/scan-subject-map.tsv",
        "target-universe/target-scan-executions.fasta",
        "target-universe/noncoding-transcript-exclusions.tsv",
        "mapping-evidence/multi-placement-genes.tsv",
        "mapping-evidence/annotation-exception-proteins.tsv",
        "mapping-evidence/shared-sequence-groups.tsv",
        "mapping-evidence/bap1-stable-gene-placements.tsv",
        "mapping-evidence/loc100859273-source-disposition.json",
        "fixtures/README.md",
        "attestations/README.md",
    }
    actual = {
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file()
    }
    missing = sorted(required - actual)
    if missing:
        report.error(f"missing generated submission files: {missing}")
        return report

    try:
        checksum_records = _checksum_records(root / "checksums.sha256")
    except (OSError, UnicodeError, TargetUniverseError) as exc:
        report.error(str(exc))
        return report
    expected_checksummed = actual - {"checksums.sha256"}
    if set(checksum_records) != expected_checksummed:
        report.error("submission checksum inventory does not cover the exact file set")
    else:
        drift = [
            relative
            for relative, digest in checksum_records.items()
            if sha256_file(root / relative) != digest
        ]
        if drift:
            report.error(f"submission checksum mismatch: {sorted(drift)}")
        else:
            report.check("submission_checksums_verified")

    try:
        submission = json.loads(
            (root / "decision-submission-manifest.json").read_text(encoding="utf-8")
        )
        target_manifest = json.loads(
            (root / "target-universe/target-universe-manifest.json").read_text(
                encoding="utf-8"
            )
        )
        environment = json.loads(
            (root / "scan-environment-manifest.json").read_text(encoding="utf-8")
        )
        commands = json.loads(
            (root / "scan-command-manifest.json").read_text(encoding="utf-8")
        )
        parent_lock = json.loads(
            (root / "parent-batch-lock.json").read_text(encoding="utf-8")
        )
        loc = json.loads(
            (
                root
                / "mapping-evidence/loc100859273-source-disposition.json"
            ).read_text(encoding="utf-8")
        )
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        report.error(f"cannot load generated manifest: {exc}")
        return report

    authorization_fields = (
        "scientific_approval_implied",
        "pilot_scan_authorized",
        "full_targeted_scan_authorized",
        "formal_shadow_authorized",
        "rc2c_build_authorized",
        "api_frontend_switch_authorized",
    )
    if (
        submission.get("status") != "engineering_prepared_unapproved"
        or submission.get("scientific_decision_count") != 0
        or any(submission.get(field) is not False for field in authorization_fields)
    ):
        report.error("generated submission crosses an approval/execution boundary")
    else:
        report.check("unapproved_submission_boundary_verified")

    artifacts = submission.get("artifacts", [])
    if not isinstance(artifacts, list):
        report.error("submission artifact inventory is not an array")
    else:
        artifact_types = [
            item.get("artifact_type") for item in artifacts if isinstance(item, dict)
        ]
        if len(artifact_types) != len(artifacts) or len(artifact_types) != len(
            set(artifact_types)
        ):
            report.error("submission artifact types are missing or duplicated")
        for item in artifacts:
            if not isinstance(item, dict):
                continue
            relative = item.get("relative_path")
            if not isinstance(relative, str):
                report.error("submission artifact relative path is invalid")
                continue
            path = root / relative
            if item.get("status") == "observed_engineering_evidence":
                if not path.is_file() or item.get("sha256") != sha256_file(path):
                    report.error(f"unresolved engineering artifact: {relative}")
            elif item.get("status") == "expected_curator_artifact":
                if path.exists() or item.get("sha256") is not None:
                    report.error(f"v001 unexpectedly contains curator content: {relative}")
            else:
                report.error(f"unknown submission artifact status: {relative}")
        if not any("artifact" in error for error in report.errors):
            report.check("submission_artifact_inventory_verified")

    expected_counts = {
        field: getattr(expectations, field)
        for field in expectations.__dataclass_fields__
    }
    if target_manifest.get("counts") != expected_counts:
        report.error("generated target-universe counts drift")
    quality = target_manifest.get("quality", {})
    if (
        quality.get("target_proteins_missing_fasta") != 0
        or quality.get("protein_mapped_to_multiple_genes") != 0
        or quality.get("unexplained_transcript_exclusions") != 0
        or target_manifest.get("source_modification_count") != 0
        or target_manifest.get("scan_executed") is not False
        or target_manifest.get("scientific_decisions_emitted") is not False
    ):
        report.error("target-universe quality or read-only boundary failed")
    else:
        report.check("target_universe_quality_boundary_verified")

    row_expectations = {
        "target-universe/target-gene-universe.tsv": expectations.target_genes,
        "target-universe/target-transcript-universe.tsv": expectations.target_transcripts,
        "target-universe/target-protein-universe.tsv": expectations.target_protein_subjects,
        "target-universe/scan-execution-universe.tsv": expectations.scan_execution_sequences,
        "target-universe/scan-subject-map.tsv": expectations.target_protein_subjects,
        "target-universe/noncoding-transcript-exclusions.tsv": expectations.noncoding_transcript_exclusions,
        "mapping-evidence/multi-placement-genes.tsv": expectations.multi_placement_genes
        * 2,
        "mapping-evidence/annotation-exception-proteins.tsv": expectations.annotation_exception_proteins,
        "mapping-evidence/shared-sequence-groups.tsv": expectations.subjects_in_shared_sequence_groups,
        "mapping-evidence/bap1-stable-gene-placements.tsv": 2,
    }
    row_drift = {
        relative: {"expected": expected, "observed": _tsv_row_count(root / relative)}
        for relative, expected in row_expectations.items()
        if _tsv_row_count(root / relative) != expected
    }
    if row_drift:
        report.error(f"generated TSV row-count drift: {row_drift}")
    elif (
        _fasta_record_count(
            root / "target-universe/target-scan-executions.fasta"
        )
        != expectations.scan_execution_sequences
    ):
        report.error("target scan FASTA record-count drift")
    else:
        report.check("target_output_denominators_verified")

    if (
        environment.get("status") != "draft_missing_inputs"
        or environment.get("pilot_scan_authorized") is not False
        or environment.get("full_targeted_scan_authorized") is not False
        or environment.get("formal_shadow_authorized") is not False
        or environment.get("hmmer_observed_version") is not None
        or environment.get("container", {}).get("image_digest") is not None
        or len(environment.get("blocking_reasons", [])) < 3
    ):
        report.error("draft scan environment does not hard-block execution")
    elif (
        "--cut_ga" not in commands.get("authoritative_argv", [])
        or "--cut_ga" in commands.get("diagnostic_argv", [])
        or commands.get("commands_executed") is not False
    ):
        report.error("authoritative/diagnostic command separation failed")
    else:
        report.check("scan_environment_no_go_boundary_verified")

    parent_manifest_path = parent_batch_root / "curation-batch-manifest.json"
    parent_checksums_path = parent_batch_root / "checksums.sha256"
    if (
        parent_lock.get("parent_batch_manifest_sha256")
        != sha256_file(parent_manifest_path)
        or parent_lock.get("parent_batch_checksums_sha256")
        != sha256_file(parent_checksums_path)
        or parent_lock.get("parent_batch_modified") is not False
    ):
        report.error("parent batch lock cannot be resolved")
    else:
        report.check("parent_batch_immutability_lock_verified")

    if (
        loc.get("source_gene_id") != "NCBIGene:100859273"
        or loc.get("source_protein_id") != "XP_025002047.1"
        or loc.get("internal_gene_id") is not None
        or loc.get("mapping_status_proposal")
        != "source_resolved_internal_unmapped"
        or loc.get("mapping_reason_proposal")
        != "internal_scaffold_coverage_gap"
        or loc.get("curator_decision_emitted") is not False
    ):
        report.error("LOC100859273 source-level disposition boundary drift")
    else:
        report.check("loc_source_level_proposal_verified")

    absolute_path_pattern = re.compile(r"(?:[A-Za-z]:\\|[A-Za-z]:/)")
    leaked = []
    for path in root.rglob("*"):
        if not path.is_file() or path.name == "target-scan-executions.fasta":
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeError:
            continue
        if absolute_path_pattern.search(content):
            leaked.append(path.relative_to(root).as_posix())
    if leaked:
        report.error(f"machine-local absolute path leaked into submission: {leaked}")
    else:
        report.check("portable_logical_locators_verified")
    return report


def main(argv: list[str] | None = None) -> int:
    project_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Build the read-only RC2-B.2 targeted universe submission"
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--parent-batch-root", type=Path, required=True)
    parser.add_argument("--gff", type=Path, required=True)
    parser.add_argument("--protein-fasta", type=Path, required=True)
    parser.add_argument("--assembly-report", type=Path, required=True)
    parser.add_argument("--evaluator-commit", required=True)
    parser.add_argument("--generator-commit", required=True)
    parser.add_argument("--created-by", required=True)
    parser.add_argument("--created-at", required=True)
    parser.add_argument(
        "--submission-id",
        default="gg-gf-ubiquitin-curation-rc2b2-submission-v001",
    )
    parser.add_argument("--supersedes-submission-id")
    parser.add_argument("--runtime-name")
    parser.add_argument("--runtime-version")
    parser.add_argument(
        "--contracts",
        type=Path,
        default=project_root / "contracts" / "gene-family" / "rc2b2",
    )
    parser.add_argument(
        "--parent-handoff-manifest",
        type=Path,
        default=project_root
        / "contracts"
        / "gene-family"
        / "rc2b1"
        / "handoff-contract-manifest-v1.json",
    )
    args = parser.parse_args(argv)
    result = build_target_universe_submission(
        output=args.output,
        parent_batch_root=args.parent_batch_root,
        gff=args.gff,
        protein_fasta=args.protein_fasta,
        assembly_report=args.assembly_report,
        contracts_root=args.contracts,
        parent_handoff_manifest=args.parent_handoff_manifest,
        evaluator_commit=args.evaluator_commit,
        generator_commit=args.generator_commit,
        created_by=args.created_by,
        created_at=args.created_at,
        submission_id=args.submission_id,
        supersedes_submission_id=args.supersedes_submission_id,
        runtime_name=args.runtime_name,
        runtime_version=args.runtime_version,
    )
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
