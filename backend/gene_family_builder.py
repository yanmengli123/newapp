"""Build a versioned, assertion-centric Gallus gallus annotation catalog.

The builder treats every file in ``gene family`` as immutable source evidence.
It never edits a source TSV.  A build is assembled in a temporary directory,
validated, and then atomically promoted to a release-candidate directory.
"""

from __future__ import annotations

import csv
import hashlib
import json
import shutil
import sqlite3
import subprocess
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = "1.0.0-rc1"
SPECIES_NAME = "Gallus gallus"
TAXON_ID = 9031
ASSEMBLY_NAME = "GRCg6a"
ASSEMBLY_ACCESSION = "GCF_000002315.6"

EXPECTED_OUTPUTS = (
    "AnimalTFDB_Gallus_TF.curated_for_database.tsv",
    "AnimalTFDB_Gallus_Cofactor.normalized.tsv",
    "AnimalTFDB_Gallus_Cofactor.merged_with_local_pfam.tsv",
    "AnimalTFDB_Gallus_Cofactor_family_summary.tsv",
    "chicken_kinomer_kinase_members.with_family_detail.tsv",
    "chicken_kinomer_family_detail_summary.tsv",
)

SCHEMES = (
    (
        "pfam",
        "Pfam Entries & Protein Domains",
        "Pfam-HMMER",
        "per-entry HMM versions retained; database release unknown",
        "protein",
        "Protein-level Pfam profile-HMM matches and domain coordinates.",
    ),
    (
        "animaltfdb_tf",
        "AnimalTFDB Transcription Factors",
        "AnimalTFDB",
        "4.0",
        "gene",
        "AnimalTFDB Gallus gallus transcription-factor classifications with local Pfam support.",
    ),
    (
        "animaltfdb_cofactor",
        "AnimalTFDB Transcription Cofactors",
        "AnimalTFDB",
        "4.0",
        "gene",
        "AnimalTFDB Gallus gallus cofactor classifications with local Pfam support.",
    ),
    (
        "kinomer",
        "Kinomer Protein Kinases",
        "Kinomer",
        "1.0",
        "mixed",
        "Protein-level Kinomer group calls plus explicit protein-to-gene rollups.",
    ),
    (
        "ubiquitin_core",
        "Ubiquitin Core Roles",
        "ChickenData rule-based classification",
        "rc1",
        "gene",
        "E1, E2, E3 and DUB core-role assertions; candidates remain separate from accepted records.",
    ),
    (
        "ubiquitin_related_domain",
        "Ubiquitin-related Supplementary Domains",
        "ChickenData Pfam-derived classification",
        "rc1",
        "gene",
        "UBD and ULD supplementary annotations excluded from core-role totals.",
    ),
)

RULES = (
    (
        "rule:pfam_hmmer:rc1",
        "pfam",
        "rc1",
        "Pfam-HMMER source-hit assertion",
        "Create one protein-to-Pfam assertion per unique protein and Pfam accession; preserve every raw domain hit.",
        {"threshold_policy": "not recorded in source; threshold_pass remains null"},
    ),
    (
        "rule:animaltfdb_tf:rc1",
        "animaltfdb_tf",
        "rc1",
        "AnimalTFDB TF with orthogonal local support",
        "Keep the AnimalTFDB classification accepted; represent local Pfam support as separate evidence.",
        {"external_classification": "accepted", "local_support": "orthogonal"},
    ),
    (
        "rule:animaltfdb_cofactor:rc1",
        "animaltfdb_cofactor",
        "rc1",
        "AnimalTFDB cofactor with orthogonal local support",
        "Keep the external classification and expose mapping or local-support limitations independently.",
        {"external_classification": "accepted", "local_support": "orthogonal"},
    ),
    (
        "rule:kinomer_protein:rc1",
        "kinomer",
        "rc1",
        "Kinomer protein classification",
        "High/no-manual-check hits are accepted; cutoff-check hits remain candidates.",
        {"accepted_evidence_level": "high", "candidate_evidence_level": "medium_cutoff_check"},
    ),
    (
        "rule:kinomer_gene_rollup:rc1",
        "kinomer",
        "rc1",
        "Kinomer protein-to-gene rollup",
        "Roll protein assertions up to genes without discarding isoform conflicts; best evidence defines the primary entry.",
        {"accepted_precedes_candidate": True, "lower_i_evalue_preferred": True, "conflicts_retained": True},
    ),
    (
        "rule:ubiquitin_core:rc1",
        "ubiquitin_core",
        "rc1",
        "Ubiquitin core primary classification",
        "Only high/no-manual-check records are accepted; all other primary records remain candidates.",
        {"accepted_evidence_level": "high", "manual_check_required": "no"},
    ),
    (
        "rule:ubiquitin_related_domain:rc1",
        "ubiquitin_related_domain",
        "rc1",
        "Ubiquitin supplementary domain classification",
        "Preserve UBD/ULD results as supplementary assertions and exclude them from core E1/E2/E3/DUB totals.",
        {"assignment_role": "supplementary"},
    ),
)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def stable_id(prefix: str, *parts: object) -> str:
    payload = "\x1f".join("" if value is None else str(value) for value in parts)
    return f"{prefix}_{hashlib.sha256(payload.encode('utf-8')).hexdigest()[:24]}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def clean(value: Any) -> str:
    if value is None:
        return ""
    result = str(value).strip()
    if result.lower() in {"nan", "none", "null", "na", "n/a", "-"}:
        return ""
    return result


def split_values(value: Any) -> list[str]:
    raw = clean(value)
    if not raw:
        return []
    normalized = raw.replace(";", ",")
    return [item.strip() for item in normalized.split(",") if clean(item)]


def as_float(value: Any) -> float | None:
    raw = clean(value)
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def as_int(value: Any) -> int | None:
    number = as_float(value)
    if number is None:
        return None
    return int(number)


