"""
Comparative Genomics Service
Provides synteny, coordinate mapping, and cross-assembly analysis
"""

from pathlib import Path
from typing import Optional, Any, Literal
import json

import psycopg2
from psycopg2.extras import RealDictCursor

from backend.comparative_paf import (
    AlignmentMode,
    read_paf_records,
    records_to_dicts,
    summarize_paf_records,
)
from backend.comparative_registry import build_pair_registry
from backend.comparative_gold import CoordinateSide, GoldStandardComparativeStore
from backend.config import GRCG6A_RAWDATA_ROOT


class ComparativeService:
    """Comparative genomics analysis service"""

    def __init__(self, pg_pool):
        self.pg_pool = pg_pool
        self.gold_store = GoldStandardComparativeStore(self._project_root())

    def _get_cursor(self):
        conn = self.pg_pool.getconn()
        return conn, conn.cursor(cursor_factory=RealDictCursor)

    def _release(self, conn):
        self.pg_pool.putconn(conn)

    def _project_root(self) -> Path:
        return GRCG6A_RAWDATA_ROOT.parent

    def _registry_path(self) -> Path:
        return self._project_root() / "comparative" / "registry" / "assembly_registry.json"

    def _repo_root(self) -> Path:
        return Path(__file__).resolve().parents[1]

    def _first_existing(self, *paths: Path) -> Path | None:
        for path in paths:
            if path.exists():
                return path
        return None

    def _build_registry_from_local_inputs(self) -> dict:
        project_root = self._project_root()
        repo_root = self._repo_root()
        grcg6a_report = self._first_existing(
            project_root / "GRCg6a_sequence_report.tsv",
            repo_root / "GRCg6a_sequence_report.tsv",
        )
        grcg7b_report = self._first_existing(
            project_root / "GRCg7b_sequence_report.tsv",
            repo_root / "GRCg7b_sequence_report.tsv",
        )
        if grcg6a_report is None or grcg7b_report is None:
            return {
                "version": "comparative_gold_v1",
                "pair": {"assembly_1": "GRCg6a", "assembly_2": "GRCg7b", "comparison_id": "GRCg6a__GRCg7b"},
                "assemblies": {},
                "shared_molecules": [],
                "target_only_molecules": [],
                "chromosome_mapping": [],
                "dotplot_axes": {
                    "query": {"assembly": "GRCg6a", "molecule_count": 0, "molecules": []},
                    "target": {"assembly": "GRCg7b", "molecule_count": 0, "molecules": []},
                },
                "validation": {
                    "status": "missing",
                    "errors": ["NCBI sequence_report.tsv files are not available for registry construction"],
                },
            }
        grcg6a_fasta = self._first_existing(
            project_root / "GCF_000002315.6_GRCg6a_primary_35.fna",
            project_root / "GCF_000002315.6_GRCg6a_genomic.chr.fna",
        )
        grcg6a_gff = self._first_existing(
            project_root / "GCF_000002315.6_GRCg6a_primary_35.gff.gz",
            project_root / "GCF_000002315.6_GRCg6a_genomic.gff",
        )
        grcg7b_fasta = self._first_existing(
            project_root / "GCF_016699485.2_GRCg7b_primary_42.fna",
            project_root / "GCF_016699485.2_GRCg7b_main_chr.fna",
            project_root / "GCF_016699485.2_GRCg7b_genomic.fna.gz",
            project_root / "grcg7b" / "GCF_016699485.2_bGalGal1.mat.broiler.GRCg7b_genomic.fna.gz",
        )
        grcg7b_gff = self._first_existing(
            project_root / "GCF_016699485.2_GRCg7b_primary_42.gff.gz",
            project_root / "GCF_016699485.2_GRCg7b_main_chr.gff.gz",
            project_root / "GCF_016699485.2_GRCg7b_genomic.gff.gz",
            project_root / "grcg7b" / "GCF_016699485.2_bGalGal1.mat.broiler.GRCg7b_genomic.gff.gz",
        )
        return build_pair_registry(
            grcg6a_report=grcg6a_report,
            grcg7b_report=grcg7b_report,
            grcg6a_fasta=grcg6a_fasta,
            grcg7b_fasta=grcg7b_fasta,
            grcg6a_fai=Path(f"{grcg6a_fasta}.fai") if grcg6a_fasta else None,
            grcg7b_fai=Path(f"{grcg7b_fasta}.fai") if grcg7b_fasta else None,
            grcg6a_gff=grcg6a_gff,
            grcg7b_gff=grcg7b_gff,
            expected_grcg6a_molecules=35,
            expected_grcg7b_molecules=42,
        )

    def get_comparative_registry(self) -> dict:
        cached = getattr(self, "_registry_cache", None)
        if cached is not None:
            return cached
        registry_path = self._registry_path()
        if registry_path.exists():
            registry = json.loads(registry_path.read_text(encoding="utf-8-sig"))
        else:
            registry = self._build_registry_from_local_inputs()
        self._registry_cache = registry
        return registry

    def get_comparative_overview(self) -> dict:
        registry = self.get_comparative_registry()
        assemblies = registry.get("assemblies", {})
        return {
            "version": registry.get("version", "comparative_gold_v1"),
            "pair": registry.get("pair", {}),
            "assemblies": {
                name: {
                    "assembled_molecule_count": row.get("assembled_molecule_count", 0),
                    "chromosome_count": row.get("chromosome_count", 0),
                    "organelle_count": row.get("organelle_count", 0),
                    "total_length": row.get("total_length", 0),
                }
                for name, row in assemblies.items()
            },
            "shared_molecule_count": len(registry.get("shared_molecules", [])),
            "shared_molecules": registry.get("shared_molecules", []),
            "target_only_count": len(registry.get("target_only_molecules", [])),
            "target_only_molecules": [row.get("chr") for row in registry.get("target_only_molecules", [])],
            "validation": registry.get("validation", {}),
        }

    def get_target_only_molecules(self) -> dict:
        registry = self.get_comparative_registry()
        molecules = registry.get("target_only_molecules", [])
        return {
            "version": registry.get("version", "comparative_gold_v1"),
            "assembly": registry.get("pair", {}).get("assembly_2", "GRCg7b"),
            "molecules": molecules,
            "count": len(molecules),
            "validation": registry.get("validation", {}),
        }

    def get_dotplot_metadata(self) -> dict:
        registry = self.get_comparative_registry()
        dna_root = self._project_root() / "comparative" / "pairwise" / "GRCg6a__GRCg7b" / "dna_alignment"
        return {
            "version": registry.get("version", "comparative_gold_v1"),
            "pair": registry.get("pair", {}),
            "axes": registry.get("dotplot_axes", {}),
            "alignment_layers": [
                {
                    "id": "clean_primary",
                    "label": "Clean primary PAF",
                    "role": "default_dotplot",
                    "source": str(self.get_alignment_paf_path("natural")),
                },
                {
                    "id": "all_primary",
                    "label": "All primary PAF",
                    "role": "review_archive",
                    "source": str(dna_root / "GRCg6a_to_GRCg7b.primary.asm5.all.paf"),
                },
                {
                    "id": "grcg7b_extra_micro_evidence",
                    "label": "GRCg7b-only microchromosome evidence",
                    "role": "target_only_evidence",
                    "source": str(dna_root / "GRCg7b_extra_micro_to_GRCg6a_full.asm10.evidence.paf"),
                },
                {
                    "id": "gene_collinearity",
                    "label": "Gene collinearity anchors",
                    "role": "gene_order_evidence",
                    "source": str(self.gold_store.anchors) if hasattr(self, "gold_store") else "",
                },
            ],
            "validation": registry.get("validation", {}),
        }

    def get_alignment_paf_path(self, mode: AlignmentMode = "natural") -> Path:
        """Return the source PAF file for a comparative alignment layer."""
        project_root = self._project_root()
        dna_root = project_root / "comparative" / "pairwise" / "GRCg6a__GRCg7b" / "dna_alignment"
        candidates = [
            dna_root / "primary.asm5.paf",
            dna_root / "GRCg6a_to_GRCg7b.primary.asm5.clean.paf",
            project_root / "synteny" / "natural" / "grcg6a_vs_grcg7b.natural.asm5.paf",
        ]
        for path in candidates:
            if path.exists():
                return path
        return candidates[0]

    def get_alignment_provenance_path(self) -> Path:
        project_root = self._project_root()
        candidates = [
            project_root / "comparative" / "pairwise" / "GRCg6a__GRCg7b" / "dna_alignment" / "provenance.json",
            project_root / "synteny" / "natural" / "grcg6a_vs_grcg7b.natural.asm5.provenance.json",
        ]
        for path in candidates:
            if path.exists():
                return path
        return candidates[0]

    def get_alignment_blocks(
        self,
        assembly_1: str = "GRCg6a",
        assembly_2: str = "GRCg7b",
        mode: AlignmentMode = "natural",
        chr_1: Optional[str] = None,
        chr_2: Optional[str] = None,
        min_quality: int = 30,
        min_identity: float = 85.0,
        min_alignment_length: int = 50_000,
        limit: int = 5000,
        order: Literal["coordinate", "score"] = "coordinate",
    ) -> list[dict]:
        """Read normalized natural-breakpoint PAF alignment blocks."""
        if {assembly_1, assembly_2} != {"GRCg6a", "GRCg7b"}:
            return []

        path = self.get_alignment_paf_path(mode)
        records = read_paf_records(
            path,
            assembly_1=assembly_1,
            assembly_2=assembly_2,
            chr_1=chr_1,
            chr_2=chr_2,
            min_mapq=min_quality,
            min_identity=min_identity,
            min_alignment_length=min_alignment_length,
            limit=limit,
            order=order,
        )
        return records_to_dicts(records)

    def get_alignment_block_result(
        self,
        assembly_1: str = "GRCg6a",
        assembly_2: str = "GRCg7b",
        mode: AlignmentMode = "natural",
        chr_1: Optional[str] = None,
        chr_2: Optional[str] = None,
        min_quality: int = 30,
        min_identity: float = 85.0,
        min_alignment_length: int = 50_000,
        limit: int = 5000,
        order: Literal["coordinate", "score"] = "coordinate",
    ) -> dict:
        """Read alignment blocks with explicit truncation metadata."""
        if {assembly_1, assembly_2} != {"GRCg6a", "GRCg7b"}:
            return {
                "blocks": [],
                "returned_count": 0,
                "total_count": 0,
                "truncated": False,
            }

        path = self.get_alignment_paf_path(mode)
        all_records = read_paf_records(
            path,
            assembly_1=assembly_1,
            assembly_2=assembly_2,
            chr_1=chr_1,
            chr_2=chr_2,
            min_mapq=min_quality,
            min_identity=min_identity,
            min_alignment_length=min_alignment_length,
            limit=None,
            order=order,
        )
        displayed_records = all_records[:limit]
        return {
            "blocks": records_to_dicts(displayed_records),
            "returned_count": len(displayed_records),
            "total_count": len(all_records),
            "truncated": len(all_records) > len(displayed_records),
        }

    def get_alignment_stats(
        self,
        assembly_1: str = "GRCg6a",
        assembly_2: str = "GRCg7b",
        mode: AlignmentMode = "natural",
        min_quality: int = 30,
        min_identity: float = 85.0,
        min_alignment_length: int = 50_000,
    ) -> dict:
        """Summarize a comparative PAF alignment layer."""
        if {assembly_1, assembly_2} != {"GRCg6a", "GRCg7b"}:
            return {
                "dataset": mode,
                "source_exists": False,
                "block_count": 0,
                "dataset_classification": "unsupported assembly pair",
            }

        path = self.get_alignment_paf_path(mode)
        records = read_paf_records(
            path,
            assembly_1=assembly_1,
            assembly_2=assembly_2,
            min_mapq=min_quality,
            min_identity=min_identity,
            min_alignment_length=min_alignment_length,
            limit=None,
            order="coordinate",
        )
        summary = summarize_paf_records(records, dataset=mode, source_path=path)
        summary["filters"] = {
            "min_quality": min_quality,
            "min_identity": min_identity,
            "min_alignment_length": min_alignment_length,
        }
        return summary

    def get_comparative_methods(self) -> dict:
        """Return provenance and interpretation metadata for the comparative view."""
        natural_path = self.get_alignment_paf_path("natural")
        provenance_path = self.get_alignment_provenance_path()
        provenance: dict[str, Any] = {}
        if provenance_path.exists():
            try:
                provenance = json.loads(provenance_path.read_text(encoding="utf-8-sig"))
            except json.JSONDecodeError:
                provenance = {"error": "Natural PAF provenance JSON could not be parsed."}

        return {
            "primary_dataset": "natural",
            "assemblies": {
                "assembly_1": "GRCg6a",
                "assembly_2": "GRCg7b",
                "species": "Gallus gallus",
            },
            "natural_alignment": {
                "status": "available" if natural_path.exists() else "missing",
                "path": str(natural_path),
                "provenance_path": str(provenance_path),
                "provenance": provenance,
                "default_filters": {
                    "min_quality": 30,
                    "min_identity": 85,
                    "min_alignment_length": 50_000,
                    "secondary_alignments": "disabled",
                },
                "interpretation": (
                    "Primary synteny layer. Breakpoints are produced by minimap2 chaining "
                    "from whole-genome alignment instead of fixed genomic windows."
                ),
            },
            "coordinate_system": "PAF 0-based half-open coordinates; table labels are displayed as genomic intervals.",
            "jbrowse2": {
                "compatible_input": "PAF",
                "view": "LinearSyntenyView / SyntenyTrack",
                "note": "JBrowse2 visualizes the PAF; natural breakpoints are generated upstream by minimap2.",
            },
        }

    def get_gold_standard_status(self) -> dict:
        """Return file-backed status for all gold-standard evidence layers."""
        return self.gold_store.get_status()

    def get_static_figure_catalog(self) -> dict:
        """Return the publication-style static figure catalog."""
        return self.gold_store.get_static_figure_catalog()

    def get_static_figure_svg(
        self,
        figure_id: str,
        block_id: Optional[str] = None,
        settings: Optional[dict[str, Any]] = None,
    ) -> str:
        """Render a static comparative figure as SVG."""
        return self.gold_store.render_static_figure_svg(figure_id, block_id=block_id, settings=settings)

    def get_gene_collinearity_file(self, name: str) -> Optional[dict]:
        """Return MCScan-compatible anchors/BED content for JBrowse2."""
        return self.gold_store.get_gene_collinearity_file(name)

    def get_micro_synteny_block_details(self, block_id: str) -> dict:
        """Return selected micro-synteny block summary and gene-pair details."""
        return self.gold_store.get_micro_synteny_block_details(block_id)

    def get_citation_text(self) -> dict:
        """Return citation-ready methods text and provenance summary."""
        return self.gold_store.get_citation_text()

    def get_sv_candidates(self, *, min_gap_bp: int = 100_000) -> dict:
        """Return exploratory structural-variant candidates from natural PAF structure."""
        return self.gold_store.get_sv_candidates(min_gap_bp=min_gap_bp)

    def get_base_level_records(
        self,
        side: CoordinateSide = "query",
        chr_name: str = "1",
        start: int = 0,
        end: int = 5_000_000,
        limit: int = 50,
    ) -> dict:
        """Return local base-level --cs/-c PAF records when available."""
        return self.gold_store.get_base_level_records(
            side=side,
            chr_name=chr_name,
            start=start,
            end=end,
            limit=limit,
        )

    def get_gene_collinearity(
        self,
        chr_name: Optional[str] = None,
        limit: int = 100,
        block_limit: Optional[int] = None,
    ) -> dict:
        """Return JCVI/MCScanX-style gene collinearity rows when available."""
        return self.gold_store.get_gene_collinearity(
            chr_name=chr_name,
            limit=limit,
            block_limit=block_limit,
        )

    def get_paf_file_layer_status(self, mode: AlignmentMode = "natural") -> dict:
        """Report whether /paf/file can serve primary natural-breakpoint data."""
        requested = self.get_alignment_paf_path(mode)
        if requested.exists():
            return {
                "status": "primary",
                "mode": "natural",
                "source_path": str(requested),
                "warning": "",
            }
        return {
            "status": "missing",
            "mode": "natural",
            "source_path": str(requested),
            "warning": "Natural-breakpoint PAF is missing; no fixed-window fallback is allowed.",
        }

    def get_paf_file_content(
        self,
        assembly_1: str = "GRCg6a",
        assembly_2: str = "GRCg7b",
        mode: AlignmentMode = "natural",
        min_quality: int = 30,
        min_identity: float = 85.0,
        min_alignment_length: int = 50_000,
        limit: int = 100_000,
    ) -> str:
        """Return filtered PAF text for JBrowse2 or direct download."""
        path = self.get_alignment_paf_path(mode)

        records = read_paf_records(
            path,
            assembly_1=assembly_1,
            assembly_2=assembly_2,
            min_mapq=min_quality,
            min_identity=min_identity,
            min_alignment_length=min_alignment_length,
            limit=limit,
            order="coordinate",
        )
        lines = [
            "\t".join(
                [
                    record.query_name,
                    str(record.query_length),
                    str(record.query_start),
                    str(record.query_end),
                    record.strand,
                    record.target_name,
                    str(record.target_length),
                    str(record.target_start),
                    str(record.target_end),
                    str(record.residue_matches),
                    str(record.alignment_length),
                    str(record.mapping_quality),
                ]
            )
            for record in records
        ]
        return "\n".join(lines) + ("\n" if lines else "")

    def list_assemblies(self) -> list[dict]:
        """List all registered genome assemblies"""
        conn, cur = self._get_cursor()
        try:
            cur.execute("""
                SELECT assembly_name, species, accession, version,
                       chromosome_count, total_length, gene_count, description
                FROM genome_assembly
                ORDER BY assembly_name
            """)
            return cur.fetchall()
        finally:
            cur.close()
            self._release(conn)

    def get_assembly_info(self, assembly_name: str) -> Optional[dict]:
        """Get detailed assembly information"""
        conn, cur = self._get_cursor()
        try:
            cur.execute("""
                SELECT * FROM genome_assembly WHERE assembly_name = %s
            """, (assembly_name,))
            return cur.fetchone()
        finally:
            cur.close()
            self._release(conn)

    def get_chromosome_mapping(
        self, assembly_from: str, assembly_to: str
    ) -> list[dict]:
        """Get chromosome-level mapping between assemblies"""
        if assembly_from == "GRCg6a" and assembly_to == "GRCg7b":
            registry = self.get_comparative_registry()
            if registry.get("chromosome_mapping"):
                return [
                    {
                        "mapping_id": index,
                        "assembly_from": assembly_from,
                        "assembly_to": assembly_to,
                        "chr_from": row["chr_from"],
                        "chr_to": row["chr_to"],
                        "refseq_from": row["refseq_from"],
                        "refseq_to": row["refseq_to"],
                        "genbank_from": row.get("genbank_from"),
                        "genbank_to": row.get("genbank_to"),
                        "strand": row.get("strand", "+"),
                        "score": 1.0,
                    }
                    for index, row in enumerate(registry["chromosome_mapping"], start=1)
                ]
        conn, cur = self._get_cursor()
        try:
            cur.execute("""
                SELECT * FROM chromosome_mapping
                WHERE assembly_from = %s AND assembly_to = %s
                ORDER BY chr_from
            """, (assembly_from, assembly_to))
            return cur.fetchall()
        finally:
            cur.close()
            self._release(conn)

    def get_synteny_blocks(
        self,
        assembly_1: str,
        assembly_2: str,
        chr_1: Optional[str] = None,
        start_1: Optional[int] = None,
        end_1: Optional[int] = None,
        chr_2: Optional[str] = None,
        min_score: float = 0.0,
        min_identity: float = 0.0,
        limit: int = 1000
    ) -> list[dict]:
        """Get synteny blocks between assemblies"""
        conn, cur = self._get_cursor()
        try:
            sql = """
                SELECT * FROM synteny_block
                WHERE assembly_1 = %s AND assembly_2 = %s
                  AND score >= %s AND identity >= %s
            """
            params: list[Any] = [assembly_1, assembly_2, min_score, min_identity]

            if chr_1:
                if start_1 is not None and end_1 is not None:
                    sql += " AND chr_1 = %s AND start_1 <= %s AND end_1 >= %s"
                    params.extend([chr_1, end_1, start_1])
                else:
                    sql += " AND chr_1 = %s"
                    params.append(chr_1)

            if chr_2:
                sql += " AND chr_2 = %s"
                params.append(chr_2)

            sql += " ORDER BY score DESC LIMIT %s"
            params.append(limit)

            cur.execute(sql, params)
            return cur.fetchall()
        finally:
            cur.close()
            self._release(conn)

    def map_coordinates(
        self,
        gene_id: str,
        assembly_from: str,
        assembly_to: str
    ) -> Optional[dict]:
        """Map gene coordinates between assemblies"""
        conn, cur = self._get_cursor()
        try:
            cur.execute("""
                SELECT * FROM gene_coordinate_mapping
                WHERE gene_id = %s
                  AND assembly_from = %s
                  AND assembly_to = %s
                ORDER BY confidence DESC
                LIMIT 1
            """, (gene_id, assembly_from, assembly_to))
            return cur.fetchone()
        finally:
            cur.close()
            self._release(conn)

    def get_genes_in_region(
        self,
        assembly: str,
        chr_name: str,
        start: int,
        end: int
    ) -> list[dict]:
        """Get genes in a genomic region"""
        conn, cur = self._get_cursor()
        try:
            cur.execute("""
                SELECT gcm.gene_id, gcm.gene_symbol,
                       gcm.chr_from, gcm.start_from, gcm.end_from, gcm.strand_from,
                       gcm.chr_to, gcm.start_to, gcm.end_to, gcm.strand_to,
                       gcm.mapping_method, gcm.confidence
                FROM gene_coordinate_mapping gcm
                WHERE gcm.assembly_from = %s
                  AND gcm.chr_from = %s
                  AND gcm.start_from <= %s
                  AND gcm.end_from >= %s
                ORDER BY gcm.start_from
                LIMIT 500
            """, (assembly, chr_name, end, start))
            return cur.fetchall()
        finally:
            cur.close()
            self._release(conn)

    def get_dotplot_data(
        self,
        assembly_1: str,
        assembly_2: str,
        chr_1: Optional[str] = None,
        chr_2: Optional[str] = None,
        min_score: float = 50.0
    ) -> list[dict]:
        """Get dotplot data for visualization"""
        conn, cur = self._get_cursor()
        try:
            sql = """
                SELECT chr_1, start_1, end_1, chr_2, start_2, end_2,
                       strand, score, identity
                FROM synteny_block
                WHERE assembly_1 = %s AND assembly_2 = %s
                  AND score >= %s
            """
            params: list[Any] = [assembly_1, assembly_2, min_score]

            if chr_1:
                sql += " AND chr_1 = %s"
                params.append(chr_1)
            if chr_2:
                sql += " AND chr_2 = %s"
                params.append(chr_2)

            sql += " ORDER BY score DESC LIMIT 5000"
            cur.execute(sql, params)
            return cur.fetchall()
        finally:
            cur.close()
            self._release(conn)

    def get_paf_alignments(
        self,
        assembly_1: str,
        assembly_2: str,
        query_chr: Optional[str] = None,
        target_chr: Optional[str] = None,
        min_quality: int = 30,
        limit: int = 5000
    ) -> list[dict]:
        """Get PAF alignments for JBrowse2 SyntenyTrack"""
        conn, cur = self._get_cursor()
        try:
            sql = """
                SELECT query_name, query_length, query_start, query_end,
                       strand, target_name, target_length, target_start, target_end,
                       residue_matches, alignment_length, mapping_quality, score
                FROM paf_alignment
                WHERE assembly_1 = %s AND assembly_2 = %s
                  AND mapping_quality >= %s
            """
            params: list[Any] = [assembly_1, assembly_2, min_quality]

            if query_chr:
                sql += " AND query_name = %s"
                params.append(query_chr)
            if target_chr:
                sql += " AND target_name = %s"
                params.append(target_chr)

            sql += " ORDER BY score DESC LIMIT %s"
            params.append(limit)

            cur.execute(sql, params)
            return cur.fetchall()
        finally:
            cur.close()
            self._release(conn)

    def get_comparison_stats(
        self,
        assembly_1: str,
        assembly_2: str
    ) -> dict:
        """Get comprehensive comparison statistics"""
        conn, cur = self._get_cursor()
        try:
            # Synteny stats
            cur.execute("""
                SELECT
                    COUNT(*) as block_count,
                    SUM(alignment_length) as total_aligned_bases,
                    AVG(identity) as avg_identity,
                    AVG(score) as avg_score,
                    COUNT(DISTINCT chr_1) as chromosomes_1,
                    COUNT(DISTINCT chr_2) as chromosomes_2
                FROM synteny_block
                WHERE assembly_1 = %s AND assembly_2 = %s
            """, (assembly_1, assembly_2))
            synteny_stats = cur.fetchone()

            # Gene mapping stats
            cur.execute("""
                SELECT
                    COUNT(*) as mapped_genes,
                    COUNT(DISTINCT chr_from) as chr_from_count,
                    COUNT(DISTINCT chr_to) as chr_to_count,
                    AVG(confidence) as avg_confidence
                FROM gene_coordinate_mapping
                WHERE assembly_from = %s AND assembly_to = %s
            """, (assembly_1, assembly_2))
            gene_stats = cur.fetchone()

            # PAF alignment stats
            cur.execute("""
                SELECT
                    COUNT(*) as alignment_count,
                    SUM(alignment_length) as total_alignment_bases,
                    AVG(mapping_quality) as avg_mapq
                FROM paf_alignment
                WHERE assembly_1 = %s AND assembly_2 = %s
            """, (assembly_1, assembly_2))
            paf_stats = cur.fetchone()

            return {
                'synteny': synteny_stats,
                'gene_mapping': gene_stats,
                'alignments': paf_stats
            }
        finally:
            cur.close()
            self._release(conn)

    def get_ortholog_table(
        self,
        assembly_1: str,
        assembly_2: str,
        chr_filter: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> dict:
        """Get ortholog table with pagination"""
        conn, cur = self._get_cursor()
        try:
            # Count
            count_sql = """
                SELECT COUNT(*) FROM gene_coordinate_mapping
                WHERE assembly_from = %s AND assembly_to = %s
            """
            params_count: list[Any] = [assembly_1, assembly_2]
            if chr_filter:
                count_sql += " AND chr_from = %s"
                params_count.append(chr_filter)
            cur.execute(count_sql, params_count)
            total = cur.fetchone()['count']

            # Data
            data_sql = """
                SELECT gene_id, gene_symbol,
                       chr_from, start_from, end_from, strand_from,
                       chr_to, start_to, end_to, strand_to,
                       mapping_method, confidence
                FROM gene_coordinate_mapping
                WHERE assembly_from = %s AND assembly_to = %s
            """
            params_data: list[Any] = [assembly_1, assembly_2]
            if chr_filter:
                data_sql += " AND chr_from = %s"
                params_data.append(chr_filter)

            data_sql += " ORDER BY chr_from, start_from LIMIT %s OFFSET %s"
            params_data.extend([limit, offset])

            cur.execute(data_sql, params_data)
            rows = cur.fetchall()

            return {
                'total': total,
                'limit': limit,
                'offset': offset,
                'data': rows
            }
        finally:
            cur.close()
            self._release(conn)
