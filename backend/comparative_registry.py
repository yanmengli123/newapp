"""Registry-driven assembly metadata for GRCg6a/GRCg7b comparisons."""

from __future__ import annotations

import csv
import gzip
import hashlib
from pathlib import Path
from typing import Any, Iterable


SPECIAL_CHR_ORDER = {"W": 10_000, "Z": 10_001, "MT": 10_002, "M": 10_002}


def chromosome_sort_key(chr_name: str) -> tuple[int, int | str]:
    normalized = chr_name.removeprefix("chr")
    if normalized.isdigit():
        return (0, int(normalized))
    return (1, SPECIAL_CHR_ORDER.get(normalized, normalized))


def normalize_chr_name(value: str) -> str:
    text = value.strip()
    if text.startswith("chr"):
        text = text[3:]
    if text == "M":
        return "MT"
    return text


def display_chr(chr_name: str) -> str:
    normalized = normalize_chr_name(chr_name)
    return f"chr{normalized}"


def file_sha256(path: str | Path | None) -> str | None:
    if not path:
        return None
    resolved = Path(path)
    if not resolved.exists() or not resolved.is_file():
        return None
    digest = hashlib.sha256()
    with resolved.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_fai(path: str | Path | None) -> dict[str, int]:
    if not path:
        return {}
    resolved = Path(path)
    if not resolved.exists():
        return {}
    rows: dict[str, int] = {}
    with resolved.open("r", encoding="ascii", errors="replace") as handle:
        for line in handle:
            fields = line.rstrip("\n").split("\t")
            if len(fields) < 2:
                continue
            try:
                rows[fields[0]] = int(fields[1])
            except ValueError:
                continue
    return rows


def open_text(path: str | Path):
    resolved = Path(path)
    if resolved.suffix == ".gz":
        return gzip.open(resolved, "rt", encoding="utf-8", errors="replace")
    return resolved.open("r", encoding="utf-8", errors="replace")


def read_gff_seqids(path: str | Path | None) -> set[str]:
    if not path:
        return set()
    resolved = Path(path)
    if not resolved.exists():
        return set()
    seqids: set[str] = set()
    with open_text(resolved) as handle:
        for line in handle:
            if line.startswith("##sequence-region "):
                fields = line.rstrip("\n").split()
                if len(fields) >= 2:
                    seqids.add(fields[1])
                continue
            if not line.strip() or line.startswith("#"):
                continue
            fields = line.rstrip("\n").split("\t")
            if fields:
                seqids.add(fields[0])
    return seqids


def read_sequence_report(path: str | Path) -> list[dict[str, str]]:
    with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle, delimiter="\t"))


def molecule_aliases(chr_name: str, refseq: str, genbank: str = "", ucsc: str = "") -> list[str]:
    aliases = [
        normalize_chr_name(chr_name),
        display_chr(chr_name),
        refseq.strip(),
        genbank.strip(),
        ucsc.strip(),
    ]
    seen: set[str] = set()
    result: list[str] = []
    for value in aliases:
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _classify_molecule(molecule_type: str) -> str:
    return "organelle" if molecule_type == "Mitochondrion" else "chromosome"


def _fai_match(aliases: Iterable[str], fai: dict[str, int]) -> tuple[str | None, int | None]:
    for alias in aliases:
        if alias in fai:
            return alias, fai[alias]
    return None, None


def _gff_has_alias(aliases: Iterable[str], gff_seqids: set[str]) -> bool:
    return not gff_seqids or any(alias in gff_seqids for alias in aliases)