def git_commit(repo_root: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repo_root,
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip() or None
    except (OSError, subprocess.CalledProcessError):
        return None


@dataclass(frozen=True)
class MappingResult:
    state: str
    internal_gene_id: str | None
    method: str | None
    candidates: tuple[str, ...]


def resolve_gene_mapping_precedence(
    *, ncbi_supplied: bool, ensembl_supplied: bool, symbol_supplied: bool,
    ncbi_candidates: set[str], ensembl_candidates: set[str],
    symbol_candidates: set[str],
) -> MappingResult:
    """Resolve stable identifiers before considering a non-unique symbol.

    NCBI Gene and Ensembl gene identifiers are stable mapping assertions.  A
    symbol is only a fallback when neither stable identifier was supplied; it
    must never turn an exact stable-ID match into an ambiguous mapping.  If two
    supplied stable identifiers resolve to different genes, the result remains
    ambiguous and is not silently prioritized.
    """

    stable_sources = []
    if ncbi_supplied:
        stable_sources.append(("ncbigene", set(ncbi_candidates)))
    if ensembl_supplied:
        stable_sources.append(("ensembl", set(ensembl_candidates)))
    if stable_sources:
        nonempty = [(name, values) for name, values in stable_sources if values]
        union = set().union(*(values for _, values in nonempty)) if nonempty else set()
        if len(union) == 1:
            internal = next(iter(union))
            methods = "+".join(name for name, values in nonempty if internal in values)
            return MappingResult("exact", internal, methods, (internal,))
        if union:
            return MappingResult("ambiguous", None, None, tuple(sorted(union)))
        return MappingResult("unmapped", None, None, ())

    if symbol_supplied:
        ordered = tuple(sorted(symbol_candidates))
        if len(ordered) == 1:
            return MappingResult("exact", ordered[0], "gene_symbol", ordered)
        if ordered:
            return MappingResult("ambiguous", None, None, ordered)
    return MappingResult("unmapped", None, None, ())


class CatalogBuilder:
    def __init__(
        self,
        *,
        source_dir: Path,
        core_db: Path,
        schema_path: Path,
        release_root: Path,
        release_id: str,
        repo_root: Path,
        replace: bool = False,
    ) -> None:
        self.source_dir = source_dir.resolve()
        self.core_db = core_db.resolve()
        self.schema_path = schema_path.resolve()
        self.release_root = release_root.resolve()
        self.release_id = release_id
        self.repo_root = repo_root.resolve()
        self.replace = replace
        self.created_at = utc_now()
        self.commit = git_commit(self.repo_root)

        self.work_dir = self.release_root / f".{release_id}.tmp"
        self.final_dir = self.release_root / release_id
        self.db_path = self.work_dir / "gene_family.sqlite"
        self.qc_dir = self.work_dir / "qc"
        self.schema_dir = self.work_dir / "schema"

        self.conn: sqlite3.Connection | None = None
        self.source_inventory: list[dict[str, Any]] = []
        self.source_ids: dict[str, int] = {}
        self.source_sha: dict[str, str] = {}
        self.malformed_rows: list[dict[str, Any]] = []
        self.missing_files: list[dict[str, Any]] = []
        self.qc_results: list[dict[str, Any]] = []
        self.regression_results: list[dict[str, Any]] = []

        self.ncbi_index: dict[str, set[str]] = defaultdict(set)
        self.ensembl_index: dict[str, set[str]] = defaultdict(set)
        self.symbol_index: dict[str, set[str]] = defaultdict(set)
        self.xref_by_internal: dict[str, dict[str, str]] = {}
        self.protein_lengths: dict[str, int] = {}

        self.mapping_cache: dict[tuple[str, str, str], MappingResult] = {}
        self.subject_cache: dict[str, int] = {}
        self.entry_cache: set[str] = set()
        self.assertion_cache: dict[tuple[str, str, int, str], str] = {}
        self.subject_gene_links: set[tuple[int, str, str]] = set()
        self.invalid_domain_coordinates = 0

    @property
    def db(self) -> sqlite3.Connection:
        if self.conn is None:
            raise RuntimeError("Catalog database is not open")
        return self.conn

    def _safe_remove(self, path: Path, *, require_manifest: bool) -> None:
        resolved = path.resolve()
        if resolved.parent != self.release_root or resolved.name not in {self.release_id, f".{self.release_id}.tmp"}:
            raise RuntimeError(f"Refusing to remove unexpected path: {resolved}")
        if require_manifest:
            manifest = resolved / "manifest.json"
            if not manifest.exists():
                raise RuntimeError(f"Refusing to replace a directory without a matching manifest: {resolved}")
            payload = json.loads(manifest.read_text(encoding="utf-8"))
            if payload.get("release_id") != self.release_id:
                raise RuntimeError(f"Manifest release mismatch in {resolved}")
        shutil.rmtree(resolved)

    def prepare(self) -> None:
        if not self.source_dir.is_dir():
            raise FileNotFoundError(f"Gene-family source directory not found: {self.source_dir}")
        if not self.core_db.is_file():
            raise FileNotFoundError(f"Core gene database not found: {self.core_db}")
        if not self.schema_path.is_file():
            raise FileNotFoundError(f"Catalog schema not found: {self.schema_path}")

        self.release_root.mkdir(parents=True, exist_ok=True)
        if self.work_dir.exists():
            self._safe_remove(self.work_dir, require_manifest=False)
        if self.final_dir.exists():
            if not self.replace:
                raise FileExistsError(f"Release already exists: {self.final_dir}; pass --replace to rebuild it")
            self._safe_remove(self.final_dir, require_manifest=True)

        self.qc_dir.mkdir(parents=True)
        self.schema_dir.mkdir(parents=True)
        shutil.copy2(self.schema_path, self.schema_dir / "sqlite_schema.sql")

    def inventory_sources(self) -> None:
        files = sorted(path for path in self.source_dir.iterdir() if path.is_file())
        for path in files:
            info: dict[str, Any] = {
                "file_name": path.name,
                "relative_path": path.name,
                "sha256": sha256_file(path),
                "byte_size": path.stat().st_size,
                "row_count": None,
                "delimiter": None,
                "encoding": "binary" if path.suffix.lower() == ".docx" else "utf-8-sig",
                "header": [],
                "validation_status": "passed",
                "notes": "",
            }
            if path.suffix.lower() == ".tsv":
                info["delimiter"] = "tab"
                row_count = 0
                with path.open("r", encoding="utf-8-sig", newline="") as handle:
                    reader = csv.reader(handle, delimiter="\t")
                    header = next(reader, [])
                    info["header"] = header
                    for line_number, row in enumerate(reader, start=2):
                        row_count += 1
                        if len(row) != len(header):
                            self.malformed_rows.append(
                                {
                                    "file_name": path.name,
                                    "line_number": line_number,
                                    "expected_columns": len(header),
                                    "observed_columns": len(row),
                                }
                            )
                info["row_count"] = row_count
                malformed_count = sum(1 for row in self.malformed_rows if row["file_name"] == path.name)
                if malformed_count:
                    info["validation_status"] = "failed"
                    info["notes"] = f"{malformed_count} rows have an unexpected column count"
                if path.name == "ubiquitin_core_classification_basis.tsv" and len(header) == 1:
                    info["validation_status"] = "failed"
                    info["notes"] = "Expected tabular classification rules but detected one concatenated column"
            self.source_inventory.append(info)
            self.source_sha[path.name] = info["sha256"]

        actual = {row["file_name"] for row in self.source_inventory}
        for file_name in EXPECTED_OUTPUTS:
            if file_name not in actual:
                self.missing_files.append(
                    {
                        "file_name": file_name,
                        "status": "missing",
                        "reason": "Referenced by the module description but absent from the source directory",
                    }
                )

    def create_database(self) -> None:
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.execute("PRAGMA journal_mode = OFF")
        self.db.execute("PRAGMA synchronous = OFF")
        self.db.execute("PRAGMA temp_store = MEMORY")
        self.db.executescript(self.schema_path.read_text(encoding="utf-8"))

        self.db.execute(
            """
            INSERT INTO gf_release (
                release_id, schema_version, release_status, taxon_id, species_name,
                assembly_accession, assembly_name, annotation_release,
                proteome_source, proteome_version, created_at, previous_release_id,
                etl_git_commit, qc_status, notes
            ) VALUES (?, ?, 'release_candidate', ?, ?, ?, ?, NULL, 'NCBI RefSeq', NULL, ?, NULL, ?, 'pending', ?)
            """,
            (
                self.release_id,
                SCHEMA_VERSION,
                TAXON_ID,
                SPECIES_NAME,
                ASSEMBLY_ACCESSION,
                ASSEMBLY_NAME,
                self.created_at,
                self.commit,
                "RC1 exposes validated current data while retaining release blockers in the QC report.",
            ),
        )

        for row in self.source_inventory:
            cursor = self.db.execute(
                """
                INSERT INTO gf_source_file (
                    release_id, file_name, relative_path, sha256, byte_size, row_count,
                    delimiter, encoding, header_json, validation_status, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    self.release_id,
                    row["file_name"],
                    row["relative_path"],
                    row["sha256"],
                    row["byte_size"],
                    row["row_count"],
                    row["delimiter"],
                    row["encoding"],
                    json_text(row["header"]),
                    row["validation_status"],
                    row["notes"],
                ),
            )
            self.source_ids[row["file_name"]] = int(cursor.lastrowid)

        self.db.executemany(
            "INSERT INTO gf_scheme VALUES (?, ?, ?, ?, ?, ?)",
            SCHEMES,
        )
        for rule_id, scheme_id, version, name, definition, params in RULES:
            self.db.execute(
                """
                INSERT INTO gf_rule (
                    rule_id, scheme_id, rule_version, rule_name, rule_definition,
                    parameter_json, script_commit, effective_from_release
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (rule_id, scheme_id, version, name, definition, json_text(params), self.commit, self.release_id),
            )
        self.db.commit()

    def load_core_indexes(self) -> None:
        core = sqlite3.connect(f"file:{self.core_db.as_posix()}?mode=ro", uri=True)
        core.row_factory = sqlite3.Row
        try:
            for row in core.execute(
                "SELECT gene_id, gene_symbol, ncbi_gene_id, ensembl_gene_id, ensembl_transcript_id FROM gene_xref"
            ):
                internal = clean(row["gene_id"])
                if not internal:
                    continue
                data = {key: clean(row[key]) for key in row.keys()}
                self.xref_by_internal[internal] = data
                if data["ncbi_gene_id"]:
                    self.ncbi_index[data["ncbi_gene_id"]].add(internal)
                if data["ensembl_gene_id"]:
                    self.ensembl_index[data["ensembl_gene_id"]].add(internal)
                if data["gene_symbol"]:
                    self.symbol_index[data["gene_symbol"].upper()].add(internal)
            self.protein_lengths = {
                clean(row[0]): int(row[1])
                for row in core.execute("SELECT protein_id, length FROM protein_seq")
                if clean(row[0])
            }
        finally:
            core.close()

    def _record_identifier_mapping(self, namespace: str, accession: str, candidates: set[str]) -> None:
        accession = clean(accession)
        if not accession:
            return
        ordered = sorted(candidates)
        state = "exact" if len(ordered) == 1 else "ambiguous" if ordered else "unmapped"
        self.db.execute(
            """
            INSERT OR IGNORE INTO gf_identifier_mapping (
                release_id, source_namespace, source_accession, internal_gene_id,
                mapping_state, mapping_method, candidate_gene_ids_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                self.release_id,
                namespace,
                accession,
                ordered[0] if len(ordered) == 1 else None,
                state,
                namespace if ordered else None,
                json_text(ordered),
            ),
        )

    def resolve_gene(self, *, ncbi: str = "", ensembl: str = "", symbol: str = "") -> MappingResult:
        ncbi, ensembl, symbol = clean(ncbi), clean(ensembl), clean(symbol).upper()
        key = (ncbi, ensembl, symbol)
        cached = self.mapping_cache.get(key)
        if cached is not None:
            return cached

        if ncbi:
            matches = set(self.ncbi_index.get(ncbi, set()))
            self._record_identifier_mapping("ncbigene", ncbi, matches)
        if ensembl:
            matches = set(self.ensembl_index.get(ensembl, set()))
            self._record_identifier_mapping("ensembl", ensembl, matches)
        if symbol:
            matches = set(self.symbol_index.get(symbol, set()))
            self._record_identifier_mapping("gene_symbol", symbol, matches)

        result = resolve_gene_mapping_precedence(
            ncbi_supplied=bool(ncbi),
            ensembl_supplied=bool(ensembl),
            symbol_supplied=bool(symbol),
            ncbi_candidates=set(self.ncbi_index.get(ncbi, set())) if ncbi else set(),
            ensembl_candidates=set(self.ensembl_index.get(ensembl, set())) if ensembl else set(),
            symbol_candidates=set(self.symbol_index.get(symbol, set())) if symbol else set(),
        )
        self.mapping_cache[key] = result
        return result

    def get_gene_subject(self, *, ncbi: str = "", ensembl: str = "", symbol: str = "") -> tuple[int, MappingResult]:
        ncbi, ensembl, symbol = clean(ncbi), clean(ensembl), clean(symbol)
        mapping = self.resolve_gene(ncbi=ncbi, ensembl=ensembl, symbol=symbol)
        if mapping.internal_gene_id:
            subject_key = f"gene:{mapping.internal_gene_id}"
        elif ncbi:
            subject_key = f"gene:ncbigene:{ncbi}"
        elif ensembl:
            subject_key = f"gene:ensembl:{ensembl}"
        else:
            subject_key = f"gene:symbol:{symbol.upper() or 'unknown'}"

        cached = self.subject_cache.get(subject_key)
        if cached is not None:
            return cached, mapping

        xref = self.xref_by_internal.get(mapping.internal_gene_id or "", {})
        namespace = "ncbigene" if ncbi else "ensembl" if ensembl else "gene_symbol"
        accession = ncbi or ensembl or symbol or subject_key
        cursor = self.db.execute(
            """
            INSERT INTO gf_subject (
                release_id, subject_key, subject_type, source_namespace, source_accession,
                internal_gene_id, gene_symbol, ncbi_gene_id, ensembl_gene_id,
                protein_accession, transcript_accession, protein_length, description,
                mapping_state, mapping_method
            ) VALUES (?, ?, 'gene', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
            """,
            (
                self.release_id,
                subject_key,
                namespace,
                accession,
                mapping.internal_gene_id,
                clean(xref.get("gene_symbol")) or symbol or None,
                clean(xref.get("ncbi_gene_id")) or ncbi or None,
                clean(xref.get("ensembl_gene_id")) or ensembl or None,
                mapping.state,
                mapping.method,
            ),
        )
        subject_pk = int(cursor.lastrowid)
        self.subject_cache[subject_key] = subject_pk
        return subject_pk, mapping

    def get_protein_subject(
        self,
        protein_id: str,
        *,
        ncbi: str = "",
        ensembl: str = "",
        symbol: str = "",
        transcript: str = "",
        description: str = "",
    ) -> tuple[int, MappingResult]:
        protein_id = clean(protein_id)
        if not protein_id:
            raise ValueError("Protein subject requires a protein accession")
        mapping = self.resolve_gene(ncbi=ncbi, ensembl=ensembl, symbol=symbol)
        subject_key = f"protein:refseq:{protein_id}"
        subject_pk = self.subject_cache.get(subject_key)
        if subject_pk is None:
            xref = self.xref_by_internal.get(mapping.internal_gene_id or "", {})
            protein_state = "exact" if protein_id in self.protein_lengths else "unmapped"
            cursor = self.db.execute(
                """
                INSERT INTO gf_subject (
                    release_id, subject_key, subject_type, source_namespace, source_accession,
                    internal_gene_id, gene_symbol, ncbi_gene_id, ensembl_gene_id,
                    protein_accession, transcript_accession, protein_length, description,
                    mapping_state, mapping_method
                ) VALUES (?, ?, 'protein', 'refseq', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    self.release_id,
                    subject_key,
                    protein_id,
                    mapping.internal_gene_id,
                    clean(xref.get("gene_symbol")) or clean(symbol) or None,
                    clean(xref.get("ncbi_gene_id")) or clean(ncbi) or None,
                    clean(xref.get("ensembl_gene_id")) or clean(ensembl) or None,
                    protein_id,
                    clean(transcript) or None,
                    self.protein_lengths.get(protein_id),
                    clean(description) or None,
                    protein_state,
                    "protein_seq" if protein_state == "exact" else None,
                ),
            )
            subject_pk = int(cursor.lastrowid)
            self.subject_cache[subject_key] = subject_pk

        external_gene_id = clean(ncbi) or clean(ensembl) or clean(symbol)
        link = (subject_pk, mapping.internal_gene_id or "", external_gene_id)
        if external_gene_id and link not in self.subject_gene_links:
            self.db.execute(
                """
                INSERT OR IGNORE INTO gf_subject_gene (
                    subject_pk, internal_gene_id, external_gene_id, relationship, mapping_state
                ) VALUES (?, ?, ?, 'encoded_by', ?)
                """,
                (subject_pk, mapping.internal_gene_id or "", external_gene_id, mapping.state),
            )
            self.subject_gene_links.add(link)
        return subject_pk, mapping

    def ensure_entry(
        self,
        *,
        scheme_id: str,
        accession: str,
        name: str,
        entry_type: str,
        definition: str = "",
        parent_entry_id: str | None = None,
        external_url: str | None = None,
    ) -> str:
        accession = clean(accession) or clean(name) or "unclassified"
        entry_id = f"{scheme_id}:{accession}"
        if entry_id in self.entry_cache:
            return entry_id
        self.db.execute(
            """
            INSERT OR IGNORE INTO gf_entry (
                entry_id, scheme_id, accession, name, entry_type, definition,
                parent_entry_id, external_url, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            """,
            (
                entry_id,
                scheme_id,
                accession,
                clean(name) or accession,
                entry_type,
                clean(definition) or None,
                parent_entry_id,
                external_url,
            ),
        )
        self.entry_cache.add(entry_id)
        return entry_id

    def ensure_assertion(
        self,
        *,
        scheme_id: str,
        entry_id: str,
        subject_pk: int,
        assignment_role: str,
        assertion_state: str,
        support_tier: str,
        review_state: str,
        rule_id: str,
        source_record_id: str,
        representative_protein_id: str | None = None,
    ) -> str:
        key = (scheme_id, entry_id, subject_pk, assignment_role)
        cached = self.assertion_cache.get(key)
        if cached is not None:
            return cached
        assertion_id = stable_id("GFA", self.release_id, *key)
        self.db.execute(
            """
            INSERT INTO gf_assertion (
                assertion_id, release_id, scheme_id, entry_id, subject_pk,
                assignment_role, assertion_state, support_tier, review_state,
                representative_protein_id, rule_id, source_record_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                assertion_id,
                self.release_id,
                scheme_id,
                entry_id,
                subject_pk,
                assignment_role,
                assertion_state,
                support_tier,
                review_state,
                representative_protein_id,
                rule_id,
                source_record_id,
                self.created_at,
            ),
        )
        self.assertion_cache[key] = assertion_id
        return assertion_id

    def add_evidence(
        self,
        *,
        evidence_type: str,
        source_file_name: str,
        line_number: int,
        method: str,
        model_accession: str = "",
        score: float | None = None,
        sequence_evalue: float | None = None,
        domain_ievalue: float | None = None,
        threshold_type: str | None = None,
        threshold_value: float | None = None,
        threshold_pass: bool | None = None,
        description: str = "",
        payload: dict[str, Any] | None = None,
        suffix: str = "",
    ) -> tuple[str, str]:
        source_record_id = f"{self.source_sha[source_file_name][:12]}:{line_number}"
        evidence_id = stable_id("GFE", self.release_id, source_file_name, line_number, evidence_type, suffix)
        self.db.execute(
            """
            INSERT INTO gf_evidence (
                evidence_id, release_id, evidence_type, source_file_id, source_record_id,
                method, model_accession, score, sequence_evalue, domain_ievalue,
                threshold_type, threshold_value, threshold_pass, description, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                evidence_id,
                self.release_id,
                evidence_type,
                self.source_ids[source_file_name],
                source_record_id,
                method,
                clean(model_accession) or None,
                score,
                sequence_evalue,
                domain_ievalue,
                threshold_type,
                threshold_value,
                None if threshold_pass is None else int(threshold_pass),
                clean(description) or None,
                json_text(payload or {}),
            ),
        )
        return evidence_id, source_record_id

    def link_evidence(self, assertion_id: str, evidence_id: str, role: str, rank: int = 1) -> None:
        self.db.execute(
            "INSERT OR IGNORE INTO gf_assertion_evidence VALUES (?, ?, ?, ?)",
            (assertion_id, evidence_id, role, rank),
        )

    def source_rows(self, file_name: str) -> Iterable[tuple[int, dict[str, str]]]:
        path = self.source_dir / file_name
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            for line_number, row in enumerate(reader, start=2):
                yield line_number, {str(key): clean(value) for key, value in row.items() if key is not None}

    def load_pfam(self) -> None:
        file_name = "all_pfam_hits.tsv"
        for line_number, row in self.source_rows(file_name):
            protein_id = row["protein_id"]
            subject_pk, _ = self.get_protein_subject(
                protein_id,
                ncbi=row.get("gene_id", ""),
                symbol=row.get("gene_symbol", ""),
                transcript=row.get("transcript_id", ""),
                description=row.get("product", ""),
            )
            pfam_accession = row["pfam_acc"]
            entry_id = self.ensure_entry(
                scheme_id="pfam",
                accession=pfam_accession,
                name=row.get("pfam_name", "") or pfam_accession,
                entry_type="domain",
                definition=row.get("pfam_description", ""),
                external_url=f"https://www.ebi.ac.uk/interpro/entry/pfam/{pfam_accession}/",
            )
            evidence_id, source_record_id = self.add_evidence(
                evidence_type="profile_hmm_domain_hit",
                source_file_name=file_name,
                line_number=line_number,
                method="Pfam-HMMER",
                model_accession=row.get("pfam_acc_version", "") or pfam_accession,
                score=as_float(row.get("domain_score")),
                sequence_evalue=as_float(row.get("full_evalue")),
                domain_ievalue=as_float(row.get("i_evalue")),
                threshold_type="source_policy_unknown",
                threshold_pass=None,
                description=row.get("pfam_description", ""),
                payload={"product": row.get("product", ""), "full_score": as_float(row.get("full_score"))},
                suffix=row.get("domain_index", ""),
            )
            assertion_id = self.ensure_assertion(
                scheme_id="pfam",
                entry_id=entry_id,
                subject_pk=subject_pk,
                assignment_role="supplementary",
                assertion_state="accepted",
                support_tier="model_supported",
                review_state="not_required",
                rule_id="rule:pfam_hmmer:rc1",
                source_record_id=source_record_id,
                representative_protein_id=protein_id,
            )
            self.link_evidence(assertion_id, evidence_id, "supporting", as_int(row.get("domain_index")) or 1)

            coords = {
                name: as_int(row.get(name))
                for name in ("hmm_from", "hmm_to", "ali_from", "ali_to", "env_from", "env_to")
            }
            protein_length = self.protein_lengths.get(protein_id)
            invalid = False
            for left, right in (("hmm_from", "hmm_to"), ("ali_from", "ali_to"), ("env_from", "env_to")):
                if coords[left] is None or coords[right] is None or coords[left] < 1 or coords[left] > coords[right]:
                    invalid = True
            if protein_length is not None:
                for key in ("ali_from", "ali_to", "env_from", "env_to"):
                    if coords[key] is not None and coords[key] > protein_length:
                        invalid = True
            if invalid:
                self.invalid_domain_coordinates += 1

            self.db.execute(
                """
                INSERT INTO gf_domain_hit (
                    evidence_id, subject_pk, pfam_accession, pfam_accession_version,
                    pfam_name, domain_index, domain_total, hmm_from, hmm_to,
                    ali_from, ali_to, env_from, env_to, conditional_evalue,
                    independent_evalue, domain_score, accuracy, threshold_pass
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                """,
                (
                    evidence_id,
                    subject_pk,
                    pfam_accession,
                    row.get("pfam_acc_version") or None,
                    row.get("pfam_name") or pfam_accession,
                    as_int(row.get("domain_index")),
                    as_int(row.get("domain_total")),
                    coords["hmm_from"],
                    coords["hmm_to"],
                    coords["ali_from"],
                    coords["ali_to"],
                    coords["env_from"],
                    coords["env_to"],
                    as_float(row.get("c_evalue")),
                    as_float(row.get("i_evalue")),
                    as_float(row.get("domain_score")),
                    as_float(row.get("acc")),
                ),
            )
        self.db.commit()

    def load_transcription_factors(self) -> None:
        file_name = "AnimalTFDB_Gallus_TF.merged_with_local_pfam.tsv"
        for line_number, row in self.source_rows(file_name):
            subject_pk, mapping = self.get_gene_subject(
                ncbi=row.get("animalTFDB_entrez_id", ""),
                ensembl=row.get("animalTFDB_ensembl_id", ""),
                symbol=row.get("gene_symbol", ""),
            )
            family = row.get("animalTFDB_family", "") or "Unclassified"
            entry_id = self.ensure_entry(
                scheme_id="animaltfdb_tf",
                accession=family,
                name=family,
                entry_type="TF_family",
                definition=f"AnimalTFDB transcription-factor family: {family}",
                external_url="https://guolab.wchscu.cn/AnimalTFDB4/",
            )
            matched_local = row.get("matched_local_pfam", "").lower() == "yes"
            support_tier = "multi_source_supported" if matched_local else "external_curated"
            review_state = "not_required" if mapping.state == "exact" else "needs_mapping"
            evidence_id, source_record_id = self.add_evidence(
                evidence_type="external_curated_classification",
                source_file_name=file_name,
                line_number=line_number,
                method="AnimalTFDB 4.0",
                model_accession=family,
                description=f"AnimalTFDB TF classification for {row.get('gene_symbol', '')}",
                payload={
                    "animalTFDB_protein_id": row.get("animalTFDB_protein_id", ""),
                    "match_method": row.get("match_method", ""),
                },
                suffix="external",
            )
            assertion_id = self.ensure_assertion(
                scheme_id="animaltfdb_tf",
                entry_id=entry_id,
                subject_pk=subject_pk,
                assignment_role="primary",
                assertion_state="accepted",
                support_tier=support_tier,
                review_state=review_state,
                rule_id="rule:animaltfdb_tf:rc1",
                source_record_id=source_record_id,
            )
            self.link_evidence(assertion_id, evidence_id, "classification", 1)
            if matched_local:
                local_id, _ = self.add_evidence(
                    evidence_type="local_domain_support_summary",
                    source_file_name=file_name,
                    line_number=line_number,
                    method="Local Pfam-HMMER evidence merge",
                    model_accession=row.get("local_pfam_accs", ""),
                    description=row.get("local_pfam_descriptions", ""),
                    payload={
                        "local_protein_ids": row.get("local_protein_ids", ""),
                        "local_pfam_names": row.get("local_pfam_names", ""),
                        "local_hit_count": as_int(row.get("local_pfam_hit_count")),
                    },
                    suffix="local",
                )
                self.link_evidence(assertion_id, local_id, "supporting", 2)
        self.db.commit()

    def load_transcription_cofactors(self) -> None:
        file_name = "AnimalTFDB_Gallus_Cofactor.curated_for_database.tsv"
        for line_number, row in self.source_rows(file_name):
            subject_pk, mapping = self.get_gene_subject(
                ncbi=row.get("animalTFDB_entrez_id", ""),
                ensembl=row.get("animalTFDB_ensembl_id", ""),
                symbol=row.get("gene_symbol", ""),
            )
            family = row.get("family_or_set", "") or "Unclassified"
            entry_id = self.ensure_entry(
                scheme_id="animaltfdb_cofactor",
                accession=family,
                name=family,
                entry_type="cofactor_class",
                definition=f"AnimalTFDB transcription-cofactor class: {family}",
                external_url="https://guolab.wchscu.cn/AnimalTFDB4/",
            )
            matched_local = row.get("matched_local_pfam", "").lower() == "yes"
            evidence_level = row.get("evidence_level", "")
            manual = row.get("manual_check_required", "").lower() == "yes"
            mapping_only_review = manual and ("only" in evidence_level.lower() or mapping.state != "exact")
            assertion_state = "accepted" if not manual or mapping_only_review else "candidate"
            review_state = "needs_mapping" if mapping.state != "exact" else "unreviewed" if manual else "not_required"
            support_tier = "multi_source_supported" if matched_local else "external_curated"
            evidence_id, source_record_id = self.add_evidence(
                evidence_type="external_curated_classification",
                source_file_name=file_name,
                line_number=line_number,
                method="AnimalTFDB 4.0 curated database table",
                model_accession=family,
                description=row.get("classification_basis", ""),
                payload={
                    "evidence_level": evidence_level,
                    "match_method": row.get("match_method", ""),
                    "local_pfam_accs": row.get("local_pfam_accs", ""),
                },
            )
            assertion_id = self.ensure_assertion(
                scheme_id="animaltfdb_cofactor",
                entry_id=entry_id,
                subject_pk=subject_pk,
                assignment_role="primary",
                assertion_state=assertion_state,
                support_tier=support_tier,
                review_state=review_state,
                rule_id="rule:animaltfdb_cofactor:rc1",
                source_record_id=source_record_id,
            )
            self.link_evidence(assertion_id, evidence_id, "classification", 1)
        self.db.commit()

    def load_kinases(self) -> None:
        file_name = "chicken_kinomer_kinase_members.tsv"
        gene_hits: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for line_number, row in self.source_rows(file_name):
            protein_id = row["protein_id"]
            gene_ids = split_values(row.get("gene_ids"))
            symbols = split_values(row.get("gene_symbols"))
            pairs = []
            for index, gene_id in enumerate(gene_ids or [""]):
                pairs.append((gene_id, symbols[index] if index < len(symbols) else (symbols[0] if symbols else "")))
            first_gene, first_symbol = pairs[0]
            protein_subject, _ = self.get_protein_subject(
                protein_id,
                ncbi=first_gene,
                symbol=first_symbol,
                description=row.get("products", ""),
            )
            for gene_id, symbol in pairs[1:]:
                self.get_protein_subject(protein_id, ncbi=gene_id, symbol=symbol)

            group = row.get("kinase_group", "") or row.get("family_or_set", "") or "Unclassified"
            entry_id = self.ensure_entry(
                scheme_id="kinomer",
                accession=group,
                name=group,
                entry_type="kinase_group",
                definition=f"Kinomer protein-kinase group: {group}",
                external_url="https://www.compbio.dundee.ac.uk/kinomer/",
            )
            accepted = row.get("evidence_level", "").lower() == "high" and row.get("manual_check_required", "").lower() == "no"
            state = "accepted" if accepted else "candidate"
            review_state = "not_required" if accepted else "unreviewed"
            cutoff = as_float(row.get("group_cutoff"))
            i_evalue = as_float(row.get("i_evalue"))
            threshold_pass = None if cutoff is None or i_evalue is None else i_evalue <= cutoff
            evidence_id, source_record_id = self.add_evidence(
                evidence_type="kinomer_profile_hmm_hit",
                source_file_name=file_name,
                line_number=line_number,
                method="Kinomer 1.0 HMM library",
                model_accession=row.get("kinomer_hmm", ""),
                score=as_float(row.get("domain_score")),
                sequence_evalue=as_float(row.get("full_evalue")),
                domain_ievalue=i_evalue,
                threshold_type="group_cutoff",
                threshold_value=cutoff,
                threshold_pass=threshold_pass,
                description=row.get("classification_basis", ""),
                payload={
                    "subfamily": row.get("subfamily", ""),
                    "local_pfam_accs": row.get("local_pfam_accs", ""),
                    "evidence_level": row.get("evidence_level", ""),
                },
            )
            protein_assertion = self.ensure_assertion(
                scheme_id="kinomer",
                entry_id=entry_id,
                subject_pk=protein_subject,
                assignment_role="primary",
                assertion_state=state,
                support_tier="model_supported" if accepted else "weak_model",
                review_state=review_state,
                rule_id="rule:kinomer_protein:rc1",
                source_record_id=source_record_id,
                representative_protein_id=protein_id,
            )
            self.link_evidence(protein_assertion, evidence_id, "classification", 1)

            for gene_id, symbol in pairs:
                gene_subject, _ = self.get_gene_subject(ncbi=gene_id, symbol=symbol)
                gene_hits[gene_subject].append(
                    {
                        "entry_id": entry_id,
                        "group": group,
                        "state": state,
                        "i_evalue": i_evalue if i_evalue is not None else float("inf"),
                        "protein_id": protein_id,
                        "evidence_id": evidence_id,
                        "source_record_id": source_record_id,
                    }
                )

        for gene_subject, hits in gene_hits.items():
            by_group: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for hit in hits:
                by_group[hit["group"]].append(hit)
            accepted_groups = {group for group, values in by_group.items() if any(v["state"] == "accepted" for v in values)}
            ranked = sorted(
                by_group.items(),
                key=lambda item: (
                    0 if any(v["state"] == "accepted" for v in item[1]) else 1,
                    min(v["i_evalue"] for v in item[1]),
                    item[0],
                ),
            )
            for index, (_, group_hits) in enumerate(ranked):
                best = min(group_hits, key=lambda value: (0 if value["state"] == "accepted" else 1, value["i_evalue"], value["protein_id"]))
                conflict = len(accepted_groups) > 1 and best["group"] in accepted_groups
                if conflict:
                    state, support, review = "unresolved", "conflicting", "in_review"
                elif best["group"] in accepted_groups:
                    state, support, review = "accepted", "model_supported", "not_required"
                else:
                    state, support, review = "candidate", "weak_model", "unreviewed"
                assertion_id = self.ensure_assertion(
                    scheme_id="kinomer",
                    entry_id=best["entry_id"],
                    subject_pk=gene_subject,
                    assignment_role="primary" if index == 0 else "secondary",
                    assertion_state=state,
                    support_tier=support,
                    review_state=review,
                    rule_id="rule:kinomer_gene_rollup:rc1",
                    source_record_id=best["source_record_id"],
                    representative_protein_id=best["protein_id"],
                )
                for rank, hit in enumerate(sorted(group_hits, key=lambda value: value["i_evalue"]), start=1):
                    self.link_evidence(assertion_id, hit["evidence_id"], "conflicting" if conflict else "supporting", rank)
        self.db.commit()

    def _ensure_ubiquitin_entry(self, scheme_id: str, accession: str, entry_type: str) -> str:
        parent: str | None = None
        if scheme_id == "ubiquitin_core" and accession.startswith("E3_"):
            parent = self.ensure_entry(
                scheme_id="ubiquitin_core",
                accession="E3",
                name="E3",
                entry_type="functional_role",
                definition="Ubiquitin E3 ligase core role.",
            )
        return self.ensure_entry(
            scheme_id=scheme_id,
            accession=accession,
            name=accession,
            entry_type=entry_type,
            definition=(
                f"ChickenData ubiquitin core-role classification: {accession}"
                if scheme_id == "ubiquitin_core"
                else f"ChickenData ubiquitin-related supplementary domain category: {accession}"
            ),
            parent_entry_id=parent,
        )

    def load_ubiquitin_core(self) -> None:
        file_name = "chicken_ubiquitin_core_primary_members.tsv"
        for line_number, row in self.source_rows(file_name):
            gene_ids = split_values(row.get("gene_ids"))
            symbols = split_values(row.get("gene_symbols"))
            ncbi = gene_ids[0] if gene_ids else ""
            symbol = symbols[0] if symbols else ""
            subject_pk, mapping = self.get_gene_subject(ncbi=ncbi, symbol=symbol)
            family = row.get("family_or_set", "") or "Unclassified"
            entry_id = self._ensure_ubiquitin_entry("ubiquitin_core", family, "functional_role")
            accepted = row.get("evidence_level", "").lower() == "high" and row.get("manual_check_required", "").lower() == "no"
            state = "accepted" if accepted else "candidate"
            review_state = "needs_mapping" if mapping.state != "exact" else "not_required" if accepted else "unreviewed"
            support_tier = "multi_source_supported" if accepted else row.get("evidence_level", "") or "candidate"
            evidence_id, source_record_id = self.add_evidence(
                evidence_type="rule_based_classification",
                source_file_name=file_name,
                line_number=line_number,
                method="ChickenData ubiquitin-core rules",
                model_accession=row.get("pfam_accs", ""),
                description=row.get("classification_basis", ""),
                payload={
                    "subfamily": row.get("subfamily", ""),
                    "protein_ids": row.get("protein_ids", ""),
                    "symbol_hit": row.get("symbol_hit", ""),
                    "domain_hit": row.get("domain_hit", ""),
                    "product_hit": row.get("product_hit", ""),
                    "evidence_level": row.get("evidence_level", ""),
                    "pfam_names": row.get("pfam_names", ""),
                },
            )
            assertion_id = self.ensure_assertion(
                scheme_id="ubiquitin_core",
                entry_id=entry_id,
                subject_pk=subject_pk,
                assignment_role="primary",
                assertion_state=state,
                support_tier=support_tier,
                review_state=review_state,
                rule_id="rule:ubiquitin_core:rc1",
                source_record_id=source_record_id,
                representative_protein_id=(split_values(row.get("protein_ids")) or [None])[0],
            )
            self.link_evidence(assertion_id, evidence_id, "classification", 1)
        self.db.commit()

    def load_ubiquitin_supplementary(self) -> None:
        file_name = "chicken_ubiquitin_supplementary_UBD_ULD.tsv"
        for line_number, row in self.source_rows(file_name):
            gene_ids = split_values(row.get("gene_ids"))
            symbols = split_values(row.get("gene_symbols"))
            subject_pk, mapping = self.get_gene_subject(
                ncbi=gene_ids[0] if gene_ids else "",
                symbol=symbols[0] if symbols else "",
            )
            category = row.get("related_category", "") or "Unclassified"
            entry_id = self._ensure_ubiquitin_entry(
                "ubiquitin_related_domain", category, "supplementary_domain"
            )
            evidence_id, source_record_id = self.add_evidence(
                evidence_type="supplementary_domain_classification",
                source_file_name=file_name,
                line_number=line_number,
                method="Local Pfam-HMMER evidence merge",
                model_accession=row.get("pfam_accs", ""),
                description=row.get("classification_basis", ""),
                payload={
                    "protein_ids": row.get("protein_ids", ""),
                    "pfam_names": row.get("pfam_names", ""),
                    "products": row.get("products", ""),
                },
            )
            assertion_id = self.ensure_assertion(
                scheme_id="ubiquitin_related_domain",
                entry_id=entry_id,
                subject_pk=subject_pk,
                assignment_role="supplementary",
                assertion_state="accepted",
                support_tier="domain_supported",
                review_state="not_required" if mapping.state == "exact" else "needs_mapping",
                rule_id="rule:ubiquitin_related_domain:rc1",
                source_record_id=source_record_id,
                representative_protein_id=(split_values(row.get("protein_ids")) or [None])[0],
            )
            self.link_evidence(assertion_id, evidence_id, "supporting", 1)
        self.db.commit()

    def materialize_summaries(self) -> None:
        self.db.execute("DELETE FROM gf_entry_summary WHERE release_id = ?", (self.release_id,))
        self.db.execute(
            """
            INSERT INTO gf_entry_summary (
                release_id, entry_id, accepted_genes, candidate_genes, unresolved_genes,
                accepted_proteins, candidate_proteins, evidence_coverage, mapping_coverage
            )
            SELECT
                ?, e.entry_id,
                COUNT(DISTINCT CASE
                    WHEN a.assertion_state = 'accepted'
                     AND s.internal_gene_id IS NOT NULL
                     AND (s.subject_type = 'gene' OR e.scheme_id = 'pfam')
                    THEN s.internal_gene_id END),
                COUNT(DISTINCT CASE
                    WHEN a.assertion_state = 'candidate'
                     AND s.internal_gene_id IS NOT NULL
                     AND (s.subject_type = 'gene' OR e.scheme_id = 'pfam')
                    THEN s.internal_gene_id END),
                COUNT(DISTINCT CASE
                    WHEN a.assertion_state = 'unresolved'
                     AND s.internal_gene_id IS NOT NULL
                     AND (s.subject_type = 'gene' OR e.scheme_id = 'pfam')
                    THEN s.internal_gene_id END),
                COUNT(DISTINCT CASE WHEN a.assertion_state = 'accepted' AND s.subject_type = 'protein' THEN s.protein_accession END),
                COUNT(DISTINCT CASE WHEN a.assertion_state = 'candidate' AND s.subject_type = 'protein' THEN s.protein_accession END),
                COALESCE(ROUND(1.0 * COUNT(DISTINCT CASE WHEN ae.evidence_id IS NOT NULL THEN a.assertion_id END)
                    / NULLIF(COUNT(DISTINCT a.assertion_id), 0), 6), 0.0),
                COALESCE(ROUND(1.0 * COUNT(DISTINCT CASE WHEN s.internal_gene_id IS NOT NULL THEN s.subject_pk END)
                    / NULLIF(COUNT(DISTINCT s.subject_pk), 0), 6), 0.0)
            FROM gf_entry e
            LEFT JOIN gf_assertion a ON a.entry_id = e.entry_id AND a.release_id = ?
            LEFT JOIN gf_subject s ON s.subject_pk = a.subject_pk
            LEFT JOIN gf_assertion_evidence ae ON ae.assertion_id = a.assertion_id
            GROUP BY e.entry_id
            """,
            (self.release_id, self.release_id),
        )

        self.db.execute("DELETE FROM gf_scheme_summary WHERE release_id = ?", (self.release_id,))
        self.db.execute(
            """
            INSERT INTO gf_scheme_summary (
                release_id, scheme_id, entry_count, accepted_genes, candidate_genes,
                unresolved_genes, accepted_proteins, candidate_proteins,
                annotated_proteins, domain_hits, mapping_coverage
            )
            SELECT
                ?, sc.scheme_id,
                COUNT(DISTINCT e.entry_id),
                COUNT(DISTINCT CASE
                    WHEN a.assertion_state = 'accepted'
                     AND s.internal_gene_id IS NOT NULL
                     AND (s.subject_type = 'gene' OR sc.scheme_id = 'pfam')
                    THEN s.internal_gene_id END),
                COUNT(DISTINCT CASE
                    WHEN a.assertion_state = 'candidate'
                     AND s.internal_gene_id IS NOT NULL
                     AND (s.subject_type = 'gene' OR sc.scheme_id = 'pfam')
                    THEN s.internal_gene_id END),
                COUNT(DISTINCT CASE
                    WHEN a.assertion_state = 'unresolved'
                     AND s.internal_gene_id IS NOT NULL
                     AND (s.subject_type = 'gene' OR sc.scheme_id = 'pfam')
                    THEN s.internal_gene_id END),
                COUNT(DISTINCT CASE WHEN a.assertion_state = 'accepted' AND s.subject_type = 'protein' THEN s.protein_accession END),
                COUNT(DISTINCT CASE WHEN a.assertion_state = 'candidate' AND s.subject_type = 'protein' THEN s.protein_accession END),
                COUNT(DISTINCT CASE WHEN s.subject_type = 'protein' THEN s.protein_accession END),
                CASE WHEN sc.scheme_id = 'pfam' THEN (SELECT COUNT(*) FROM gf_domain_hit) ELSE 0 END,
                COALESCE(ROUND(1.0 * COUNT(DISTINCT CASE WHEN s.internal_gene_id IS NOT NULL THEN s.subject_pk END)
                    / NULLIF(COUNT(DISTINCT s.subject_pk), 0), 6), 0.0)
            FROM gf_scheme sc
            LEFT JOIN gf_entry e ON e.scheme_id = sc.scheme_id
            LEFT JOIN gf_assertion a ON a.entry_id = e.entry_id AND a.release_id = ?
            LEFT JOIN gf_subject s ON s.subject_pk = a.subject_pk
            GROUP BY sc.scheme_id
            """,
            (self.release_id, self.release_id),
        )
        self.db.commit()

    def add_qc(
        self,
        check_name: str,
        *,
        severity: str,
        status: str,
        observed: Any = None,
        expected: Any = None,
        details: str = "",
    ) -> None:
        row = {
            "check_name": check_name,
            "severity": severity,
            "status": status,
            "observed_value": None if observed is None else str(observed),
            "expected_value": None if expected is None else str(expected),
            "details": details,
        }
        self.qc_results.append(row)
        self.db.execute(
            """
            INSERT INTO gf_qc_result (
                release_id, check_name, severity, status, observed_value,
                expected_value, details
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                self.release_id,
                row["check_name"],
                row["severity"],
                row["status"],
                row["observed_value"],
                row["expected_value"],
                row["details"],
            ),
        )

    def _count(self, sql: str, params: tuple[Any, ...] = ()) -> int:
        return int(self.db.execute(sql, params).fetchone()[0])

    def _source_row_count(self, file_name: str) -> int:
        return int(next(row["row_count"] for row in self.source_inventory if row["file_name"] == file_name) or 0)

    def _manual_key_set(self, file_name: str, fields: tuple[str, ...]) -> set[tuple[str, ...]]:
        return {
            tuple(row.get(field, "") for field in fields)
            for _, row in self.source_rows(file_name)
        }

    def run_qc(self) -> None:
        malformed = len(self.malformed_rows)
        self.add_qc(
            "tsv_column_consistency",
            severity="error",
            status="passed" if malformed == 0 else "failed",
            observed=malformed,
            expected=0,
            details="All TSV data rows must contain the same number of columns as their header.",
        )
        classification_info = next(
            row for row in self.source_inventory if row["file_name"] == "ubiquitin_core_classification_basis.tsv"
        )
        basis_ok = len(classification_info["header"]) > 1
        self.add_qc(
            "ubiquitin_classification_basis_schema",
            severity="error",
            status="passed" if basis_ok else "failed",
            observed=len(classification_info["header"]),
            expected="> 1 column",
            details="The current file is concatenated into one column and is not imported as a rule source.",
        )
        self.add_qc(
            "documented_outputs_present",
            severity="error",
            status="passed" if not self.missing_files else "failed",
            observed=len(self.missing_files),
            expected=0,
            details="Missing documented outputs are listed in qc/missing_files.tsv.",
        )
        script_count = sum(
            1
            for path in self.source_dir.iterdir()
            if path.is_file() and path.suffix.lower() in {".py", ".r", ".sh", ".ps1"}
        )
        self.add_qc(
            "source_analysis_scripts_present",
            severity="error",
            status="passed" if script_count else "failed",
            observed=script_count,
            expected=">= 1",
            details="The description references analysis scripts, but none are present beside the source data.",
        )

        pfam_rows = self._source_row_count("all_pfam_hits.tsv")
        domain_hits = self._count("SELECT COUNT(*) FROM gf_domain_hit")
        self.add_qc(
            "pfam_hit_reconciliation",
            severity="error",
            status="passed" if pfam_rows == domain_hits else "failed",
            observed=domain_hits,
            expected=pfam_rows,
            details="Every source Pfam hit must remain represented in gf_domain_hit.",
        )
        self.add_qc(
            "pfam_coordinate_validation",
            severity="error",
            status="passed" if self.invalid_domain_coordinates == 0 else "failed",
            observed=self.invalid_domain_coordinates,
            expected=0,
            details="HMM, alignment and envelope coordinates must be ordered and protein-bounded when length is available.",
        )
        unknown_thresholds = self._count("SELECT COUNT(*) FROM gf_domain_hit WHERE threshold_pass IS NULL")
        self.add_qc(
            "pfam_threshold_policy_recorded",
            severity="warning",
            status="warning" if unknown_thresholds else "passed",
            observed=unknown_thresholds,
            expected=0,
            details="The source does not record whether --cut_ga or a fixed threshold was used; hits remain visible in RC1.",
        )

        tf_rows = self._source_row_count("AnimalTFDB_Gallus_TF.merged_with_local_pfam.tsv")
        tf_assertions = self._count(
            "SELECT COUNT(*) FROM gf_assertion WHERE scheme_id = 'animaltfdb_tf' AND assignment_role = 'primary'"
        )
        self.add_qc(
            "tf_assertion_reconciliation",
            severity="error",
            status="passed" if tf_rows == tf_assertions else "failed",
            observed=tf_assertions,
            expected=tf_rows,
        )
        cofactor_rows = self._source_row_count("AnimalTFDB_Gallus_Cofactor.curated_for_database.tsv")
        cofactor_assertions = self._count(
            "SELECT COUNT(*) FROM gf_assertion WHERE scheme_id = 'animaltfdb_cofactor' AND assignment_role = 'primary'"
        )
        self.add_qc(
            "cofactor_assertion_reconciliation",
            severity="error",
            status="passed" if cofactor_rows == cofactor_assertions else "failed",
            observed=cofactor_assertions,
            expected=cofactor_rows,
        )

        kinase_rows = self._source_row_count("chicken_kinomer_kinase_members.tsv")
        kinase_proteins = self._count(
            """
            SELECT COUNT(*) FROM gf_assertion a JOIN gf_subject s ON s.subject_pk = a.subject_pk
            WHERE a.scheme_id = 'kinomer' AND s.subject_type = 'protein' AND a.assignment_role = 'primary'
            """
        )
        self.add_qc(
            "kinomer_protein_reconciliation",
            severity="error",
            status="passed" if kinase_rows == kinase_proteins else "failed",
            observed=kinase_proteins,
            expected=kinase_rows,
        )
        kinase_manual_expected = {
            row.get("protein_id", "")
            for _, row in self.source_rows("chicken_kinomer_kinase_members.tsv")
            if row.get("manual_check_required", "").lower() == "yes"
        }
        kinase_manual_actual = {
            row.get("protein_id", "") for _, row in self.source_rows("chicken_kinomer_manual_check.tsv")
        }
        kinase_manual_ok = kinase_manual_expected == kinase_manual_actual
        self.add_qc(
            "kinomer_manual_check_reconciliation",
            severity="error",
            status="passed" if kinase_manual_ok else "failed",
            observed=len(kinase_manual_actual),
            expected=len(kinase_manual_expected),
        )

        ubi_rows = self._source_row_count("chicken_ubiquitin_core_primary_members.tsv")
        ubi_assertions = self._count(
            "SELECT COUNT(*) FROM gf_assertion WHERE scheme_id = 'ubiquitin_core' AND assignment_role = 'primary'"
        )
        self.add_qc(
            "ubiquitin_primary_reconciliation",
            severity="error",
            status="passed" if ubi_rows == ubi_assertions else "failed",
            observed=ubi_assertions,
            expected=ubi_rows,
        )
        ubi_accepted = self._count(
            "SELECT COUNT(*) FROM gf_assertion WHERE scheme_id = 'ubiquitin_core' AND assertion_state = 'accepted'"
        )
        self.add_qc(
            "ubiquitin_accepted_count",
            severity="error",
            status="passed" if ubi_accepted == 387 else "failed",
            observed=ubi_accepted,
            expected=387,
            details="Only high/no-manual-check core assertions contribute to the accepted assertion total.",
        )
        ubi_accepted_mapped = self._count(
            """
            SELECT COUNT(DISTINCT s.internal_gene_id)
            FROM gf_assertion a JOIN gf_subject s ON s.subject_pk = a.subject_pk
            WHERE a.scheme_id = 'ubiquitin_core' AND a.assertion_state = 'accepted'
              AND s.internal_gene_id IS NOT NULL
            """
        )
        self.add_qc(
            "ubiquitin_accepted_gene_mapping",
            severity="warning",
            status="passed" if ubi_accepted_mapped == ubi_accepted else "warning",
            observed=ubi_accepted_mapped,
            expected=ubi_accepted,
            details="Accepted assertions without an exact internal mapping stay visible but are excluded from mapped-gene totals.",
        )
        ubi_manual_expected = self._manual_key_set(
            "chicken_ubiquitin_core_manual_check.tsv", ("gene_key", "family_or_set", "subfamily")
        )
        ubi_manual_actual = {
            (row.get("gene_key", ""), row.get("family_or_set", ""), row.get("subfamily", ""))
            for _, row in self.source_rows("chicken_ubiquitin_core_members.tsv")
            if row.get("manual_check_required", "").lower() == "yes"
        }
        self.add_qc(
            "ubiquitin_manual_check_reconciliation",
            severity="error",
            status="passed" if ubi_manual_actual == ubi_manual_expected else "failed",
            observed=len(ubi_manual_expected),
            expected=len(ubi_manual_actual),
        )

        ubi_domain_rows = self._source_row_count("chicken_ubiquitin_domain_evidence.tsv")
        evidence_scope_ok = ubi_domain_rows != pfam_rows
        self.add_qc(
            "ubiquitin_domain_evidence_scope",
            severity="error",
            status="passed" if evidence_scope_ok else "failed",
            observed=ubi_domain_rows,
            expected=f"a ubiquitin-filtered subset, not the full {pfam_rows} Pfam rows",
            details="The file currently has the same row count as all_pfam_hits.tsv and is excluded as a ubiquitin-specific source in RC1.",
        )

        self._run_regression_case(
            case_id="ubiquitin_negative_cftr",
            description="CFTR may remain traceable as a candidate but must not be accepted as E3_RBR.",
            sql="""
                SELECT
                    SUM(CASE WHEN a.assertion_state = 'candidate' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN a.assertion_state = 'accepted' THEN 1 ELSE 0 END)
                FROM gf_assertion a JOIN gf_subject s ON s.subject_pk = a.subject_pk
                WHERE a.scheme_id = 'ubiquitin_core' AND UPPER(s.gene_symbol) = 'CFTR'
                  AND a.entry_id = 'ubiquitin_core:E3_RBR'
            """,
            predicate=lambda row: (row[0] or 0) >= 1 and (row[1] or 0) == 0,
        )
        self._run_regression_case(
            case_id="kinase_positive_bmpr2",
            description="BMPR2 must retain an accepted TKL Kinomer gene assertion.",
            sql="""
                SELECT COUNT(*) FROM gf_assertion a JOIN gf_subject s ON s.subject_pk = a.subject_pk
                WHERE a.scheme_id = 'kinomer' AND s.subject_type = 'gene'
                  AND UPPER(s.gene_symbol) = 'BMPR2' AND a.entry_id = 'kinomer:TKL'
                  AND a.assertion_state = 'accepted'
            """,
            predicate=lambda row: row[0] >= 1,
        )
        self._run_regression_case(
            case_id="tf_positive_thap1",
            description="THAP1 must retain an accepted AnimalTFDB THAP assertion.",
            sql="""
                SELECT COUNT(*) FROM gf_assertion a JOIN gf_subject s ON s.subject_pk = a.subject_pk
                WHERE a.scheme_id = 'animaltfdb_tf' AND UPPER(s.gene_symbol) = 'THAP1'
                  AND a.entry_id = 'animaltfdb_tf:THAP' AND a.assertion_state = 'accepted'
            """,
            predicate=lambda row: row[0] >= 1,
        )
        self._run_regression_case(
            case_id="supplementary_excluded_from_core",
            description="Supplementary UBD/ULD assertions must never be stored in the ubiquitin_core scheme.",
            sql="""
                SELECT COUNT(*) FROM gf_assertion
                WHERE scheme_id = 'ubiquitin_core' AND assignment_role = 'supplementary'
            """,
            predicate=lambda row: row[0] == 0,
        )

        regression_failures = sum(1 for row in self.regression_results if row["status"] == "failed")
        self.add_qc(
            "biological_regression_suite",
            severity="error",
            status="passed" if regression_failures == 0 else "failed",
            observed=regression_failures,
            expected=0,
            details="See qc/regression_results.tsv for fixed positive and negative biological cases.",
        )

        mapping_total = self._count("SELECT COUNT(*) FROM gf_identifier_mapping")
        mapping_exact = self._count("SELECT COUNT(*) FROM gf_identifier_mapping WHERE mapping_state = 'exact'")
        mapping_rate = round(mapping_exact / mapping_total, 6) if mapping_total else 0.0
        self.add_qc(
            "identifier_mapping_coverage",
            severity="warning",
            status="passed" if mapping_rate >= 0.95 else "warning",
            observed=f"{mapping_rate:.4%}",
            expected=">= 95%",
            details="Unmapped and ambiguous identifiers remain in the catalog and are exported as QC reports.",
        )
        mapping_cross_table_mismatches = self._count(
            """
            SELECT COUNT(*)
            FROM gf_subject s
            JOIN gf_identifier_mapping m
              ON m.release_id = s.release_id
             AND m.source_namespace = s.source_namespace
             AND m.source_accession = s.source_accession
            WHERE s.mapping_state <> m.mapping_state
               OR COALESCE(s.internal_gene_id, '') <> COALESCE(m.internal_gene_id, '')
            """
        )
        self.add_qc(
            "mapping_cross_table_mismatch_count",
            severity="error",
            status="passed" if mapping_cross_table_mismatches == 0 else "failed",
            observed=mapping_cross_table_mismatches,
            expected=0,
            details=(
                "A subject and its effective identifier-registry row must have "
                "the same mapping state and internal gene identifier."
            ),
        )

        self.add_qc(
            "tool_and_proteome_versions_recorded",
            severity="error",
            status="failed",
            observed="incomplete",
            expected="Pfam, HMMER, proteome and annotation versions plus commands",
            details="Source files retain per-entry Pfam HMM versions, but the full run manifest is absent.",
        )
        self.db.commit()

    def _run_regression_case(self, *, case_id: str, description: str, sql: str, predicate: Any) -> None:
        row = self.db.execute(sql).fetchone()
        passed = bool(predicate(row))
        self.regression_results.append(
            {
                "case_id": case_id,
                "status": "passed" if passed else "failed",
                "observed": json_text(list(row)),
                "description": description,
            }
        )

    @staticmethod
    def write_tsv(path: Path, rows: list[dict[str, Any]], headers: list[str]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=headers, delimiter="\t", extrasaction="ignore", lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)

    def write_reports(self) -> None:
        self.write_tsv(
            self.work_dir / "source_inventory.tsv",
            [
                {
                    **row,
                    "header": json_text(row["header"]),
                }
                for row in self.source_inventory
            ],
            [
                "file_name", "relative_path", "sha256", "byte_size", "row_count",
                "delimiter", "encoding", "validation_status", "notes", "header",
            ],
        )
        self.write_tsv(
            self.qc_dir / "missing_files.tsv",
            self.missing_files,
            ["file_name", "status", "reason"],
        )
        self.write_tsv(
            self.qc_dir / "malformed_rows.tsv",
            self.malformed_rows,
            ["file_name", "line_number", "expected_columns", "observed_columns"],
        )
        mapping_rows = [dict(row) for row in self.db.execute(
            """
            SELECT source_namespace, source_accession, mapping_state, internal_gene_id,
                   candidate_gene_ids_json, mapping_method
            FROM gf_identifier_mapping WHERE mapping_state = 'unmapped'
            ORDER BY source_namespace, source_accession
            """
        )]
        self.write_tsv(
            self.qc_dir / "unmapped_ids.tsv",
            mapping_rows,
            ["source_namespace", "source_accession", "mapping_state", "internal_gene_id", "candidate_gene_ids_json", "mapping_method"],
        )
        ambiguous_rows = [dict(row) for row in self.db.execute(
            """
            SELECT source_namespace, source_accession, mapping_state, internal_gene_id,
                   candidate_gene_ids_json, mapping_method
            FROM gf_identifier_mapping WHERE mapping_state = 'ambiguous'
            ORDER BY source_namespace, source_accession
            """
        )]
        self.write_tsv(
            self.qc_dir / "ambiguous_mappings.tsv",
            ambiguous_rows,
            ["source_namespace", "source_accession", "mapping_state", "internal_gene_id", "candidate_gene_ids_json", "mapping_method"],
        )
        conflict_rows = [dict(row) for row in self.db.execute(
            """
            SELECT a.assertion_id, a.scheme_id, a.entry_id, s.internal_gene_id,
                   s.gene_symbol, s.protein_accession, a.support_tier, a.review_state
            FROM gf_assertion a JOIN gf_subject s ON s.subject_pk = a.subject_pk
            WHERE a.assertion_state = 'unresolved'
            ORDER BY a.scheme_id, s.gene_symbol, a.entry_id
            """
        )]
        self.write_tsv(
            self.qc_dir / "assertion_conflicts.tsv",
            conflict_rows,
            ["assertion_id", "scheme_id", "entry_id", "internal_gene_id", "gene_symbol", "protein_accession", "support_tier", "review_state"],
        )
        self.write_tsv(
            self.qc_dir / "regression_results.tsv",
            self.regression_results,
            ["case_id", "status", "observed", "description"],
        )
        (self.qc_dir / "qc_report.json").write_text(
            json.dumps(
                {
                    "release_id": self.release_id,
                    "generated_at": self.created_at,
                    "results": self.qc_results,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        self.write_contracts()

    def write_contracts(self) -> None:
        openapi = {
            "openapi": "3.1.0",
            "info": {
                "title": "ChickenData Gene Family Catalog API",
                "version": SCHEMA_VERSION,
                "description": "Versioned read-only API contract for catalog entries, assertions, evidence and gene annotations.",
            },
            "paths": {
                "/api/v1/gene-family-catalog/releases/current": {"get": {"operationId": "currentCatalogRelease", "responses": {"200": {"description": "Active release"}}}},
                "/api/v1/gene-family-catalog/summary": {"get": {"operationId": "catalogSummary", "responses": {"200": {"description": "Scheme-aware catalog summary"}}}},
                "/api/v1/gene-family-catalog/search": {"get": {"operationId": "searchCatalog", "responses": {"200": {"description": "Entry, gene and protein search results"}}}},
                "/api/v1/gene-family-catalog/entries": {"get": {"operationId": "listCatalogEntries", "responses": {"200": {"description": "Cursor-paginated catalog entries"}}}},
                "/api/v1/gene-family-catalog/entries/{entryId}": {"get": {"operationId": "getCatalogEntry", "responses": {"200": {"description": "Catalog entry"}}}},
                "/api/v1/gene-family-catalog/entries/{entryId}/members": {"get": {"operationId": "listEntryMembers", "responses": {"200": {"description": "Cursor-paginated assertions and subjects"}}}},
                "/api/v1/gene-family-catalog/entries/{entryId}/evidence": {"get": {"operationId": "listEntryEvidence", "responses": {"200": {"description": "Cursor-paginated evidence links"}}}},
                "/api/v1/gene-family-catalog/assertions/{assertionId}": {"get": {"operationId": "getAssertion", "responses": {"200": {"description": "Assertion with evidence and review history"}}}},
                "/api/v1/genes/{internalGeneId}/family-annotations": {"get": {"operationId": "getGeneFamilyAnnotations", "responses": {"200": {"description": "Gene classifications and protein-domain architectures"}}}},
                "/api/v1/proteins/{proteinId}/domain-hits": {"get": {"operationId": "getProteinDomainHits", "responses": {"200": {"description": "Protein-level Pfam hits"}}}},
            },
        }
        (self.schema_dir / "openapi.json").write_text(
            json.dumps(openapi, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        manifest_schema = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$id": "https://chickendata.local/schema/gene-family-manifest-rc1.json",
            "title": "ChickenData Gene Family Catalog Manifest",
            "type": "object",
            "required": [
                "release_id", "release_status", "schema_version", "qc_status",
                "species_name", "taxonomy_id", "assembly_accession", "source_files",
                "record_counts", "identifier_mapping",
            ],
            "properties": {
                "release_id": {"type": "string"},
                "release_status": {"enum": ["release_candidate", "published", "withdrawn"]},
                "schema_version": {"type": "string"},
                "qc_status": {"enum": ["pending", "passed", "warning", "blocked"]},
                "species_name": {"const": SPECIES_NAME},
                "taxonomy_id": {"const": TAXON_ID},
                "assembly_accession": {"type": "string"},
                "source_files": {"type": "array", "items": {"type": "object"}},
                "record_counts": {"type": "object"},
                "identifier_mapping": {"type": "object"},
            },
            "additionalProperties": True,
        }
        (self.schema_dir / "manifest.schema.json").write_text(
            json.dumps(manifest_schema, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def register_assets(self) -> None:
        descriptions = {
            "source_inventory.tsv": "Source-file inventory with schemas, checksums and validation state.",
            "qc/qc_report.json": "Machine-readable release-candidate QC results.",
            "qc/unmapped_ids.tsv": "Identifiers that could not be mapped to a ChickenData internal gene ID.",
            "qc/ambiguous_mappings.tsv": "Identifiers mapping to more than one internal gene.",
            "qc/assertion_conflicts.tsv": "Unresolved classification conflicts retained in RC1.",
            "qc/regression_results.tsv": "Fixed biological regression-case results.",
            "schema/sqlite_schema.sql": "SQLite schema for the assertion-centric release database.",
            "schema/openapi.json": "Versioned HTTP API contract for catalog consumers.",
            "schema/manifest.schema.json": "JSON Schema for the release manifest.",
        }
        for relative_path, description in descriptions.items():
            path = self.work_dir / relative_path
            self.db.execute(
                """
                INSERT INTO gf_release_asset (
                    release_id, asset_name, relative_path, media_type, sha256, byte_size, description
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    self.release_id,
                    Path(relative_path).name,
                    relative_path.replace("\\", "/"),
                    "application/json" if path.suffix == ".json" else "text/tab-separated-values",
                    sha256_file(path),
                    path.stat().st_size,
                    description,
                ),
            )
        self.db.execute(
            """
            INSERT INTO gf_release_asset (
                release_id, asset_name, relative_path, media_type, sha256, byte_size, description
            ) VALUES (?, 'gene_family.sqlite', 'gene_family.sqlite', 'application/vnd.sqlite3', NULL, NULL,
                'Immutable release-candidate SQLite catalog.')
            """,
            (self.release_id,),
        )
        late_assets = (
            ("manifest.json", "Machine-readable release metadata and record counts.", "application/json"),
            ("checksums.sha256", "SHA-256 checksums for every release-package file.", "text/plain"),
            ("README.md", "Human-readable release overview.", "text/markdown"),
            ("CHANGELOG.md", "Release history.", "text/markdown"),
        )
        for asset_name, description, media_type in late_assets:
            self.db.execute(
                """
                INSERT INTO gf_release_asset (
                    release_id, asset_name, relative_path, media_type, sha256, byte_size, description
                ) VALUES (?, ?, ?, ?, NULL, NULL, ?)
                """,
                (self.release_id, asset_name, asset_name, media_type, description),
            )
        self.db.commit()

    def finalize_database(self) -> str:
        failed_errors = sum(
            1
            for row in self.qc_results
            if row["severity"] == "error" and row["status"] == "failed"
        )
        warnings = sum(1 for row in self.qc_results if row["status"] == "warning")
        qc_status = "blocked" if failed_errors else "warning" if warnings else "passed"
        self.db.execute(
            "UPDATE gf_release SET qc_status = ? WHERE release_id = ?",
            (qc_status, self.release_id),
        )
        self.db.commit()
        foreign_key_errors = list(self.db.execute("PRAGMA foreign_key_check"))
        if foreign_key_errors:
            raise RuntimeError(f"Catalog foreign-key check failed: {foreign_key_errors[:5]}")
        integrity = self.db.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"Catalog integrity check failed: {integrity}")
        self.db.execute("PRAGMA optimize")
        self.db.commit()
        self.db.close()
        self.conn = None
        return qc_status

    def write_manifest_and_checksums(self, qc_status: str) -> None:
        db = sqlite3.connect(f"file:{self.db_path.as_posix()}?mode=ro", uri=True)
        db.row_factory = sqlite3.Row
        counts = {
            "entries": int(db.execute("SELECT COUNT(*) FROM gf_entry").fetchone()[0]),
            "subjects": int(db.execute("SELECT COUNT(*) FROM gf_subject").fetchone()[0]),
            "assertions": int(db.execute("SELECT COUNT(*) FROM gf_assertion").fetchone()[0]),
            "evidence_records": int(db.execute("SELECT COUNT(*) FROM gf_evidence").fetchone()[0]),
            "domain_hits": int(db.execute("SELECT COUNT(*) FROM gf_domain_hit").fetchone()[0]),
            "review_events": int(db.execute("SELECT COUNT(*) FROM gf_review_event").fetchone()[0]),
        }
        schemes = [dict(row) for row in db.execute(
            """
            SELECT scheme_id, entry_count, accepted_genes, candidate_genes,
                   unresolved_genes, accepted_proteins, candidate_proteins,
                   annotated_proteins, domain_hits, mapping_coverage
            FROM gf_scheme_summary ORDER BY scheme_id
            """
        )]
        mapping = {
            row["mapping_state"]: row["n"]
            for row in db.execute(
                "SELECT mapping_state, COUNT(*) AS n FROM gf_identifier_mapping GROUP BY mapping_state"
            )
        }
        db.close()

        source_manifest = [
            {
                key: row[key]
                for key in ("file_name", "relative_path", "sha256", "byte_size", "row_count", "validation_status", "notes")
            }
            for row in self.source_inventory
        ]
        manifest = {
            "release_id": self.release_id,
            "release_status": "release_candidate",
            "schema_version": SCHEMA_VERSION,
            "qc_status": qc_status,
            "created_at": self.created_at,
            "species_name": SPECIES_NAME,
            "taxonomy_id": TAXON_ID,
            "assembly_accession": ASSEMBLY_ACCESSION,
            "assembly_name": ASSEMBLY_NAME,
            "annotation_release": None,
            "proteome_source": "NCBI RefSeq",
            "proteome_version": None,
            "pfam_version": None,
            "hmmer_version": None,
            "animaltfdb_version": "4.0",
            "kinomer_version": "1.0",
            "threshold_policy": "Source policy not recorded; raw Pfam threshold_pass is null in RC1.",
            "gene_rollup_policy": "Versioned by rule:kinomer_gene_rollup:rc1",
            "etl_git_commit": self.commit,
            "source_directory": str(self.source_dir),
            "source_files": source_manifest,
            "record_counts": counts,
            "scheme_summaries": schemes,
            "identifier_mapping": mapping,
            "qc_report": "qc/qc_report.json",
            "license": None,
            "citations": [
                "AnimalTFDB 4.0",
                "Pfam-HMMER",
                "Kinomer 1.0",
            ],
        }
        (self.work_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        (self.work_dir / "README.md").write_text(
            f"# {SPECIES_NAME} Gene, Protein Family & Domain Annotation Catalog\n\n"
            f"Release: `{self.release_id}`  \nAssembly: `{ASSEMBLY_NAME}` (`{ASSEMBLY_ACCESSION}`)  \n"
            f"Status: `release_candidate`  \nQC: `{qc_status}`\n\n"
            "This package is generated from immutable source files. `gene_family.sqlite` is the\n"
            "assertion-centric publication database. The RC1 status is intentional: unresolved\n"
            "source-format, provenance and version issues are recorded in `qc/qc_report.json`.\n\n"
            "Accepted, candidate and unresolved assertions are never merged into one total.\n",
            encoding="utf-8",
        )
        (self.work_dir / "CHANGELOG.md").write_text(
            f"# Changelog\n\n## {self.release_id}\n\n- Initial assertion-centric release candidate.\n"
            "- Preserves raw Pfam domain hits and protein isoforms.\n"
            "- Separates external classification, local support, candidates and supplementary domains.\n",
            encoding="utf-8",
        )

        checksum_paths = sorted(
            path for path in self.work_dir.rglob("*") if path.is_file() and path.name != "checksums.sha256"
        )
        lines = [
            f"{sha256_file(path)}  {path.relative_to(self.work_dir).as_posix()}"
            for path in checksum_paths
        ]
        (self.work_dir / "checksums.sha256").write_text("\n".join(lines) + "\n", encoding="ascii")

    def build(self) -> Path:
        self.prepare()
        try:
            self.inventory_sources()
            self.create_database()
            self.load_core_indexes()
            self.db.execute("BEGIN")
            self.load_pfam()
            self.load_transcription_factors()
            self.load_transcription_cofactors()
            self.load_kinases()
            self.load_ubiquitin_core()
            self.load_ubiquitin_supplementary()
            self.materialize_summaries()
            self.run_qc()
            self.write_reports()
            self.register_assets()
            qc_status = self.finalize_database()
            self.write_manifest_and_checksums(qc_status)
            self.work_dir.replace(self.final_dir)
            return self.final_dir
        except Exception:
            if self.conn is not None:
                self.conn.close()
                self.conn = None
            raise
