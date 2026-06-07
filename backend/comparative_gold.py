"""Gold-standard comparative genomics helpers.

This module describes the evidence layers that make a synteny browser
scientifically auditable:

* primary whole-genome natural PAF for interactive ribbons
* base-level cs/cigar PAF for local block details
* gene-level collinearity anchors for functional conservation

The helpers never fabricate missing layers. If an indexed cs PAF or anchors
file is absent, the API reports that state explicitly so the UI cannot silently
promote a QC/fallback dataset to primary evidence.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal, Optional
import csv
import gzip
import os
import shutil
import subprocess

from backend.comparative_paf import GRCG6A_REFSEQ_TO_CHR, normalize_chr, parse_paf_line


EvidenceStatus = Literal["available", "missing", "not_indexed", "fallback_qc"]
CoordinateSide = Literal["query", "target"]


@dataclass(frozen=True)
class EvidenceFile:
    role: str
    path: str
    exists: bool
    size_bytes: int

    @classmethod
    def from_path(cls, role: str, path: Path) -> "EvidenceFile":
        return cls(
            role=role,
            path=str(path),
            exists=path.exists(),
            size_bytes=path.stat().st_size if path.exists() else 0,
        )

    def to_dict(self) -> dict:
        return asdict(self)


class GoldStandardComparativeStore:
    """File-backed registry for comparative evidence layers."""

    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.synteny_root = project_root / "synteny"
        self.comparative_root = project_root / "comparative"
        self.pair_root = self.comparative_root / "pairwise" / "GRCg6a__GRCg7b"

    @property
    def primary_paf(self) -> Path:
        return self.synteny_root / "natural" / "grcg6a_vs_grcg7b.natural.asm5.paf"

    @property
    def primary_provenance(self) -> Path:
        return self.synteny_root / "natural" / "grcg6a_vs_grcg7b.natural.asm5.provenance.json"

    @property
    def windowed_qc_paf(self) -> Path:
        return self.synteny_root / "grcg6a_vs_grcg7b.paf"

    @property
    def dna_alignment_root(self) -> Path:
        return self.pair_root / "dna_alignment"

    @property
    def base_level_paf(self) -> Path:
        return self.dna_alignment_root / "primary.asm5.cs.paf.gz"

    @property
    def base_level_plain_paf(self) -> Path:
        return self.dna_alignment_root / "primary.asm5.cs.paf"

    @property
    def base_level_query_index(self) -> Path:
        return self.dna_alignment_root / "primary.asm5.cs.paf.gz.tbi"

    @property
    def base_level_target_projection(self) -> Path:
        return self.dna_alignment_root / "primary.asm5.cs.target.tsv.gz"

    @property
    def base_level_target_index(self) -> Path:
        return self.dna_alignment_root / "primary.asm5.cs.target.tsv.gz.tbi"

    @property
    def gene_root(self) -> Path:
        return self.pair_root / "gene_collinearity"

    @property
    def gene_id_map(self) -> Path:
        return self.gene_root / "id_map.tsv"

    @property
    def gene_pairs(self) -> Path:
        return self.gene_root / "gene_pairs.tsv"

    @property
    def gene_blocks(self) -> Path:
        return self.gene_root / "blocks.tsv"

    @property
    def anchors(self) -> Path:
        return self.gene_root / "grcg6a_grcg7b.anchors"

    @property
    def gene_provenance(self) -> Path:
        return self.gene_root / "provenance.json"

    def _tool_status(self) -> dict[str, dict[str, Optional[str] | bool]]:
        tools = [
            "minimap2",
            "seqkit",
            "bgzip",
            "tabix",
            "blastp",
            "makeblastdb",
            "diamond",
            "jcvi",
            "python",
        ]
        status = {
            tool: {
                "available": shutil.which(tool) is not None,
                "path": shutil.which(tool),
                "source": "native" if shutil.which(tool) is not None else None,
            }
            for tool in tools
        }
        wsl_tools = self._wsl_blast_env_tool_paths(tools)
        for tool, path in wsl_tools.items():
            if path and not status[tool]["available"]:
                status[tool] = {"available": True, "path": path, "source": "Ubuntu blast_env"}
        return status

    def _wsl_executable(self) -> Optional[str]:
        found = shutil.which("wsl.exe") or shutil.which("wsl")
        if found:
            return found
        system_root = os.environ.get("SystemRoot", r"C:\Windows")
        candidates = [
            Path(system_root) / "System32" / "wsl.exe",
            Path(system_root) / "Sysnative" / "wsl.exe",
        ]
        for candidate in candidates:
            if candidate.exists():
                return str(candidate)
        return None

    def _wsl_blast_env_tool_paths(self, tools: list[str]) -> dict[str, str]:
        wsl = self._wsl_executable()
        if wsl is None:
            return {}
        script = "; ".join(
            [
                (
                    f"if [ -x /home/yml_092502/miniconda3/envs/blast_env/bin/{tool} ]; "
                    f"then echo {tool}=/home/yml_092502/miniconda3/envs/blast_env/bin/{tool}; "
                    f"elif command -v {tool} >/dev/null 2>&1; then echo {tool}=$(command -v {tool}); fi"
                )
                for tool in tools
            ]
        )
        try:
            result = subprocess.run(
                [wsl, "-d", "Ubuntu", "--", "bash", "-lc", script],
                capture_output=True,
                check=False,
                text=True,
                timeout=15,
            )
        except Exception:
            return {}
        paths: dict[str, str] = {}
        for line in result.stdout.splitlines():
            if "=" not in line:
                continue
            tool, path = line.split("=", 1)
            paths[tool] = path
        return paths

    def _assembly_files(self) -> dict:
        assemblies = {
            "GRCg6a": {
                "genome": self.project_root / "GCF_000002315.6_GRCg6a_genomic.chr.fna",
                "annotation": self.project_root / "GCF_000002315.6_GRCg6a_genomic.gff",
                "protein": self.project_root / "GCF_000002315.6_GRCg6a_protein.faa.gz",
                "cds": self.project_root / "GCF_000002315.6_GRCg6a_cds_from_genomic.fna.gz",
                "assembly_report": self.project_root / "GCF_000002315.6_GRCg6a_assembly_report.txt",
                "assembly_stats": self.project_root / "GCF_000002315.6_GRCg6a_assembly_stats.txt",
            },
            "GRCg7b": {
                "genome": self.project_root / "GCF_016699485.2_GRCg7b_main_chr.fna",
                "annotation": self.project_root / "GCF_016699485.2_GRCg7b_main_chr.gff.gz",
                "protein": self.project_root / "grcg7b" / "GCF_016699485.2_bGalGal1.mat.broiler.GRCg7b_protein.faa",
                "cds": self.project_root / "grcg7b" / "GCF_016699485.2_bGalGal1.mat.broiler.GRCg7b_cds_from_genomic.fna",
                "assembly_report": self.project_root / "grcg7b" / "GCF_016699485.2_bGalGal1.mat.broiler.GRCg7b_assembly_report.txt",
                "assembly_stats": self.project_root / "grcg7b" / "GCF_016699485.2_bGalGal1.mat.broiler.GRCg7b_assembly_stats.txt",
            },
        }
        return {
            name: {role: EvidenceFile.from_path(role, path).to_dict() for role, path in files.items()}
            for name, files in assemblies.items()
        }

    def get_status(self) -> dict:
        base_exists = self.base_level_paf.exists() or self.base_level_plain_paf.exists()
        query_index_exists = self.base_level_query_index.exists()
        target_index_exists = self.base_level_target_index.exists()
        gene_ready = self.gene_id_map.exists() and self.gene_pairs.exists() and self.gene_blocks.exists()

        if base_exists and query_index_exists and target_index_exists:
            base_status: EvidenceStatus = "available"
        elif base_exists:
            base_status = "not_indexed"
        else:
            base_status = "missing"

        return {
            "pair": {
                "assembly_1": "GRCg6a",
                "assembly_2": "GRCg7b",
                "species": "Gallus gallus",
                "comparison_id": "GRCg6a__GRCg7b",
            },
            "assemblies": self._assembly_files(),
            "layers": {
                "dna_natural_synteny": {
                    "status": "available" if self.primary_paf.exists() else "missing",
                    "role": "primary_visualization",
                    "files": [
                        EvidenceFile.from_path("primary_paf", self.primary_paf).to_dict(),
                        EvidenceFile.from_path("provenance", self.primary_provenance).to_dict(),
                    ],
                    "best_practice": "Use for whole-genome ribbons, dotplot, and region navigation.",
                },
                "base_level_alignment": {
                    "status": base_status,
                    "role": "local_block_details",
                    "files": [
                        EvidenceFile.from_path("cs_paf_gzip", self.base_level_paf).to_dict(),
                        EvidenceFile.from_path("cs_paf_plain", self.base_level_plain_paf).to_dict(),
                        EvidenceFile.from_path("query_tabix_index", self.base_level_query_index).to_dict(),
                        EvidenceFile.from_path("target_projection_gzip", self.base_level_target_projection).to_dict(),
                        EvidenceFile.from_path("target_tabix_index", self.base_level_target_index).to_dict(),
                    ],
                    "best_practice": (
                        "Do not stream the full cs PAF to the browser. Fetch only clicked-block "
                        "records by indexed region."
                    ),
                },
                "gene_collinearity": {
                    "status": "available" if gene_ready else "missing",
                    "role": "functional_gene_order_evidence",
                    "files": [
                        EvidenceFile.from_path("id_map", self.gene_id_map).to_dict(),
                        EvidenceFile.from_path("gene_pairs", self.gene_pairs).to_dict(),
                        EvidenceFile.from_path("blocks", self.gene_blocks).to_dict(),
                        EvidenceFile.from_path("anchors", self.anchors).to_dict(),
                        EvidenceFile.from_path("provenance", self.gene_provenance).to_dict(),
                    ],
                    "best_practice": (
                        "Use normalized GFF/protein IDs and an explicit anchor provenance. "
                        "Native JCVI/MCScanX anchors can replace or complement this layer later."
                    ),
                },
                "windowed_qc": {
                    "status": "available" if self.windowed_qc_paf.exists() else "missing",
                    "role": "qc_only_not_primary",
                    "files": [EvidenceFile.from_path("windowed_qc_paf", self.windowed_qc_paf).to_dict()],
                    "best_practice": "May be shown as QC/fallback only with an explicit warning.",
                },
            },
            "fallback_policy": {
                "natural_endpoint": "/comparative/paf/file?mode=natural",
                "fallback_allowed": True,
                "fallback_dataset": "windowed_qc",
                "ui_requirement": (
                    "If fallback is used, label it as Windowed QC fallback and disable high-confidence claims."
                ),
            },
            "recommended_pipeline": [
                "Prepare assembly registry with checksums and RefSeq aliases.",
                "Generate primary minimap2 asm5 PAF for interactive synteny.",
                "Generate --cs=long PAF, bgzip it, and tabix-index query and target projections.",
                "Normalize GFF/protein IDs, run BLASTP/DIAMOND, then JCVI/MCScanX anchors.",
                "Expose missing/available status per evidence layer in the UI.",
            ],
            "tool_status": self._tool_status(),
        }

    def _open_paf_text(self, path: Path):
        if path.suffix == ".gz":
            return gzip.open(path, "rt", encoding="utf-8", errors="replace")
        return path.open("r", encoding="utf-8", errors="replace")

    def _to_wsl_path(self, path: Path) -> str:
        path_text = str(path)
        if len(path_text) >= 3 and path_text[1:3] in {":\\", ":/"}:
            drive = path_text[0].lower()
            rest = path_text[3:].replace("\\", "/")
            return f"/mnt/{drive}/{rest}"
        return path_text.replace("\\", "/")

    def _tabix_seqid(self, side: CoordinateSide, chr_name: str) -> str:
        normalized = chr_name[3:] if chr_name.startswith("chr") else chr_name
        if side == "query":
            reverse = {value: key for key, value in GRCG6A_REFSEQ_TO_CHR.items()}
            return reverse.get(normalized, chr_name)
        if chr_name.startswith("chr"):
            return chr_name
        return f"chr{normalized}"

    def _extract_tabix_lines(
        self,
        *,
        path: Path,
        side: CoordinateSide,
        chr_name: str,
        start: int,
        end: int,
        limit: int,
    ) -> tuple[list[str], Optional[str]]:
        wsl = self._wsl_executable()
        if wsl is None:
            return [], "wsl.exe is not available for indexed tabix extraction."
        seqid = self._tabix_seqid(side, chr_name)
        region = f"{seqid}:{start + 1}-{end}"
        command = [
            wsl,
            "-d",
            "Ubuntu",
            "--",
            "tabix",
            self._to_wsl_path(path),
            region,
        ]
        lines: list[str] = []
        try:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except Exception as exc:
            return [], f"Could not start tabix: {exc}"

        assert process.stdout is not None
        reached_limit = False
        for line in process.stdout:
            if line.strip():
                lines.append(line.rstrip("\n"))
            if len(lines) >= limit:
                reached_limit = True
                process.kill()
                break
        stderr = process.stderr.read() if process.stderr is not None else ""
        return_code = process.wait()
        if reached_limit and lines:
            return lines, None
        if return_code not in {0, -9}:
            return [], stderr.strip() or f"tabix exited with status {return_code}"
        return lines, None

    def _record_from_paf_fields(self, fields: list[str], index: int) -> Optional[dict]:
        paf = parse_paf_line("\t".join(fields), index)
        if paf is None:
            return None
        tags = {
            field[:2]: field[5:]
            for field in fields[12:]
            if len(field) >= 5 and field[2:5] in {":Z:", ":i:", ":f:"}
        }
        row = paf.to_dict()
        row["has_cs"] = "cs" in tags
        row["has_cigar"] = "cg" in tags
        row["cs_preview"] = tags.get("cs", "")[:500]
        row["cigar_preview"] = tags.get("cg", "")[:500]
        return row

    def get_base_level_records(
        self,
        *,
        side: CoordinateSide = "query",
        chr_name: str,
        start: int,
        end: int,
        limit: int = 50,
    ) -> dict:
        """Return local base-level PAF records if the cs/cigar layer exists.

        This intentionally performs bounded local extraction. The production
        path should use tabix; when the file exists but no index is present,
        the response says so and uses a conservative scan limit.
        """
        path = self.base_level_paf if self.base_level_paf.exists() else self.base_level_plain_paf
        status = self.get_status()["layers"]["base_level_alignment"]["status"]
        query = {"side": side, "chr": chr_name, "start": start, "end": end, "limit": limit}
        if not path.exists():
            return {
                "status": "missing",
                "query": query,
                "records": [],
                "count": 0,
                "message": "Base-level --cs/-c PAF has not been generated yet.",
            }

        if status == "available":
            tabix_path = self.base_level_paf if side == "query" else self.base_level_target_projection
            lines, error = self._extract_tabix_lines(
                path=tabix_path,
                side=side,
                chr_name=chr_name,
                start=start,
                end=end,
                limit=limit,
            )
            if error is None:
                records: list[dict] = []
                for index, line in enumerate(lines):
                    fields = line.split("\t")
                    paf_fields = fields[3:] if side == "target" else fields
                    row = self._record_from_paf_fields(paf_fields, index)
                    if row is not None:
                        records.append(row)
                return {
                    "status": status,
                    "query": query,
                    "records": records,
                    "count": len(records),
                    "extraction": "tabix",
                    "message": "Base-level records extracted by indexed tabix region query.",
                }

        records: list[dict] = []
        scanned = 0
        with self._open_paf_text(path) as handle:
            for index, line in enumerate(handle):
                if not line.strip() or line.startswith("#"):
                    continue
                scanned += 1
                paf = parse_paf_line(line, index)
                if paf is None:
                    continue
                if side == "query":
                    record_chr = normalize_chr("GRCg6a", paf.query_name)
                    overlaps = record_chr == chr_name and paf.query_start < end and paf.query_end > start
                else:
                    record_chr = normalize_chr("GRCg7b", paf.target_name)
                    overlaps = record_chr == chr_name and paf.target_start < end and paf.target_end > start
                if not overlaps:
                    continue
                fields = line.rstrip("\n").split("\t")
                row = self._record_from_paf_fields(fields, index)
                if row is not None:
                    records.append(row)
                if len(records) >= limit:
                    break

        return {
            "status": status,
            "query": query,
            "records": records,
            "count": len(records),
            "scanned_records": scanned,
            "extraction": "bounded_scan",
            "message": (
                "Indexed extraction is preferred for production."
                if status == "not_indexed"
                else "Base-level records extracted for the requested region."
            ),
        }

    def _read_tsv_rows(self, path: Path, limit: int) -> list[dict]:
        if not path.exists():
            return []
        rows: list[dict] = []
        with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            for row in reader:
                rows.append(dict(row))
                if len(rows) >= limit:
                    break
        return rows

    def get_gene_collinearity(self, *, chr_name: Optional[str] = None, limit: int = 100) -> dict:
        status = self.get_status()["layers"]["gene_collinearity"]["status"]
        pairs = self._read_tsv_rows(self.gene_pairs, limit)
        blocks = self._read_tsv_rows(self.gene_blocks, limit)
        if chr_name:
            pairs = [row for row in pairs if row.get("chr_1") == chr_name or row.get("chr_2") == chr_name]
            blocks = [row for row in blocks if row.get("chr_1") == chr_name or row.get("chr_2") == chr_name]
        return {
            "status": status,
            "files": self.get_status()["layers"]["gene_collinearity"]["files"],
            "pairs": pairs,
            "blocks": blocks,
            "pair_count": len(pairs),
            "block_count": len(blocks),
            "message": (
                "Gene-level collinearity anchors are available."
                if status == "available"
                else "Gene-level collinearity has not been generated yet. Prepare ID maps, BLASTP/DIAMOND hits, and JCVI/MCScanX anchors."
            ),
        }