def load_assembly_registry(
    *,
    assembly_name: str,
    sequence_report: str | Path,
    fai_path: str | Path | None = None,
    gff_path: str | Path | None = None,
    fasta_path: str | Path | None = None,
    expected_assembled_molecules: int | None = None,
) -> dict[str, Any]:
    """Load one assembly registry from NCBI sequence_report plus local files."""
    report_path = Path(sequence_report)
    fai = read_fai(fai_path)
    gff_seqids = read_gff_seqids(gff_path)
    molecules: list[dict[str, Any]] = []
    errors: list[str] = []
    warnings: list[str] = []

    for row in read_sequence_report(report_path):
        if row.get("Role", "").strip() != "assembled-molecule":
            continue
        molecule_type = row.get("Molecule type", "").strip()
        if molecule_type not in {"Chromosome", "Mitochondrion"}:
            continue
        chr_name = normalize_chr_name(row.get("Chromosome name", ""))
        refseq = row.get("RefSeq seq accession", "").strip()
        if not chr_name or not refseq:
            continue
        try:
            sequence_report_length = int(row.get("Seq length", "0"))
        except ValueError:
            sequence_report_length = 0
        genbank = row.get("GenBank seq accession", "").strip()
        aliases = molecule_aliases(chr_name, refseq, genbank, row.get("UCSC style name", ""))
        fai_seqid, fai_length = _fai_match(aliases, fai)
        if fai and fai_seqid is None:
            errors.append(f"{assembly_name} {chr_name}: no FASTA/FAI alias matched {aliases}")
        if fai_length is not None and sequence_report_length and fai_length != sequence_report_length:
            errors.append(
                f"{assembly_name} {chr_name}: sequence_report length {sequence_report_length} != FAI length {fai_length}"
            )
        if not _gff_has_alias(aliases, gff_seqids):
            errors.append(f"{assembly_name} {chr_name}: no GFF3 seqid alias matched {aliases}")
        molecules.append(
            {
                "assembly": assembly_name,
                "assembly_accession": row.get("Assembly Accession", "").strip(),
                "assembly_unit": row.get("Assembly-unit name", "").strip(),
                "chr": chr_name,
                "display_name": display_chr(chr_name),
                "refseq": refseq,
                "genbank": genbank,
                "ucsc": row.get("UCSC style name", "").strip(),
                "sequence_name": row.get("Sequence name", "").strip(),
                "molecule_type": molecule_type,
                "molecule_class": _classify_molecule(molecule_type),
                "length": sequence_report_length,
                "fai_seqid": fai_seqid,
                "fai_length": fai_length,
                "aliases": aliases,
            }
        )

    molecules.sort(key=lambda item: chromosome_sort_key(str(item["chr"])))
    if expected_assembled_molecules is not None and len(molecules) != expected_assembled_molecules:
        errors.append(
            f"{assembly_name}: expected {expected_assembled_molecules} assembled molecules, found {len(molecules)}"
        )
    if not fai:
        warnings.append(f"{assembly_name}: FAI was not provided or is missing")
    if not gff_seqids and gff_path:
        warnings.append(f"{assembly_name}: GFF3 seqids were not available")

    return {
        "assembly": assembly_name,
        "assembly_accession": molecules[0]["assembly_accession"] if molecules else "",
        "assembled_molecule_count": len(molecules),
        "chromosome_count": sum(1 for item in molecules if item["molecule_class"] == "chromosome"),
        "organelle_count": sum(1 for item in molecules if item["molecule_class"] == "organelle"),
        "total_length": sum(int(item["length"]) for item in molecules),
        "molecules": molecules,
        "files": {
            "sequence_report": str(report_path),
            "fasta": str(fasta_path) if fasta_path else None,
            "fai": str(fai_path) if fai_path else None,
            "gff": str(gff_path) if gff_path else None,
        },
        "checksums": {
            "sequence_report_sha256": file_sha256(report_path),
            "fasta_sha256": file_sha256(fasta_path),
            "fai_sha256": file_sha256(fai_path),
            "gff_sha256": file_sha256(gff_path),
        },
        "validation": {
            "status": "failed" if errors else "passed",
            "errors": errors,
            "warnings": warnings,
        },
    }


def _molecule_by_chr(registry: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(item["chr"]): item for item in registry.get("molecules", [])}


