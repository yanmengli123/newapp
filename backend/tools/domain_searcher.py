"""
Domain Search 工具
使用本地 HMMER + Pfam 数据库搜索蛋白结构域
"""
import logging
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field

from backend.config import GRCG6A_HMMER_DB

logger = logging.getLogger(__name__)

# Pfam 数据库路径
PFAM_DB_PATH = GRCG6A_HMMER_DB


class DomainSearchRequest(BaseModel):
    """Domain 搜索请求"""
    gene_id: str = Field(..., description="基因 ID，如 gene-A4GALT")


class DomainResult(BaseModel):
    """单个结构域结果"""
    accession: str = Field(description="结构域 accession")
    name: str = Field(description="结构域名称")
    database: str = Field(default="Pfam", description="来源数据库")
    start: int = Field(description="起始位置 (蛋白序列)")
    end: int = Field(description="终止位置 (蛋白序列)")
    evalue: Optional[float] = Field(default=None, description="E-value")
    score: Optional[float] = Field(default=None, description="Score")


class DomainSearchResult(BaseModel):
    """搜索结果"""
    gene_id: str
    protein_id: str
    protein_length: int
    success: bool
    domains: list
    message: Optional[str] = None
    error: Optional[str] = None
    method: Optional[str] = "local_hmmer"


def get_protein_id_from_gene(gene_id: str, sql_conn) -> Optional[str]:
    """从数据库获取基因对应的蛋白 ID"""
    row = sql_conn.execute(
        """
        SELECT DISTINCT protein_id
        FROM cds_seq
        WHERE gene_symbol = ? OR protein_id = ?
        LIMIT 1
        """,
        (gene_id, gene_id)
    ).fetchone()

    if row:
        return row["protein_id"]

    row = sql_conn.execute(
        """
        SELECT DISTINCT c.protein_id
        FROM cds_seq c
        INNER JOIN gene_xref x ON c.gene_symbol = x.gene_symbol
        WHERE x.gene_id = ?
        LIMIT 1
        """,
        (gene_id,)
    ).fetchone()

    if row:
        return row["protein_id"]

    return None


def get_protein_sequence(protein_id: str, sql_conn) -> Optional[dict]:
    """从数据库获取蛋白序列信息"""
    row = sql_conn.execute(
        "SELECT protein_id, length, seq FROM protein_seq WHERE protein_id = ? LIMIT 1",
        (protein_id,)
    ).fetchone()

    if row:
        return dict(row)
    return None


def search_local_hmmer(protein_sequence: str, protein_id: str) -> dict:
    """使用本地 HMMER + Pfam 搜索结构域"""
    try:
        import pyhmmer
        from pyhmmer import plan7, hmmscan, easel

        alphabet = easel.Alphabet.amino()
        seq_obj = easel.TextSequence(
            name=protein_id.encode() if isinstance(protein_id, str) else protein_id,
            sequence=protein_sequence.encode()
        ).digitize(alphabet)

        with plan7.HMMFile(str(PFAM_DB_PATH)) as hmm_file:
            hits = list(hmmscan([seq_obj], hmm_file, cpus=1))

        if not hits:
            return {"domains": []}

        top_hits = hits[0]
        domains = []

        for hit in top_hits.reported:
            name = hit.name if isinstance(hit.name, str) else hit.name.decode()

            hit_domains = list(hit.domains)
            for dom in hit_domains:
                domain = {
                    "accession": name,
                    "name": name,
                    "database": "Pfam",
                    "start": dom.env_from,
                    "end": dom.env_to,
                    "evalue": hit.evalue,
                    "score": hit.score,
                }
                domains.append(domain)

        return {"domains": domains, "total_hits": len(top_hits.reported)}

    except FileNotFoundError:
        logger.error(f"Pfam database not found at {PFAM_DB_PATH}")
        return {"error": f"Pfam database not found at {PFAM_DB_PATH}"}
    except Exception as e:
        logger.error(f"HMMER search failed: {e}")
        return {"error": f"HMMER search failed: {str(e)}"}


def search_domains_for_gene(gene_id: str, sql_conn) -> DomainSearchResult:
    """为基因搜索蛋白结构域"""
    protein_id = get_protein_id_from_gene(gene_id, sql_conn)

    if not protein_id:
        return DomainSearchResult(
            gene_id=gene_id,
            protein_id="",
            protein_length=0,
            success=False,
            domains=[],
            error=f"No protein found for gene {gene_id}"
        )

    protein_info = get_protein_sequence(protein_id, sql_conn)

    if not protein_info:
        return DomainSearchResult(
            gene_id=gene_id,
            protein_id=protein_id,
            protein_length=0,
            success=False,
            domains=[],
            error=f"Protein sequence not found: {protein_id}"
        )

    protein_seq = protein_info.get("seq", "")
    protein_length = protein_info.get("length", 0)

    if not protein_seq:
        return DomainSearchResult(
            gene_id=gene_id,
            protein_id=protein_id,
            protein_length=0,
            success=False,
            domains=[],
            error="Empty protein sequence"
        )

    protein_seq = protein_seq.strip().replace("\n", "").replace(" ", "")

    if not PFAM_DB_PATH.exists():
        return DomainSearchResult(
            gene_id=gene_id,
            protein_id=protein_id,
            protein_length=protein_length,
            success=False,
            domains=[],
            error=f"Pfam database not found. Please download from: ftp://ftp.ebi.ac.uk/pub/databases/Pfam/releases/"
        )

    logger.info(f"Searching domains via local HMMER for {protein_id}")
    result = search_local_hmmer(protein_seq, protein_id)

    if "error" in result:
        return DomainSearchResult(
            gene_id=gene_id,
            protein_id=protein_id,
            protein_length=protein_length,
            success=False,
            domains=[],
            error=result["error"]
        )

    domains = [
        DomainResult(
            accession=d.get("accession", ""),
            name=d.get("name", ""),
            database=d.get("database", "Pfam"),
            start=d.get("start", 0),
            end=d.get("end", 0),
            evalue=d.get("evalue"),
            score=d.get("score"),
        )
        for d in result.get("domains", [])
    ]

    message = f"Found {len(domains)} domains via local HMMER + Pfam"

    return DomainSearchResult(
        gene_id=gene_id,
        protein_id=protein_id,
        protein_length=protein_length,
        success=True,
        domains=domains,
        message=message,
        method="local_hmmer"
    )
