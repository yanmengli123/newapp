"""Create an immutable RC2-B.1 curation handoff batch skeleton.

The builder copies only small governance inputs. Large GRCg6a source assets are
referenced by portable logical locator and frozen with SHA-256, size and record
facts. It never runs a scan, creates a scientific decision or opens a database.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any, Iterable

from backend.gene_family_handoff_contracts import sha256_file, validate_handoff_contracts


BATCH_FORMAT = "gf-rc2b1-curation-batch-1.0"
BATCH_ID = "gg-gf-ubiquitin-curation-rc2-batch-001"
ASSEMBLY_ACCESSION = "GCF_000002315.6"
ASSEMBLY_NAME = "GRCg6a"
PROTEIN_FASTA_NAME = "GCF_000002315.6_GRCg6a_protein.faa.gz"
ANNOTATION_GFF_NAME = "GCF_000002315.6_GRCg6a_genomic.gff.gz"
ASSEMBLY_REPORT_NAME = "GCF_000002315.6_GRCg6a_assembly_report.txt"
BATCH_ID_PATTERN = re.compile(r"^gg-gf-[a-z0-9-]+-curation-rc2-batch-[0-9]{3}$")
EXPECTED_DECISION_ARTIFACTS = (
    ("evidence_admissibility", "curator-decisions/evidence-admissibility-policy.json"),
    ("domain_vocabulary", "curator-decisions/domain-vocabulary.json"),
    ("rule_bundle", "curator-decisions/rule-bundle.json"),
    ("mapping_decisions", "curator-decisions/mapping-decisions.tsv"),
    ("rollup_policy", "curator-decisions/rollup-policy.json"),
    ("publication_policy", "curator-decisions/publication-policy.json"),
    ("regression_fixture_bundle", "curator-decisions/fixture-bundle.json"),
    ("shadow_scope_profile", "curator-decisions/shadow-scope-profile.json"),
    ("shadow_input_manifest", "curator-decisions/shadow-input-manifest.json"),
    ("scientific_approval_aggregate", "curator-decisions/scientific-approval-aggregate.json"),
    ("shadow_run", "curator-decisions/shadow-run-authorization.json"),
)


class CurationBatchError(ValueError):
    pass


def _write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                               allow_nan=False) + "\n", encoding="utf-8")


def _write_tsv(path: Path, fieldnames: list[str], rows: Iterable[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, delimiter="\t",
                                lineterminator="\n", extrasaction="raise")
        writer.writeheader()
        writer.writerows(rows)


def _parse_checksum_manifest(root: Path, path: Path) -> int:
    count = 0
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        try:
            expected, relative = raw.split("  ", 1)
        except ValueError as exc:
            raise CurationBatchError(f"invalid packet checksum line {line_number}") from exc
        relative_path = Path(relative)
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise CurationBatchError(f"unsafe packet checksum path: {relative}")
        target = root / relative_path
        if not target.is_file() or sha256_file(target) != expected:
            raise CurationBatchError(f"packet checksum mismatch: {relative}")
        count += 1
    if not count:
        raise CurationBatchError("packet checksum manifest is empty")
    return count


def _fasta_record_count(path: Path) -> int:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as handle:
        return sum(1 for line in handle if line.startswith(">"))


def _gff_metadata(path: Path) -> dict[str, str]:
    opener = gzip.open if path.suffix == ".gz" else open
    result: dict[str, str] = {}
    with opener(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if not line.startswith("#"):
                break
            for marker, key in (
                ("#!genome-build ", "genome_build"),
                ("#!genome-build-accession NCBI_Assembly:", "assembly_accession"),
                ("#!annotation-source ", "annotation_release"),
            ):
                if line.startswith(marker):
                    result[key] = line[len(marker):].strip()
    required = {"genome_build", "assembly_accession", "annotation_release"}
    if set(result) != required:
        raise CurationBatchError("GFF does not declare complete build/annotation metadata")
    if result["genome_build"] != ASSEMBLY_NAME or result["assembly_accession"] != ASSEMBLY_ACCESSION:
        raise CurationBatchError("GFF assembly identity is not GRCg6a GCF_000002315.6")
    return result


def _artifact(relative_path: str, root: Path, artifact_type: str,
              status: str = "observed") -> dict[str, Any]:
    path = root / relative_path
    return {"artifact_type": artifact_type, "relative_path": relative_path,
            "sha256": sha256_file(path), "required": True, "status": status}


def _inputs_lock(
    *, batch_id: str, packet_manifest: dict[str, Any], packet_manifest_sha256: str,
    packet_checksums_sha256: str, packet_file_count: int,
    rc1_manifest_sha256: str, rc1_database_sha256: str,
    handoff_manifest_sha256: str, evaluator_commit: str,
    source_rows: list[dict[str, Any]], annotation_release: str,
) -> dict[str, Any]:
    return {
        "lock_format": BATCH_FORMAT,
        "batch_id": batch_id,
        "assembly": {"name": ASSEMBLY_NAME, "accession": ASSEMBLY_ACCESSION,
                     "annotation_release": annotation_release},
        "rc1": {"release_id": packet_manifest["source_release_id"],
                "release_manifest_sha256": rc1_manifest_sha256,
                "database_sha256": rc1_database_sha256},
        "curator_packet": {"packet_id": packet_manifest["packet_id"],
                           "packet_manifest_sha256": packet_manifest_sha256,
                           "checksums_sha256": packet_checksums_sha256,
                           "verified_file_count": packet_file_count},
        "contracts": {"scientific_contract": "gg-gf-contract-1.0",
                      "rc2a_tag": "gene-family-rc2a-contract-v1.0",
                      "rc2b_evaluator_tag": "gene-family-rc2b-evaluator-core-v1.0",
                      "rc2b_evaluator_commit": evaluator_commit,
                      "handoff_contract": "gg-gf-rc2b1-scientific-handoff-1.0",
                      "handoff_manifest_sha256": handoff_manifest_sha256},
        "targeted_rescan_sources": [
            {key: row[key] for key in ("input_role", "logical_locator", "status",
                                       "sha256", "byte_size", "record_count")}
            for row in source_rows if row["status"] != "missing"
        ],
        "formal_targeted_rescan_ready": False,
        "scientific_shadow_authorized": False,
        "rc2c_build_authorized": False,
    }


def build_curation_batch(
    *, output: Path, packet_root: Path, rc1_manifest: Path,
    rc1_database: Path, handoff_root: Path, rc2_contract_root: Path,
    projectdata_root: Path, evaluator_commit: str, generator_commit: str,
    created_by: str, created_at: str, batch_id: str = BATCH_ID,
    supersedes_batch_id: str | None = None,
) -> Path:
    """Validate every observed input and atomically create a new batch."""
    output = output.resolve()
    if not BATCH_ID_PATTERN.fullmatch(batch_id):
        raise CurationBatchError(f"invalid curation batch ID: {batch_id}")
    if supersedes_batch_id is not None:
        if not BATCH_ID_PATTERN.fullmatch(supersedes_batch_id):
            raise CurationBatchError(f"invalid superseded batch ID: {supersedes_batch_id}")
        if supersedes_batch_id == batch_id:
            raise CurationBatchError("a curation batch cannot supersede itself")
    if output.exists():
        raise FileExistsError(f"curation batch output already exists: {output}")
    if not output.parent.is_dir():
        raise CurationBatchError(f"output parent does not exist: {output.parent}")
    report = validate_handoff_contracts(handoff_root, rc2_contract_root)
    if not report.ok:
        raise CurationBatchError(f"handoff contracts are invalid: {report.errors}")

    packet_manifest_path = packet_root / "packet-manifest.json"
    packet_checksums_path = packet_root / "checksums.sha256"
    packet_subjects_path = packet_root / "subject-universe.tsv"
    for path in (packet_manifest_path, packet_checksums_path, packet_subjects_path,
                 rc1_manifest, rc1_database):
        if not path.is_file():
            raise CurationBatchError(f"required input is missing: {path.name}")
    packet_file_count = _parse_checksum_manifest(packet_root, packet_checksums_path)
    packet_manifest = json.loads(packet_manifest_path.read_text(encoding="utf-8"))
    if packet_manifest.get("status") != "machine_generated_unapproved":
        raise CurationBatchError("curator packet status boundary changed")
    if packet_manifest.get("scientific_shadow_authorized") is not False:
        raise CurationBatchError("curator packet unexpectedly authorizes a shadow")

    rc1_manifest_sha256 = sha256_file(rc1_manifest)
    rc1_database_sha256 = sha256_file(rc1_database)
    if packet_manifest.get("source_manifest_sha256") != rc1_manifest_sha256:
        raise CurationBatchError("RC1 release manifest does not match curator packet")
    if packet_manifest.get("source_database_sha256") != rc1_database_sha256:
        raise CurationBatchError("RC1 database does not match curator packet")

    protein = projectdata_root / PROTEIN_FASTA_NAME
    gff = projectdata_root / ANNOTATION_GFF_NAME
    assembly_report = projectdata_root / ASSEMBLY_REPORT_NAME
    for path in (protein, gff, assembly_report):
        if not path.is_file():
            raise CurationBatchError(f"GRCg6a source asset is missing: {path.name}")
    gff_meta = _gff_metadata(gff)
    source_rows = [
        {"input_role": "assembly_report", "logical_locator": f"projectdata:{ASSEMBLY_REPORT_NAME}", "status": "observed", "sha256": sha256_file(assembly_report), "byte_size": assembly_report.stat().st_size, "record_count": "not_applicable", "completeness": "observed", "blocking_reason": ""},
        {"input_role": "protein_fasta", "logical_locator": f"projectdata:{PROTEIN_FASTA_NAME}", "status": "observed", "sha256": sha256_file(protein), "byte_size": protein.stat().st_size, "record_count": str(_fasta_record_count(protein)), "completeness": "not_assessed", "blocking_reason": "Protein file exists but the targeted subject subset is not yet frozen."},
        {"input_role": "gene_transcript_protein_map", "logical_locator": f"projectdata:{ANNOTATION_GFF_NAME}", "status": "observed", "sha256": sha256_file(gff), "byte_size": gff.stat().st_size, "record_count": "not_reported", "completeness": "not_assessed", "blocking_reason": "GFF mapping coverage for every declared RC1-associated isoform has not been validated."},
        {"input_role": "annotation_release", "logical_locator": f"projectdata:{ANNOTATION_GFF_NAME}", "status": "observed", "sha256": sha256_file(gff), "byte_size": gff.stat().st_size, "record_count": "not_applicable", "completeness": gff_meta["annotation_release"], "blocking_reason": ""},
    ]
    for role in ("declared_isoform_universe", "pfam_release", "pfam_hmm_library",
                 "hmmer_version", "complete_command", "threshold_policy",
                 "scanned_subject_list", "no_hit_subject_list", "failed_subject_list"):
        source_rows.append({"input_role": role, "logical_locator": "", "status": "missing",
                            "sha256": "", "byte_size": "", "record_count": "",
                            "completeness": "not_frozen",
                            "blocking_reason": "Required before targeted rescan or formal shadow authorization."})

    handoff_manifest = handoff_root / "handoff-contract-manifest-v1.json"
    handoff_manifest_sha256 = sha256_file(handoff_manifest)
    packet_manifest_sha256 = sha256_file(packet_manifest_path)
    packet_checksums_sha256 = sha256_file(packet_checksums_path)
    lock = _inputs_lock(
        batch_id=batch_id,
        packet_manifest=packet_manifest,
        packet_manifest_sha256=packet_manifest_sha256,
        packet_checksums_sha256=packet_checksums_sha256,
        packet_file_count=packet_file_count,
        rc1_manifest_sha256=rc1_manifest_sha256,
        rc1_database_sha256=rc1_database_sha256,
        handoff_manifest_sha256=handoff_manifest_sha256,
        evaluator_commit=evaluator_commit,
        source_rows=source_rows,
        annotation_release=gff_meta["annotation_release"],
    )

    stage = Path(tempfile.mkdtemp(prefix=f".{output.name}.staging-", dir=output.parent))
    try:
        (stage / "inputs").mkdir()
        (stage / "curator-decisions").mkdir()
        shutil.copyfile(packet_manifest_path, stage / "inputs" / "packet-manifest.json")
        shutil.copyfile(packet_checksums_path, stage / "inputs" / "packet-checksums.sha256")
        shutil.copyfile(packet_subjects_path, stage / "inputs" / "subject-universe.tsv")
        _write_json(stage / "inputs" / "rc1-release-lock.json", {
            "source_release_id": packet_manifest["source_release_id"],
            "source_manifest_sha256": rc1_manifest_sha256,
            "source_database_sha256": rc1_database_sha256,
            "raw_manifest_embedded": False,
            "reason": "The immutable source manifest is referenced by hash because it contains a machine-local source_directory field.",
        })
        _write_json(stage / "inputs-lock.json", lock)
        _write_tsv(stage / "targeted-rescan-input-inventory.tsv",
                   ["input_role", "logical_locator", "status", "sha256", "byte_size",
                    "record_count", "completeness", "blocking_reason"], source_rows)

        input_artifacts = [
            _artifact("inputs/packet-manifest.json", stage, "curator_packet_manifest"),
            _artifact("inputs/packet-checksums.sha256", stage, "curator_packet_checksums"),
            _artifact("inputs/subject-universe.tsv", stage, "rc1_subject_universe"),
            _artifact("inputs/rc1-release-lock.json", stage, "rc1_release_lock",
                      "generated_unapproved"),
            _artifact("inputs-lock.json", stage, "inputs_lock", "generated_unapproved"),
            _artifact("targeted-rescan-input-inventory.tsv", stage,
                      "targeted_rescan_input_inventory", "generated_unapproved"),
        ]
        batch_manifest = {
            "schema_version": "1.0", "batch_id": batch_id,
            "scheme_id": "ubiquitin_core", "purpose": "RC1 reassessment rule curation",
            "contract_version": "gg-gf-contract-1.0",
            "contract_tag": "gene-family-rc2a-contract-v1.0",
            "evaluator_tag": "gene-family-rc2b-evaluator-core-v1.0",
            "packet_manifest_sha256": packet_manifest_sha256,
            "handoff_contract_manifest_sha256": handoff_manifest_sha256,
            "input_artifacts": input_artifacts,
            "expected_decision_artifacts": [
                {"artifact_type": kind, "relative_path": path, "required": True,
                 "status": "missing"}
                for kind, path in EXPECTED_DECISION_ARTIFACTS
            ],
            "created_by": {"name": created_by, "role": "engineering_preparer"},
            "created_at": created_at, "status": "draft",
            "supersedes_batch_id": supersedes_batch_id,
            "scientific_approval_implied": False, "scientific_shadow_authorized": False,
            "rc2c_build_authorized": False,
            "limitations": [
                "This skeleton contains no curator decision or scientific approval.",
                "The declared isoform universe, Pfam/HMMER environment, scan lists and threshold policy are not frozen.",
                "No rescan, formal shadow run or RC2-C build is authorized.",
            ],
        }
        _write_json(stage / "curation-batch-manifest.json", batch_manifest)
        _write_json(stage / "build-provenance.json", {
            "generator": "backend.gene_family_curation_batch",
            "generator_commit": generator_commit,
            "created_at": created_at,
            "source_modification_count": 0,
            "scientific_decision_count": 0,
            "rescan_executed": False,
        })
        (stage / "curator-decisions" / "README.md").write_text(
            "# Curator decision drop zone\n\n"
            "No placeholder decision is supplied. Add only schema-valid, independently "
            "attested curator artifacts. Closing a batch is append-only; corrections require "
            "a new batch linked by `supersedes_batch_id`.\n",
            encoding="utf-8",
        )
        checksummed = sorted(path for path in stage.rglob("*") if path.is_file())
        lines = [f"{sha256_file(path)}  {path.relative_to(stage).as_posix()}"
                 for path in checksummed]
        (stage / "checksums.sha256").write_text("\n".join(lines) + "\n", encoding="utf-8")
        os.replace(stage, output)
    except Exception:
        if stage.exists():
            shutil.rmtree(stage)
        raise
    return output


def main(argv: list[str] | None = None) -> int:
    project_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Create an RC2-B.1 curation batch skeleton")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--packet-root", type=Path, required=True)
    parser.add_argument("--rc1-manifest", type=Path, required=True)
    parser.add_argument("--rc1-database", type=Path, required=True)
    parser.add_argument("--projectdata-root", type=Path, required=True)
    parser.add_argument("--evaluator-commit", required=True)
    parser.add_argument("--generator-commit", required=True)
    parser.add_argument("--created-by", required=True)
    parser.add_argument("--created-at", required=True)
    parser.add_argument("--batch-id", default=BATCH_ID)
    parser.add_argument("--supersedes-batch-id")
    parser.add_argument("--handoff-contracts", type=Path,
                        default=project_root / "contracts" / "gene-family" / "rc2b1")
    parser.add_argument("--rc2-contracts", type=Path,
                        default=project_root / "contracts" / "gene-family" / "rc2")
    args = parser.parse_args(argv)
    built = build_curation_batch(
        output=args.output, packet_root=args.packet_root,
        rc1_manifest=args.rc1_manifest, rc1_database=args.rc1_database,
        handoff_root=args.handoff_contracts, rc2_contract_root=args.rc2_contracts,
        projectdata_root=args.projectdata_root, evaluator_commit=args.evaluator_commit,
        generator_commit=args.generator_commit, created_by=args.created_by,
        created_at=args.created_at, batch_id=args.batch_id,
        supersedes_batch_id=args.supersedes_batch_id,
    )
    print(built)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
