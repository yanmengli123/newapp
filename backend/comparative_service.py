"""
Comparative Genomics Service
Provides synteny, coordinate mapping, and cross-assembly analysis
"""

from typing import Optional, Any
import psycopg2
from psycopg2.extras import RealDictCursor


class ComparativeService:
    """Comparative genomics analysis service"""

    def __init__(self, pg_pool):
        self.pg_pool = pg_pool

    def _get_cursor(self):
        conn = self.pg_pool.getconn()
        return conn, conn.cursor(cursor_factory=RealDictCursor)

    def _release(self, conn):
        self.pg_pool.putconn(conn)

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