def build_pair_registry(
    *,
    grcg6a_report: str | Path,
    grcg7b_report: str | Path,
    grcg6a_fai: str | Path | None = None,
    grcg7b_fai: str | Path | None = None,
    grcg6a_gff: str | Path | None = None,
    grcg7b_gff: str | Path | None = None,
    grcg6a_fasta: str | Path | None = None,
    grcg7b_fasta: str | Path | None = None,
    expected_grcg6a_molecules: int | None = None,
    expected_grcg7b_molecules: int | None = None,
) -> dict[str, Any]:
    """Build the GRCg6a/GRCg7b comparative registry."""
    grcg6a = load_assembly_registry(
        assembly_name="GRCg6a",
        sequence_report=grcg6a_report,
        fai_path=grcg6a_fai,
        gff_path=grcg6a_gff,
        fasta_path=grcg6a_fasta,
        expected_assembled_molecules=expected_grcg6a_molecules,
    )
    grcg7b = load_assembly_registry(
        assembly_name="GRCg7b",
        sequence_report=grcg7b_report,
        fai_path=grcg7b_fai,
        gff_path=grcg7b_gff,
        fasta_path=grcg7b_fasta,
        expected_assembled_molecules=expected_grcg7b_molecules,
    )
    by_6a = _molecule_by_chr(grcg6a)
    by_7b = _molecule_by_chr(grcg7b)
    shared = sorted(set(by_6a) & set(by_7b), key=chromosome_sort_key)
    target_only = sorted(set(by_7b) - set(by_6a), key=chromosome_sort_key)
    query_only = sorted(set(by_6a) - set(by_7b), key=chromosome_sort_key)

    chromosome_mapping = [
        {
            "chr": chr_name,
            "chr_from": chr_name,
            "chr_to": chr_name,
            "refseq_from": by_6a[chr_name]["refseq"],
            "refseq_to": by_7b[chr_name]["refseq"],
            "genbank_from": by_6a[chr_name]["genbank"],
            "genbank_to": by_7b[chr_name]["genbank"],
            "length_from": by_6a[chr_name]["length"],
            "length_to": by_7b[chr_name]["length"],
            "strand": "+",
            "mapping_type": "shared_name",
        }
        for chr_name in shared
    ]

    errors = []
    for assembly in (grcg6a, grcg7b):
        errors.extend(assembly["validation"]["errors"])
    if "33" not in by_6a:
        errors.append("GRCg6a registry is missing chr33")
    if "33" not in by_7b:
        errors.append("GRCg7b registry is missing chr33")
    if "29" in by_6a:
        errors.append("GRCg6a registry unexpectedly contains chr29")
    if "29" in shared:
        errors.append("chr29 must not be in one-to-one shared chromosome mapping")

    target_only_rows = [
        {
            "chr": chr_name,
            "display_name": by_7b[chr_name]["display_name"],
            "refseq": by_7b[chr_name]["refseq"],
            "genbank": by_7b[chr_name]["genbank"],
            "length": by_7b[chr_name]["length"],
            "molecule_type": by_7b[chr_name]["molecule_type"],
            "interpretation": (
                "GRCg7b-only assembled molecule; inspect evidence PAF against GRCg6a full assembly."
            ),
        }
        for chr_name in target_only
    ]

    return {
        "version": "comparative_gold_v1",
        "pair": {
            "assembly_1": "GRCg6a",
            "assembly_2": "GRCg7b",
            "comparison_id": "GRCg6a__GRCg7b",
            "species": "Gallus gallus",
        },
        "assemblies": {"GRCg6a": grcg6a, "GRCg7b": grcg7b},
        "shared_molecules": shared,
        "query_only_molecules": query_only,
        "target_only_molecules": target_only_rows,
        "chromosome_mapping": chromosome_mapping,
        "dotplot_axes": {
            "query": {
                "assembly": "GRCg6a",
                "molecule_count": len(grcg6a["molecules"]),
                "molecules": grcg6a["molecules"],
            },
            "target": {
                "assembly": "GRCg7b",
                "molecule_count": len(grcg7b["molecules"]),
                "molecules": grcg7b["molecules"],
            },
        },
        "validation": {
            "status": "failed" if errors else "passed",
            "errors": errors,
        },
    }

