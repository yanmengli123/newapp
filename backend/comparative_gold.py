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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional
import csv
import gzip
import hashlib
import html
import json
import os
import re
import shutil
import subprocess

from backend.comparative_paf import GRCG6A_REFSEQ_TO_CHR, normalize_chr, parse_paf_line, read_paf_records


EvidenceStatus = Literal["available", "missing", "not_indexed"]
CoordinateSide = Literal["query", "target"]


HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
SAFE_BLOCK_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]+$")


@dataclass(frozen=True)
class FigureSettings:
    width: int
    height: int
    dpi: int = 150
    forward_color: str = "#0f766e"
    reverse_color: str = "#b91c1c"
    low_confidence_color: str = "#d1d5db"
    background_color: str = "#ffffff"
    grid_color: str = "#d1d5db"
    text_color: str = "#111827"
    show_labels: bool = True
    label_density: Literal["all", "primary_only", "none"] = "primary_only"
    show_legend: bool = True
    show_title: bool = True
    title: Optional[str] = None
    subtitle: Optional[str] = None
    stroke_width: float = 1.7
    point_size: float = 1.8
    opacity: float = 0.75
    selected_block_id: Optional[str] = None
    selected_block_id_provided: bool = False
    show_gene_arrows: bool = True
    show_anchor_lines: bool = True

    @classmethod
    def from_payload(
        cls,
        payload: Optional[dict[str, Any] | "FigureSettings"],
        *,
        default_width: int,
        default_height: int,
    ) -> "FigureSettings":
        if isinstance(payload, FigureSettings):
            return payload
        data = payload or {}
        colors = data.get("colorScheme") if isinstance(data.get("colorScheme"), dict) else {}

        def clamp_int(name: str, default: int, minimum: int, maximum: int) -> int:
            if name not in data:
                return default
            try:
                value = int(float(data.get(name)))
            except (TypeError, ValueError):
                return default
            return max(minimum, min(maximum, value))

        def clamp_float(name: str, default: float, minimum: float, maximum: float) -> float:
            if name not in data:
                return default
            try:
                value = float(data.get(name))
            except (TypeError, ValueError):
                return default
            return max(minimum, min(maximum, value))

        def bool_value(name: str, default: bool) -> bool:
            value = data.get(name)
            return default if value is None else bool(value)

        def color_value(name: str, default: str) -> str:
            value = colors.get(name)
            return str(value) if isinstance(value, str) and HEX_COLOR_RE.match(value) else default

        def text_value(name: str) -> Optional[str]:
            value = data.get(name)
            if not isinstance(value, str):
                return None
            value = value.strip()
            return value[:160] if value else None

        label_density = data.get("labelDensity", "primary_only")
        if label_density not in {"all", "primary_only", "none"}:
            label_density = "primary_only"

        block_id_provided = "selectedBlockId" in data or "selected_block_id" in data
        block_id = data.get("selectedBlockId") or data.get("selected_block_id")
        if not isinstance(block_id, str) or not SAFE_BLOCK_ID_RE.match(block_id):
            block_id = None

        return cls(
            width=clamp_int("width", default_width, 800, 4000),
            height=clamp_int("height", default_height, 600, 3000),
            dpi=clamp_int("dpi", 150, 72, 600),
            forward_color=color_value("forward", "#0f766e"),
            reverse_color=color_value("reverse", "#b91c1c"),
            low_confidence_color=color_value("lowConfidence", "#d1d5db"),
            background_color=color_value("background", "#ffffff"),
            grid_color=color_value("grid", "#d1d5db"),
            text_color=color_value("text", "#111827"),
            show_labels=bool_value("showLabels", True),
            label_density=label_density,  # type: ignore[arg-type]
            show_legend=bool_value("showLegend", True),
            show_title=bool_value("showTitle", True),
            title=text_value("title"),
            subtitle=text_value("subtitle"),
            stroke_width=clamp_float("strokeWidth", 1.7, 0.5, 8.0),
            point_size=clamp_float("pointSize", 1.8, 0.5, 12.0),
            opacity=clamp_float("opacity", 0.75, 0.1, 1.0),
            selected_block_id=block_id,
            selected_block_id_provided=block_id_provided,
            show_gene_arrows=bool_value("showGeneArrows", True),
            show_anchor_lines=bool_value("showAnchorLines", True),
        )

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "width": self.width,
            "height": self.height,
            "dpi": self.dpi,
            "colorScheme": {
                "forward": self.forward_color,
                "reverse": self.reverse_color,
                "lowConfidence": self.low_confidence_color,
                "background": self.background_color,
                "grid": self.grid_color,
                "text": self.text_color,
            },
            "showLabels": self.show_labels,
            "labelDensity": self.label_density,
            "showLegend": self.show_legend,
            "showTitle": self.show_title,
            "title": self.title,
            "subtitle": self.subtitle,
            "strokeWidth": self.stroke_width,
            "pointSize": self.point_size,
            "opacity": self.opacity,
            "selectedBlockId": self.selected_block_id,
            "showGeneArrows": self.show_gene_arrows,
            "showAnchorLines": self.show_anchor_lines,
        }


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
    def simple_anchors(self) -> Path:
        return self.gene_root / "grcg6a_grcg7b.anchors.simple"

    @property
    def grcg6a_bed(self) -> Path:
        return self.gene_root / "GRCg6a.bed"

    @property
    def grcg7b_bed(self) -> Path:
        return self.gene_root / "GRCg7b.bed"

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

    def _native_tabix_available(self) -> bool:
        try:
            import pysam  # noqa: F401
        except Exception:
            return False
        return True

    def _tool_version(self, command: list[str], timeout: int = 10) -> Optional[str]:
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                check=False,
                text=True,
                timeout=timeout,
            )
        except Exception:
            return None
        text = (result.stdout or result.stderr).strip()
        if not text:
            return None
        return text.splitlines()[0].strip()

    def _file_sha256(self, path: Path, max_bytes: Optional[int] = None) -> Optional[str]:
        if not path.exists() or not path.is_file():
            return None
        digest = hashlib.sha256()
        remaining = max_bytes
        with path.open("rb") as handle:
            while True:
                size = 1024 * 1024 if remaining is None else min(1024 * 1024, remaining)
                if size <= 0:
                    break
                chunk = handle.read(size)
                if not chunk:
                    break
                digest.update(chunk)
                if remaining is not None:
                    remaining -= len(chunk)
        return digest.hexdigest()

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
                    "preferred_extraction": "native-tabix" if self._native_tabix_available() else "wsl-tabix-fallback",
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
            },
            "fallback_policy": {
                "natural_endpoint": "/comparative/paf/file?mode=natural",
                "fallback_allowed": False,
                "fallback_dataset": None,
                "ui_requirement": (
                    "Natural-breakpoint PAF is required for synteny display. Missing primary evidence must be reported, not replaced."
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

    def _extract_tabix_lines_native(
        self,
        *,
        path: Path,
        side: CoordinateSide,
        chr_name: str,
        start: int,
        end: int,
        limit: int,
    ) -> tuple[list[str], Optional[str], str]:
        try:
            import pysam
        except Exception as exc:
            return [], f"pysam is not available for native tabix extraction: {exc}", "native-tabix-unavailable"

        seqid = self._tabix_seqid(side, chr_name)
        lines: list[str] = []
        try:
            with pysam.TabixFile(str(path)) as tabix_file:
                for line in tabix_file.fetch(seqid, start, end):
                    if line.strip():
                        lines.append(line.rstrip("\n"))
                    if len(lines) >= limit:
                        break
        except ValueError as exc:
            return [], f"native tabix could not find {seqid}: {exc}", "native-tabix"
        except Exception as exc:
            return [], f"native tabix failed: {exc}", "native-tabix"
        return lines, None, "native-tabix"

    def _extract_tabix_lines_wsl(
        self,
        *,
        path: Path,
        side: CoordinateSide,
        chr_name: str,
        start: int,
        end: int,
        limit: int,
    ) -> tuple[list[str], Optional[str], str]:
        wsl = self._wsl_executable()
        if wsl is None:
            return [], "wsl.exe is not available for indexed tabix extraction.", "wsl-tabix-unavailable"
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
            return [], f"Could not start tabix: {exc}", "wsl-tabix"

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
            return lines, None, "wsl-tabix"
        if return_code not in {0, -9}:
            return [], stderr.strip() or f"tabix exited with status {return_code}", "wsl-tabix"
        return lines, None, "wsl-tabix"

    def _extract_tabix_lines(
        self,
        *,
        path: Path,
        side: CoordinateSide,
        chr_name: str,
        start: int,
        end: int,
        limit: int,
    ) -> tuple[list[str], Optional[str], str]:
        lines, error, backend = self._extract_tabix_lines_native(
            path=path,
            side=side,
            chr_name=chr_name,
            start=start,
            end=end,
            limit=limit,
        )
        if error is None:
            return lines, None, backend
        wsl_lines, wsl_error, wsl_backend = self._extract_tabix_lines_wsl(
            path=path,
            side=side,
            chr_name=chr_name,
            start=start,
            end=end,
            limit=limit,
        )
        if wsl_error is None:
            return wsl_lines, None, wsl_backend
        return [], f"{error}; {wsl_error}", wsl_backend

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
            lines, error, extraction = self._extract_tabix_lines(
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
                    "extraction": extraction,
                    "message": f"Base-level records extracted by indexed {extraction} region query.",
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

    def _read_primary_provenance(self) -> dict[str, Any]:
        if not self.primary_provenance.exists():
            return {}
        try:
            return json.loads(self.primary_provenance.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError:
            return {"error": "Primary natural PAF provenance JSON could not be parsed."}

    def get_citation_text(self) -> dict:
        provenance = self._read_primary_provenance()
        if not self.primary_paf.exists():
            return {
                "status": "missing",
                "methods_text": "Primary natural-breakpoint PAF is missing; this comparison is not ready for citation.",
                "provenance": provenance,
            }
        filters = provenance.get("default_display_filters") if isinstance(provenance.get("default_display_filters"), dict) else {}
        tool_versions = provenance.get("tool_versions") if isinstance(provenance.get("tool_versions"), dict) else {}
        minimap2_version = tool_versions.get("minimap2") or provenance.get("tool_version") or "version not recorded"
        preset = provenance.get("preset") or "asm5"
        mapq = filters.get("mapping_quality_min", 30)
        identity = filters.get("identity_min_percent", 85)
        min_len = filters.get("alignment_length_min_bp", 50_000)
        secondary = provenance.get("secondary_alignments") or "disabled"
        generated = provenance.get("generated_at") or datetime.now(timezone.utc).isoformat()
        paf_sha = provenance.get("output_paf_sha256") or self._file_sha256(self.primary_paf, max_bytes=64 * 1024 * 1024)
        methods_text = (
            "Whole-genome synteny between GRCg6a and GRCg7b was generated from a primary "
            f"natural-breakpoint PAF using minimap2 {minimap2_version} with the {preset} preset; "
            f"secondary alignments {secondary}. Displayed blocks were filtered with mapQ >= {mapq}, "
            f"identity >= {identity}%, and alignment length >= {min_len} bp. "
            "Coordinates are stored as PAF 0-based half-open intervals and displayed as genomic intervals. "
            f"The citation text was rendered at {generated}."
        )
        if paf_sha:
            methods_text += f" Primary PAF SHA256: {paf_sha}."
        return {
            "status": "available",
            "methods_text": methods_text,
            "provenance": provenance,
            "filters": {
                "mapq_min": mapq,
                "identity_min_percent": identity,
                "alignment_length_min_bp": min_len,
                "secondary_alignments": secondary,
            },
        }

    def get_sv_candidates(
        self,
        *,
        min_gap_bp: int = 100_000,
        min_mapq: int = 30,
        min_identity: float = 85.0,
        min_alignment_length: int = 50_000,
        limit: int = 500,
    ) -> dict:
        if not self.primary_paf.exists():
            return {
                "status": "missing",
                "classification": "candidate-only",
                "candidates": [],
                "counts": {},
                "message": "Primary natural-breakpoint PAF is missing; SV candidates cannot be estimated.",
            }
        records = [
            record
            for record in read_paf_records(self.primary_paf, limit=None, order="coordinate")
            if record.mapping_quality >= min_mapq
            and record.identity >= min_identity
            and record.alignment_length >= min_alignment_length
        ]
        candidates: list[dict[str, Any]] = []
        for record in records:
            if record.strand == "-":
                candidates.append(
                    {
                        "candidate_id": f"SVINV_{len(candidates) + 1:05d}",
                        "type": "inversion_orientation",
                        "evidence_level": "candidate",
                        "chr_1": record.chr_1,
                        "start_1": record.start_1,
                        "end_1": record.end_1,
                        "chr_2": record.chr_2,
                        "start_2": record.start_2,
                        "end_2": record.end_2,
                        "strand": record.strand,
                        "support": "single reverse-strand natural PAF block; requires breakpoint/flanking validation",
                        "block_id": record.block_id,
                    }
                )

        by_pair: dict[tuple[str, str], list[Any]] = {}
        for record in records:
            by_pair.setdefault((record.chr_1, record.chr_2), []).append(record)
        for (chr_1, chr_2), group in by_pair.items():
            ordered = sorted(group, key=lambda item: (item.start_1, item.start_2))
            for left, right in zip(ordered, ordered[1:]):
                q_gap = max(0, right.start_1 - left.end_1)
                t_gap = max(0, right.start_2 - left.end_2)
                gap_delta = abs(q_gap - t_gap)
                if q_gap >= min_gap_bp or t_gap >= min_gap_bp or gap_delta >= min_gap_bp:
                    candidates.append(
                        {
                            "candidate_id": f"SVGAP_{len(candidates) + 1:05d}",
                            "type": "large_gap",
                            "evidence_level": "candidate",
                            "chr_1": chr_1,
                            "start_1": left.end_1,
                            "end_1": right.start_1,
                            "chr_2": chr_2,
                            "start_2": left.end_2,
                            "end_2": right.start_2,
                            "query_gap_bp": q_gap,
                            "target_gap_bp": t_gap,
                            "gap_delta_bp": gap_delta,
                            "support": "gap between adjacent natural PAF blocks; not a validated SV call",
                            "left_block_id": left.block_id,
                            "right_block_id": right.block_id,
                        }
                    )
                if len(candidates) >= limit:
                    break
            if len(candidates) >= limit:
                break

        counts: dict[str, int] = {}
        for candidate in candidates:
            counts[candidate["type"]] = counts.get(candidate["type"], 0) + 1
        return {
            "status": "available",
            "classification": "candidate-only",
            "min_gap_bp": min_gap_bp,
            "candidate_count": len(candidates[:limit]),
            "counts": counts,
            "candidates": candidates[:limit],
            "filters": {
                "mapq_min": min_mapq,
                "identity_min_percent": min_identity,
                "alignment_length_min_bp": min_alignment_length,
            },
            "message": "SV candidates are exploratory evidence from PAF structure, not validated structural variant calls.",
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

    def _read_gene_pairs(self, *, block_id: Optional[str] = None, limit: int = 20000) -> list[dict]:
        if not block_id:
            return self._read_tsv_rows(self.gene_pairs, limit)
        if not self.gene_pairs.exists():
            return []
        rows: list[dict] = []
        with self.gene_pairs.open("r", encoding="utf-8", errors="replace", newline="") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            for row in reader:
                if row.get("block_id") != block_id:
                    continue
                rows.append(dict(row))
                if len(rows) >= limit:
                    break
        return rows

    def _read_gene_blocks(self, limit: int = 5000) -> list[dict]:
        return self._read_tsv_rows(self.gene_blocks, limit)

    def _float(self, value: object, default: float = 0.0) -> float:
        try:
            return float(value) if value not in {None, ""} else default
        except (TypeError, ValueError):
            return default

    def _int(self, value: object, default: int = 0) -> int:
        try:
            return int(float(value)) if value not in {None, ""} else default
        except (TypeError, ValueError):
            return default

    def _chr_sort_key(self, chr_name: str) -> tuple[int, str]:
        normalized = chr_name[3:] if chr_name.startswith("chr") else chr_name
        if normalized.isdigit():
            return (int(normalized), normalized)
        special = {"W": 40, "Z": 41, "MT": 42, "M": 42}
        return (special.get(normalized, 99), normalized)

    def _build_offsets(self, lengths: dict[str, int]) -> tuple[dict[str, int], int, list[str]]:
        ordered = sorted(lengths, key=self._chr_sort_key)
        offsets: dict[str, int] = {}
        cursor = 0
        for chr_name in ordered:
            offsets[chr_name] = cursor
            cursor += max(1, lengths[chr_name])
        return offsets, max(1, cursor), ordered

    def _figure_provenance(self, figure_id: str, settings: FigureSettings) -> str:
        payload = {
            "assembly_1": "GRCg6a",
            "assembly_2": "GRCg7b",
            "species": "Gallus gallus",
            "figure_id": figure_id,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source_files": {
                "dna_natural_paf": str(self.primary_paf),
                "gene_pairs": str(self.gene_pairs),
                "gene_blocks": str(self.gene_blocks),
                "anchors": str(self.anchors),
            },
            "filters": {
                "mapQ": ">=30",
                "identity": ">=85%",
                "min_alignment_length": ">=50000",
            },
            "settings": settings.to_public_dict(),
        }
        return json.dumps(payload, ensure_ascii=False, sort_keys=True)

    def _svg_shell(
        self,
        *,
        figure_id: str,
        title: str,
        subtitle: str,
        settings: FigureSettings,
        body: str,
    ) -> str:
        width = settings.width
        height = settings.height
        title_text = settings.title or title
        subtitle_text = settings.subtitle if settings.subtitle is not None else subtitle
        metadata = html.escape(self._figure_provenance(figure_id, settings), quote=False)
        title_markup = ""
        if settings.show_title:
            title_markup = (
                f'<text x="32" y="36" class="title">{html.escape(title_text)}</text>'
                f'<text x="32" y="58" class="subtitle">{html.escape(subtitle_text)}</text>'
            )
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(title_text)}">'
            f"<metadata>{metadata}</metadata>"
            "<style>"
            f".title{{font:700 24px Arial,sans-serif;fill:{settings.text_color}}}"
            f".subtitle{{font:13px Arial,sans-serif;fill:{settings.text_color};opacity:.78}}"
            f".label{{font:11px Arial,sans-serif;fill:{settings.text_color};opacity:.82}}"
            f".small{{font:10px Arial,sans-serif;fill:{settings.text_color};opacity:.68}}"
            ".axis{stroke:#111827;stroke-width:1}"
            f".grid{{stroke:{settings.grid_color};stroke-width:.7}}"
            f".plus{{stroke:{settings.forward_color};fill:{settings.forward_color}}}"
            f".minus{{stroke:{settings.reverse_color};fill:{settings.reverse_color}}}"
            f".ribbonPlus{{fill:{settings.forward_color};fill-opacity:{settings.opacity * 0.32:.3f};stroke:{settings.forward_color};stroke-opacity:{settings.opacity * 0.75:.3f}}}"
            f".ribbonMinus{{fill:{settings.reverse_color};fill-opacity:{settings.opacity * 0.30:.3f};stroke:{settings.reverse_color};stroke-opacity:{settings.opacity * 0.75:.3f}}}"
            f".gene{{fill:{settings.forward_color};stroke:{settings.forward_color}}}"
            f".gene2{{fill:{settings.reverse_color};stroke:{settings.reverse_color}}}"
            f".link{{stroke:{settings.low_confidence_color};stroke-width:{max(0.5, settings.stroke_width * 0.65):.2f};stroke-opacity:{settings.opacity * 0.62:.3f}}}"
            f".anchor-link{{stroke-linecap:round}}"
            f".gene-label{{font:10px Arial,sans-serif;fill:{settings.text_color};stroke:#fff;stroke-width:3px;paint-order:stroke;stroke-linejoin:round;opacity:.88}}"
            f".gene-label-tier1{{font-weight:700}}"
            f".gene-label-tier2{{font-weight:600;opacity:.78}}"
            "</style>"
            f'<rect width="100%" height="100%" fill="{settings.background_color}"/>'
            f"{title_markup}"
            f"{body}</svg>"
        )

    def _empty_figure(
        self,
        title: str,
        message: str,
        *,
        settings: Optional[FigureSettings] = None,
        figure_id: str = "empty",
    ) -> str:
        settings = settings or FigureSettings.from_payload(None, default_width=960, default_height=560)
        rect_w = max(120, settings.width - 64)
        rect_h = max(120, settings.height - 140)
        center_x = settings.width / 2
        center_y = 88 + rect_h / 2
        body = (
            f'<rect x="32" y="88" width="{rect_w}" height="{rect_h}" rx="4" fill="#f9fafb" stroke="{settings.grid_color}"/>'
            f'<text x="{center_x:.2f}" y="{center_y:.2f}" text-anchor="middle" class="subtitle">{html.escape(message)}</text>'
        )
        return self._svg_shell(
            figure_id=figure_id,
            title=title,
            subtitle="GRCg6a vs GRCg7b",
            settings=settings,
            body=body,
        )

    def _read_primary_paf_records(self, limit: int = 5000):
        if not self.primary_paf.exists():
            return []
        return read_paf_records(
            self.primary_paf,
            min_mapq=30,
            min_identity=85.0,
            min_alignment_length=50_000,
            limit=limit,
            order="coordinate",
        )

    def _should_label_chr(self, chr_name: str, settings: FigureSettings) -> bool:
        if not settings.show_labels or settings.label_density == "none":
            return False
        if settings.label_density == "all":
            return True
        normalized = chr_name[3:] if chr_name.startswith("chr") else chr_name
        return normalized in {"1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "W", "Z", "MT"}

    def _render_dna_dotplot_svg(self, settings: Optional[dict[str, Any] | FigureSettings] = None) -> str:
        settings = FigureSettings.from_payload(settings, default_width=960, default_height=560)
        records = self._read_primary_paf_records()
        if not records:
            return self._empty_figure(
                "DNA Whole-genome Dotplot",
                "Natural-breakpoint PAF is missing.",
                settings=settings,
                figure_id="dna-dotplot",
            )

        q_lengths: dict[str, int] = {}
        t_lengths: dict[str, int] = {}
        for record in records:
            q_lengths[record.chr_1] = max(q_lengths.get(record.chr_1, 0), record.query_length)
            t_lengths[record.chr_2] = max(t_lengths.get(record.chr_2, 0), record.target_length)
        q_offsets, q_total, q_order = self._build_offsets(q_lengths)
        t_offsets, t_total, t_order = self._build_offsets(t_lengths)
        left = max(82, int(settings.width * 0.085))
        top = 92 if settings.show_title else 46
        plot_w = max(220, settings.width - left - 78)
        plot_h = max(180, settings.height - top - 78)
        caption_y = 74 if settings.show_title else 30

        def x(chr_name: str, pos: int) -> float:
            return left + ((q_offsets.get(chr_name, 0) + pos) / q_total) * plot_w

        def y(chr_name: str, pos: int) -> float:
            return top + plot_h - ((t_offsets.get(chr_name, 0) + pos) / t_total) * plot_h

        parts = [
            f'<rect x="{left}" y="{top}" width="{plot_w}" height="{plot_h}" fill="#f9fafb" stroke="#111827"/>',
        ]
        for chr_name in q_order:
            gx = x(chr_name, 0)
            parts.append(f'<line x1="{gx:.2f}" y1="{top}" x2="{gx:.2f}" y2="{top + plot_h}" class="grid"/>')
            if self._should_label_chr(chr_name, settings):
                parts.append(f'<text x="{gx + 3:.2f}" y="{top + plot_h + 14}" class="small">{html.escape(chr_name)}</text>')
        for chr_name in t_order:
            gy = y(chr_name, 0)
            parts.append(f'<line x1="{left}" y1="{gy:.2f}" x2="{left + plot_w}" y2="{gy:.2f}" class="grid"/>')
            if self._should_label_chr(chr_name, settings):
                parts.append(f'<text x="{left - 8}" y="{gy + 3:.2f}" text-anchor="end" class="small">{html.escape(chr_name)}</text>')
        for record in records:
            cls = "minus" if record.strand == "-" else "plus"
            parts.append(
                f'<line x1="{x(record.chr_1, record.start_1):.2f}" '
                f'y1="{y(record.chr_2, record.start_2):.2f}" '
                f'x2="{x(record.chr_1, record.end_1):.2f}" '
                f'y2="{y(record.chr_2, record.end_2):.2f}" '
                f'class="{cls}" stroke-width="{settings.stroke_width}" stroke-opacity="{settings.opacity}"/>'
            )
        if settings.show_labels:
            parts.extend(
                [
                    f'<text x="{left + plot_w / 2}" y="{settings.height - 24}" text-anchor="middle" class="label">GRCg6a cumulative genomic coordinate</text>',
                    f'<text x="22" y="{top + plot_h / 2}" transform="rotate(-90 22 {top + plot_h / 2})" text-anchor="middle" class="label">GRCg7b cumulative genomic coordinate</text>',
                ]
            )
        if settings.show_legend:
            parts.extend(
                [
                    f'<line x1="{settings.width - 190}" y1="{caption_y}" x2="{settings.width - 154}" y2="{caption_y}" class="plus" stroke-width="{settings.stroke_width}"/>',
                    f'<text x="{settings.width - 148}" y="{caption_y + 4}" class="small">forward</text>',
                    f'<line x1="{settings.width - 96}" y1="{caption_y}" x2="{settings.width - 60}" y2="{caption_y}" class="minus" stroke-width="{settings.stroke_width}"/>',
                    f'<text x="{settings.width - 54}" y="{caption_y + 4}" class="small">reverse</text>',
                ]
            )
        parts.append(
            f'<text x="{left}" y="{caption_y}" class="small">Blocks: {len(records)}; source=minimap2 asm5 natural PAF</text>'
        )
        return self._svg_shell(
            figure_id="dna-dotplot",
            title="DNA Whole-genome Dotplot",
            subtitle="Natural-breakpoint whole-genome alignment; DNA-level evidence.",
            settings=settings,
            body="".join(parts),
        )

    def _render_gene_dotplot_svg(self, settings: Optional[dict[str, Any] | FigureSettings] = None) -> str:
        settings = FigureSettings.from_payload(settings, default_width=960, default_height=560)
        pairs = self._read_gene_pairs(limit=50000)
        if not pairs:
            return self._empty_figure(
                "Gene Collinearity Dotplot",
                "Gene anchor pairs are missing.",
                settings=settings,
                figure_id="gene-collinearity-dotplot",
            )
        q_lengths: dict[str, int] = {}
        t_lengths: dict[str, int] = {}
        for row in pairs:
            q_chr = str(row.get("chr_1", ""))
            t_chr = str(row.get("chr_2", ""))
            q_lengths[q_chr] = max(q_lengths.get(q_chr, 0), self._int(row.get("end_1")))
            t_lengths[t_chr] = max(t_lengths.get(t_chr, 0), self._int(row.get("end_2")))
        q_offsets, q_total, q_order = self._build_offsets(q_lengths)
        t_offsets, t_total, t_order = self._build_offsets(t_lengths)
        left = max(82, int(settings.width * 0.085))
        top = 92 if settings.show_title else 46
        plot_w = max(220, settings.width - left - 78)
        plot_h = max(180, settings.height - top - 78)
        caption_y = 74 if settings.show_title else 30

        def x(row: dict) -> float:
            return left + ((q_offsets.get(str(row.get("chr_1", "")), 0) + self._int(row.get("start_1"))) / q_total) * plot_w

        def y(row: dict) -> float:
            return top + plot_h - ((t_offsets.get(str(row.get("chr_2", "")), 0) + self._int(row.get("start_2"))) / t_total) * plot_h

        parts = [f'<rect x="{left}" y="{top}" width="{plot_w}" height="{plot_h}" fill="#f9fafb" stroke="#111827"/>']
        for chr_name in q_order:
            gx = left + (q_offsets[chr_name] / q_total) * plot_w
            parts.append(f'<line x1="{gx:.2f}" y1="{top}" x2="{gx:.2f}" y2="{top + plot_h}" class="grid"/>')
            if self._should_label_chr(chr_name, settings):
                parts.append(f'<text x="{gx + 3:.2f}" y="{top + plot_h + 14}" class="small">{html.escape(chr_name)}</text>')
        for chr_name in t_order:
            gy = top + plot_h - (t_offsets[chr_name] / t_total) * plot_h
            parts.append(f'<line x1="{left}" y1="{gy:.2f}" x2="{left + plot_w}" y2="{gy:.2f}" class="grid"/>')
            if self._should_label_chr(chr_name, settings):
                parts.append(f'<text x="{left - 8}" y="{gy + 3:.2f}" text-anchor="end" class="small">{html.escape(chr_name)}</text>')
        for row in pairs:
            cls = "minus" if row.get("orientation") == "-" else "plus"
            radius = settings.point_size if self._float(row.get("pident")) >= 95 else max(0.5, settings.point_size * 0.7)
            parts.append(f'<circle cx="{x(row):.2f}" cy="{y(row):.2f}" r="{radius:.2f}" class="{cls}" opacity="{settings.opacity}"/>')
        method = pairs[0].get("method", "gene-anchor collinearity")
        if settings.show_labels:
            parts.extend(
                [
                    f'<text x="{left + plot_w / 2}" y="{settings.height - 24}" text-anchor="middle" class="label">GRCg6a gene order coordinate</text>',
                    f'<text x="22" y="{top + plot_h / 2}" transform="rotate(-90 22 {top + plot_h / 2})" text-anchor="middle" class="label">GRCg7b gene order coordinate</text>',
                ]
            )
        if settings.show_legend:
            parts.extend(
                [
                    f'<circle cx="{settings.width - 180}" cy="{caption_y - 2}" r="{settings.point_size:.2f}" class="plus" opacity="{settings.opacity}"/>',
                    f'<text x="{settings.width - 168}" y="{caption_y + 2}" class="small">same orientation</text>',
                    f'<circle cx="{settings.width - 66}" cy="{caption_y - 2}" r="{settings.point_size:.2f}" class="minus" opacity="{settings.opacity}"/>',
                    f'<text x="{settings.width - 54}" y="{caption_y + 2}" class="small">inverted</text>',
                ]
            )
        parts.append(
            f'<text x="{left}" y="{caption_y}" class="small">Anchor pairs: {len(pairs)}; method={html.escape(str(method))}</text>'
        )
        return self._svg_shell(
            figure_id="gene-collinearity-dotplot",
            title="Gene Collinearity Dotplot",
            subtitle="Gene-level conserved order from anchor pairs; distinct from DNA PAF.",
            settings=settings,
            body="".join(parts),
        )

    def _render_karyotype_svg(self, settings: Optional[dict[str, Any] | FigureSettings] = None) -> str:
        settings = FigureSettings.from_payload(settings, default_width=960, default_height=500)
        blocks = self._read_gene_blocks()
        if not blocks:
            return self._empty_figure(
                "Karyotype Ribbon Overview",
                "Collinearity blocks are missing.",
                settings=settings,
                figure_id="karyotype-ribbons",
            )
        q_lengths: dict[str, int] = {}
        t_lengths: dict[str, int] = {}
        for row in blocks:
            q_chr = str(row.get("chr_1", ""))
            t_chr = str(row.get("chr_2", ""))
            q_lengths[q_chr] = max(q_lengths.get(q_chr, 0), self._int(row.get("end_1")))
            t_lengths[t_chr] = max(t_lengths.get(t_chr, 0), self._int(row.get("end_2")))
        q_offsets, q_total, q_order = self._build_offsets(q_lengths)
        t_offsets, t_total, t_order = self._build_offsets(t_lengths)
        left = max(72, int(settings.width * 0.075))
        width = max(240, settings.width - left - 68)
        top_y = 150 if settings.show_title else 100
        bottom_y = max(top_y + 160, settings.height - 120)
        caption_y = 74 if settings.show_title else 34

        def sx(offsets: dict[str, int], total: int, chr_name: str, pos: int) -> float:
            return left + ((offsets.get(chr_name, 0) + pos) / total) * width

        parts = [
        ]
        if settings.show_labels:
            parts.extend(
                [
                    f'<text x="{left}" y="{top_y - 34}" class="label">GRCg6a</text>',
                    f'<text x="{left}" y="{bottom_y + 50}" class="label">GRCg7b</text>',
                ]
            )
        for chr_name in q_order:
            x1 = sx(q_offsets, q_total, chr_name, 0)
            x2 = sx(q_offsets, q_total, chr_name, q_lengths[chr_name])
            parts.append(f'<rect x="{x1:.2f}" y="{top_y}" width="{max(1, x2 - x1):.2f}" height="14" fill="#e5e7eb" stroke="#9ca3af"/>')
            if self._should_label_chr(chr_name, settings):
                parts.append(f'<text x="{(x1 + x2) / 2:.2f}" y="{top_y - 8}" text-anchor="middle" class="small">{html.escape(chr_name)}</text>')
        for chr_name in t_order:
            x1 = sx(t_offsets, t_total, chr_name, 0)
            x2 = sx(t_offsets, t_total, chr_name, t_lengths[chr_name])
            parts.append(f'<rect x="{x1:.2f}" y="{bottom_y}" width="{max(1, x2 - x1):.2f}" height="14" fill="#e5e7eb" stroke="#9ca3af"/>')
            if self._should_label_chr(chr_name, settings):
                parts.append(f'<text x="{(x1 + x2) / 2:.2f}" y="{bottom_y + 34}" text-anchor="middle" class="small">{html.escape(chr_name)}</text>')
        for row in blocks[:300]:
            q_chr = str(row.get("chr_1", ""))
            t_chr = str(row.get("chr_2", ""))
            q1 = sx(q_offsets, q_total, q_chr, self._int(row.get("start_1")))
            q2 = sx(q_offsets, q_total, q_chr, self._int(row.get("end_1")))
            t1 = sx(t_offsets, t_total, t_chr, self._int(row.get("start_2")))
            t2 = sx(t_offsets, t_total, t_chr, self._int(row.get("end_2")))
            cls = "ribbonMinus" if row.get("orientation") == "-" else "ribbonPlus"
            parts.append(
                f'<path d="M {q1:.2f} {top_y + 14} C {q1:.2f} 240 {t1:.2f} 290 {t1:.2f} {bottom_y} '
                f'L {t2:.2f} {bottom_y} C {t2:.2f} 290 {q2:.2f} 240 {q2:.2f} {top_y + 14} Z" class="{cls}"/>'
            )
        parts.append(
            f'<text x="{left}" y="{caption_y}" class="small">Collinear blocks: {len(blocks)}; ribbon width follows block span; method={html.escape(str(blocks[0].get("method", "")))}</text>'
        )
        if settings.show_legend:
            parts.extend(
                [
                    f'<rect x="{settings.width - 190}" y="{caption_y - 10}" width="34" height="10" class="ribbonPlus"/>',
                    f'<text x="{settings.width - 150}" y="{caption_y}" class="small">forward</text>',
                    f'<rect x="{settings.width - 96}" y="{caption_y - 10}" width="34" height="10" class="ribbonMinus"/>',
                    f'<text x="{settings.width - 56}" y="{caption_y}" class="small">reverse</text>',
                ]
            )
        return self._svg_shell(
            figure_id="karyotype-ribbons",
            title="Karyotype Ribbon Overview",
            subtitle="Chromosome-scale gene collinearity blocks for publication overview.",
            settings=settings,
            body="".join(parts),
        )

    def _render_micro_synteny_svg(
        self,
        block_id: Optional[str] = None,
        settings: Optional[dict[str, Any] | FigureSettings] = None,
    ) -> str:
        settings = FigureSettings.from_payload(settings, default_width=1200, default_height=720)
        if settings.selected_block_id or settings.selected_block_id_provided:
            block_id = settings.selected_block_id
        if block_id and not SAFE_BLOCK_ID_RE.match(block_id):
            block_id = None
        blocks = self._read_gene_blocks()
        if not block_id and blocks and not settings.selected_block_id_provided:
            block_id = str(blocks[0].get("block_id", ""))
        pairs = self._read_gene_pairs(block_id=block_id, limit=20000) if block_id else []
        if not pairs:
            return self._empty_figure(
                "Micro-synteny",
                "No anchor pairs are available for the selected block.",
                settings=settings,
                figure_id="micro-synteny",
            )

        q_min = min(self._int(row.get("start_1")) for row in pairs)
        q_max = max(self._int(row.get("end_1")) for row in pairs)
        t_min = min(self._int(row.get("start_2")) for row in pairs)
        t_max = max(self._int(row.get("end_2")) for row in pairs)
        left = max(96, int(settings.width * 0.09))
        width = max(240, settings.width - left - max(96, int(settings.width * 0.08)))
        anchor_count = len(pairs)
        px_per_anchor = width / max(1, anchor_count)
        if not settings.show_labels or settings.label_density == "none":
            label_mode = "none"
        elif settings.label_density == "all":
            label_mode = "normal" if px_per_anchor >= 45 else "compact"
        elif anchor_count >= 50 or px_per_anchor < 18:
            label_mode = "overview-landmark"
        elif anchor_count >= 20 or px_per_anchor < 45:
            label_mode = "compact"
        else:
            label_mode = "normal"
        max_lanes = 4 if label_mode == "normal" else 3
        q_y = max(170 if settings.show_title else 118, int(settings.height * 0.34))
        label_top_padding = max_lanes * 18 + 22 if label_mode in {"normal", "compact", "overview-landmark"} else 22
        caption_y = 74 if settings.show_title else 34
        q_y = max(q_y, caption_y + label_top_padding + 34)
        t_y = max(q_y + 150, settings.height - 150)
        caption_y = 74 if settings.show_title else 34

        def sx(value: int, start: int, end: int) -> float:
            span = max(1, end - start)
            return left + ((value - start) / span) * width

        def arrow(x1: float, x2: float, y: int, strand: str, cls: str, title: str = "") -> str:
            if x2 < x1:
                x1, x2 = x2, x1
            head = min(10, max(4, (x2 - x1) / 3))
            if strand == "-":
                points = f"{x1:.2f},{y} {x1 + head:.2f},{y - 8} {x2:.2f},{y - 8} {x2:.2f},{y + 8} {x1 + head:.2f},{y + 8}"
            else:
                points = f"{x1:.2f},{y - 8} {x2 - head:.2f},{y - 8} {x2:.2f},{y} {x2 - head:.2f},{y + 8} {x1:.2f},{y + 8}"
            title_markup = f"<title>{html.escape(title)}</title>" if title else ""
            return f'<polygon points="{points}" class="{cls}" opacity="{settings.opacity}">{title_markup}</polygon>'

        def gene_title(row: dict, assembly: str) -> str:
            if assembly == "GRCg6a":
                gene = row.get("gene_1") or ""
                symbol = row.get("gene_symbol_1") or ""
                chr_name = row.get("chr_1") or ""
                start = self._int(row.get("start_1"))
                end = self._int(row.get("end_1"))
                strand = row.get("strand_1") or "+"
            else:
                gene = row.get("gene_2") or ""
                symbol = row.get("gene_symbol_2") or ""
                chr_name = row.get("chr_2") or ""
                start = self._int(row.get("start_2"))
                end = self._int(row.get("end_2"))
                strand = row.get("strand_2") or "+"
            symbol_text = f"; symbol={symbol}" if symbol else ""
            return f"{assembly} {chr_name}:{start}-{end} ({strand}); gene={gene}{symbol_text}"

        def anchor_title(row: dict) -> str:
            return (
                f"{row.get('pair_id', '')}: {row.get('gene_1', '')} -> {row.get('gene_2', '')}; "
                f"pident={row.get('pident', '')}; qcovs={row.get('qcovs', '')}; "
                f"bitscore={row.get('bitscore', '')}; method={row.get('method', '')}"
            )

        def label_tier(row: dict, index: int) -> int:
            symbol = str(row.get("gene_symbol_1") or "").strip()
            gene_id = str(row.get("gene_1") or "").strip()
            if index in {0, len(pairs) - 1}:
                return 2
            previous = pairs[index - 1] if index > 0 else None
            if previous and previous.get("strand_1") != row.get("strand_1"):
                return 2
            if symbol and not symbol.upper().startswith("LOC") and symbol != gene_id:
                return 1
            return 3

        def label_text(row: dict) -> str:
            value = str(row.get("gene_symbol_1") or row.get("gene_1") or "").strip()
            return value[:24]

        def layout_gene_labels() -> list[dict[str, Any]]:
            if label_mode == "none":
                return []
            candidates: list[dict[str, Any]] = []
            for index, row in enumerate(pairs):
                text = label_text(row)
                if not text:
                    continue
                tier = label_tier(row, index)
                if label_mode in {"compact", "overview-landmark"} and tier > 2:
                    continue
                q1 = sx(self._int(row.get("start_1")), q_min, q_max)
                q2 = sx(self._int(row.get("end_1")), q_min, q_max)
                candidates.append(
                    {
                        "x": (q1 + q2) / 2,
                        "text": text,
                        "tier": tier,
                        "index": index,
                    }
                )
            candidates.sort(key=lambda item: (item["tier"], item["index"]))
            max_labels = 15 if label_mode == "overview-landmark" else 20000
            lanes = [left - 9999.0 for _ in range(max_lanes)]
            labels: list[dict[str, Any]] = []
            for item in candidates:
                if len(labels) >= max_labels:
                    break
                estimated_width = max(24.0, len(item["text"]) * 6.2)
                x = max(left + estimated_width / 2, min(left + width - estimated_width / 2, item["x"]))
                placed_lane: Optional[int] = None
                for lane_index, occupied_until in enumerate(lanes):
                    label_left = x - estimated_width / 2
                    if label_left >= occupied_until + 8:
                        placed_lane = lane_index
                        lanes[lane_index] = x + estimated_width / 2
                        break
                if placed_lane is None:
                    continue
                labels.append(
                    {
                        **item,
                        "x": x,
                        "y": q_y - 22 - placed_lane * 18,
                        "lane": placed_lane,
                    }
                )
            labels.sort(key=lambda item: item["index"])
            return labels

        parts = [
            f'<line x1="{left}" y1="{q_y}" x2="{left + width}" y2="{q_y}" class="grid"/>',
            f'<line x1="{left}" y1="{t_y}" x2="{left + width}" y2="{t_y}" class="grid"/>',
        ]
        if settings.show_labels:
            parts.extend(
                [
                    f'<text x="{left}" y="{q_y - 38}" class="label">GRCg6a block {html.escape(str(block_id))}</text>',
                    f'<text x="{left}" y="{t_y + 50}" class="label">GRCg7b homologous region</text>',
                ]
            )
        for row in pairs:
            q1 = sx(self._int(row.get("start_1")), q_min, q_max)
            q2 = sx(self._int(row.get("end_1")), q_min, q_max)
            t1 = sx(self._int(row.get("start_2")), t_min, t_max)
            t2 = sx(self._int(row.get("end_2")), t_min, t_max)
            q_mid = (q1 + q2) / 2
            t_mid = (t1 + t2) / 2
            if settings.show_anchor_lines:
                parts.append(
                    f'<line x1="{q_mid:.2f}" y1="{q_y + 10}" x2="{t_mid:.2f}" y2="{t_y - 10}" class="anchor-link link">'
                    f"<title>{html.escape(anchor_title(row))}</title></line>"
                )
            if settings.show_gene_arrows:
                parts.append(arrow(q1, q2, q_y, str(row.get("strand_1", "+")), "gene", gene_title(row, "GRCg6a")))
                parts.append(arrow(t1, t2, t_y, str(row.get("strand_2", "+")), "gene2", gene_title(row, "GRCg7b")))
        labels = layout_gene_labels()
        for item in labels:
            tier_class = "gene-label-tier1" if item["tier"] == 1 else "gene-label-tier2"
            parts.append(
                f'<text x="{item["x"]:.2f}" y="{item["y"]:.2f}" text-anchor="middle" class="gene-label {tier_class}">'
                f'{html.escape(str(item["text"]))}</text>'
            )
        block_row = next((row for row in blocks if str(row.get("block_id", "")) == str(block_id)), {})
        method = block_row.get("method") or pairs[0].get("method", "")
        parts.append(
            f'<text x="{left}" y="{caption_y}" class="small">Block: {html.escape(str(block_id))}; anchors rendered: {len(pairs)}/{anchor_count}; labels shown: {len(labels)}/{anchor_count}; label mode: {label_mode}; method={html.escape(str(method))}</text>'
        )
        if settings.show_legend:
            parts.extend(
                [
                    f'<rect x="{settings.width - 186}" y="{caption_y - 10}" width="30" height="10" class="gene"/>',
                    f'<text x="{settings.width - 150}" y="{caption_y}" class="small">GRCg6a gene</text>',
                    f'<rect x="{settings.width - 82}" y="{caption_y - 10}" width="30" height="10" class="gene2"/>',
                    f'<text x="{settings.width - 46}" y="{caption_y}" class="small">GRCg7b</text>',
                ]
            )
        return self._svg_shell(
            figure_id="micro-synteny",
            title="Micro-synteny",
            subtitle="Local gene order, direction, and homologous anchor connections.",
            settings=settings,
            body="".join(parts),
        )

    def get_static_figure_catalog(self) -> dict:
        figure_defs = [
            {
                "id": "dna-dotplot",
                "title": "DNA Whole-genome Dotplot",
                "evidence_layer": "DNA natural synteny",
                "data_sources": [EvidenceFile.from_path("natural_paf", self.primary_paf).to_dict()],
                "description": "Whole-genome DNA-level dotplot from minimap2 asm5 natural-breakpoint PAF.",
            },
            {
                "id": "gene-collinearity-dotplot",
                "title": "Gene Collinearity Dotplot",
                "evidence_layer": "Gene collinearity",
                "data_sources": [
                    EvidenceFile.from_path("gene_pairs", self.gene_pairs).to_dict(),
                    EvidenceFile.from_path("anchors", self.anchors).to_dict(),
                ],
                "description": "Gene anchor dotplot showing conserved gene order and orientation.",
            },
            {
                "id": "karyotype-ribbons",
                "title": "Karyotype Ribbon Overview",
                "evidence_layer": "Gene collinearity blocks",
                "data_sources": [EvidenceFile.from_path("blocks", self.gene_blocks).to_dict()],
                "description": "Chromosome-scale ribbon overview of collinear blocks.",
            },
            {
                "id": "micro-synteny",
                "title": "Micro-synteny",
                "evidence_layer": "Selected gene collinearity block",
                "data_sources": [
                    EvidenceFile.from_path("blocks", self.gene_blocks).to_dict(),
                    EvidenceFile.from_path("gene_pairs", self.gene_pairs).to_dict(),
                ],
                "description": "Local gene arrows and homologous anchor links for one block.",
            },
        ]
        figures = []
        for item in figure_defs:
            available = all(source["exists"] for source in item["data_sources"])
            figures.append(
                {
                    **item,
                    "status": "available" if available else "missing",
                    "svg_endpoint": f"/comparative/static-figures/{item['id']}.svg",
                    "export_formats": ["svg"],
                    "coordinate_system": "Source files use 0-based genomic coordinates; labels are publication-style genomic intervals.",
                    "provenance": "Static figure generated from local audited comparative evidence files.",
                }
            )
        return {
            "pair": {"assembly_1": "GRCg6a", "assembly_2": "GRCg7b", "species": "Gallus gallus"},
            "dynamic_layers": [
                "JBrowse2 Natural DNA Synteny",
                "JBrowse2 Gene Collinearity Anchors",
            ],
            "figures": figures,
        }

    def render_static_figure_svg(
        self,
        figure_id: str,
        *,
        block_id: Optional[str] = None,
        settings: Optional[dict[str, Any] | FigureSettings] = None,
    ) -> str:
        if figure_id == "dna-dotplot":
            return self._render_dna_dotplot_svg(settings=settings)
        if figure_id == "gene-collinearity-dotplot":
            return self._render_gene_dotplot_svg(settings=settings)
        if figure_id == "karyotype-ribbons":
            return self._render_karyotype_svg(settings=settings)
        if figure_id == "micro-synteny":
            return self._render_micro_synteny_svg(block_id=block_id, settings=settings)
        raise ValueError(f"Unknown static figure id: {figure_id}")

    def _normalize_bed_content(self, path: Path, assembly: str) -> str:
        if not path.exists():
            return ""
        lines: list[str] = []
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                if not line.strip() or line.startswith("#"):
                    lines.append(line)
                    continue
                fields = line.rstrip("\n").split("\t")
                if fields:
                    fields[0] = normalize_chr(assembly, fields[0])
                    if assembly == "GRCg7b" and not fields[0].startswith("chr"):
                        fields[0] = f"chr{fields[0]}"
                lines.append("\t".join(fields) + "\n")
        return "".join(lines)

    def get_gene_collinearity_file(self, name: str) -> Optional[dict]:
        allowed = {
            "grcg6a_grcg7b.anchors": self.anchors,
            "grcg6a_grcg7b.anchors.simple": self.simple_anchors,
            "GRCg6a.bed": self.grcg6a_bed,
            "GRCg7b.bed": self.grcg7b_bed,
        }
        if name not in allowed:
            return None
        path = allowed[name]
        if not path.exists():
            return None
        if name == "GRCg6a.bed":
            content = self._normalize_bed_content(path, "GRCg6a")
        elif name == "GRCg7b.bed":
            content = self._normalize_bed_content(path, "GRCg7b")
        else:
            content = path.read_text(encoding="utf-8", errors="replace")
        return {"path": path, "content": content, "media_type": "text/plain"}

    def get_micro_synteny_block_details(self, block_id: str, pair_limit: int = 20000) -> dict:
        if not SAFE_BLOCK_ID_RE.match(block_id):
            return {
                "status": "missing",
                "block_id": block_id,
                "block": {},
                "summary": {},
                "pairs": [],
                "pair_count": 0,
                "message": "Invalid micro-synteny block id.",
            }
        blocks = self._read_gene_blocks()
        block = next((row for row in blocks if str(row.get("block_id", "")) == block_id), None)
        pairs = self._read_gene_pairs(block_id=block_id, limit=pair_limit)
        if not block or not pairs:
            return {
                "status": "missing",
                "block_id": block_id,
                "block": block or {},
                "summary": {},
                "pairs": [],
                "pair_count": 0,
                "message": "No anchor pairs are available for the selected block.",
            }

        q_start = min(self._int(row.get("start_1")) for row in pairs)
        q_end = max(self._int(row.get("end_1")) for row in pairs)
        t_start = min(self._int(row.get("start_2")) for row in pairs)
        t_end = max(self._int(row.get("end_2")) for row in pairs)
        pidents = [self._float(row.get("pident")) for row in pairs if row.get("pident") not in {None, ""}]
        qcovs = [self._float(row.get("qcovs")) for row in pairs if row.get("qcovs") not in {None, ""}]
        query_chr = str(block.get("chr_1") or pairs[0].get("chr_1") or "")
        target_chr = str(block.get("chr_2") or pairs[0].get("chr_2") or "")
        summary = {
            "block_id": block_id,
            "anchor_count": len(pairs),
            "query_chr": query_chr,
            "target_chr": target_chr,
            "query_interval": f"{query_chr}:{q_start}-{q_end}",
            "target_interval": f"{target_chr}:{t_start}-{t_end}",
            "query_span_bp": max(0, q_end - q_start),
            "target_span_bp": max(0, t_end - t_start),
            "orientation": block.get("orientation") or pairs[0].get("orientation") or "",
            "mean_identity": round(sum(pidents) / len(pidents), 3) if pidents else None,
            "mean_qcovs": round(sum(qcovs) / len(qcovs), 3) if qcovs else None,
            "method": block.get("method") or pairs[0].get("method") or "",
        }
        return {
            "status": "available",
            "block_id": block_id,
            "block": block,
            "summary": summary,
            "pairs": pairs,
            "pair_count": len(pairs),
            "message": "Micro-synteny block details are available.",
        }

    def get_gene_collinearity(
        self,
        *,
        chr_name: Optional[str] = None,
        limit: int = 100,
        block_limit: Optional[int] = None,
    ) -> dict:
        status = self.get_status()["layers"]["gene_collinearity"]["status"]
        pairs = self._read_tsv_rows(self.gene_pairs, limit)
        blocks = self._read_tsv_rows(self.gene_blocks, block_limit or limit)
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
