"""
Primer3 引物设计工具
从基因组序列提取基因区域并设计引物
"""
import gzip
import logging
from pathlib import Path
from typing import Optional

from Bio import SeqIO
from primer3 import design_primers
from pydantic import BaseModel, Field

from genome_analysis.file_discovery import GenomeFileDiscovery

logger = logging.getLogger(__name__)

# 基因组文件路径 — 动态查找，不硬编码文件名
_genome_file_discovery = GenomeFileDiscovery()

def _get_genomic_fna() -> Path | None:
    """从 file_discovery 查找基因组 FASTA 文件路径。"""
    return _genome_file_discovery.get_file("genomic")


class Primer3Request(BaseModel):
    """引物设计请求"""
    gene_id: str = Field(..., description="基因 ID，如 gene-A4GALT")
    include_flank: int = Field(default=100, ge=0, le=500, description="基因上下游扩增的侧翼序列长度")
    product_size_range: tuple[int, int] = Field(
        default=(150, 300),
        description="预期产物大小范围 (min, max)"
    )
    num_primers: int = Field(default=5, ge=1, le=10, description="设计的引物对数量")


class PrimerResult(BaseModel):
    """单对引物结果"""
    primer_num: int
    forward_seq: str
    reverse_seq: str
    forward_tm: float
    reverse_tm: float
    product_size: int
    forward_start: int
    forward_end: int
    reverse_start: int
    reverse_end: int


def extract_gene_sequence(
    gene_id: str,
    gff_db,
    include_flank: int = 100
) -> tuple[Optional[str], Optional[dict]]:
    """
    从基因组序列中提取基因区域
    """
    try:
        gene = gff_db[gene_id]
    except Exception:
        logger.warning(f"Gene not found: {gene_id}")
        return None, None

    if gene.featuretype != "gene":
        logger.warning(f"Not a gene feature: {gene_id}")
        return None, None

    seqid = gene.seqid
    start = max(1, gene.start - include_flank)
    end = gene.end + include_flank

    genomic_fna = _get_genomic_fna()
    if genomic_fna is None:
        logger.error(f"Genomic FASTA file not found in {_genome_file_discovery.data_dir}")
        return None, None

    try:
        with gzip.open(genomic_fna, "rt") as handle:
            for record in SeqIO.parse(handle, "fasta"):
                if record.id == seqid:
                    seq = str(record.seq[start - 1:end])
                    gene_info = {
                        "gene_id": gene_id,
                        "seqid": seqid,
                        "gene_start": gene.start,
                        "gene_end": gene.end,
                        "strand": gene.strand,
                        "region_start": start,
                        "region_end": end,
                        "region_length": len(seq),
                    }
                    return seq, gene_info
    except Exception as e:
        logger.error(f"Failed to read genomic fna: {e}")
        return None, None

    return None, None


def design_primers_for_gene(
    gene_id: str,
    gff_db,
    product_size_range: tuple[int, int] = (150, 300),
    num_primers: int = 5,
    include_flank: int = 100,
) -> dict:
    """
    为基因设计引物
    """
    seq, gene_info = extract_gene_sequence(gene_id, gff_db, include_flank)

    if seq is None:
        return {
            "success": False,
            "gene_id": gene_id,
            "error": f"Failed to extract sequence for gene {gene_id}",
        }

    seq_args = {
        "SEQUENCE_ID": gene_id,
        "SEQUENCE_TEMPLATE": seq,
        "SEQUENCE_INCLUDED_REGION": [0, len(seq)],
    }

    global_args = {
        "PRIMER_NUM_RETURN": num_primers,
        "PRIMER_MIN_SIZE": 18,
        "PRIMER_OPT_SIZE": 20,
        "PRIMER_MAX_SIZE": 25,
        "PRIMER_MIN_TM": 57.0,
        "PRIMER_OPT_TM": 60.0,
        "PRIMER_MAX_TM": 63.0,
        "PRIMER_MIN_GC": 40.0,
        "PRIMER_MAX_GC": 60.0,
        "PRIMER_PRODUCT_SIZE_RANGE": [product_size_range],
    }

    try:
        result = design_primers(seq_args, global_args)
        primers = []

        pair_num = result.get("PRIMER_PAIR_NUM_RETURNED", 0)
        if pair_num == 0:
            return {
                "success": False,
                "gene_id": gene_id,
                "error": "No primers found. Try adjusting parameters (product size range, flanking region, etc.)",
                "gene_info": gene_info,
            }

        for i in range(min(num_primers, pair_num)):
            left_seq = result.get(f"PRIMER_LEFT_{i}_SEQUENCE", "")
            right_seq = result.get(f"PRIMER_RIGHT_{i}_SEQUENCE", "")
            left_pos = result.get(f"PRIMER_LEFT_{i}", [0, 0])
            right_pos = result.get(f"PRIMER_RIGHT_{i}", [0, 0])
            left_tm = result.get(f"PRIMER_LEFT_{i}_TM", 0.0)
            right_tm = result.get(f"PRIMER_RIGHT_{i}_TM", 0.0)
            product_size = result.get(f"PRIMER_PAIR_{i}_PRODUCT_SIZE", 0)

            if left_seq and right_seq:
                primers.append(PrimerResult(
                    primer_num=i + 1,
                    forward_seq=left_seq,
                    reverse_seq=right_seq,
                    forward_tm=left_tm if isinstance(left_tm, float) else (left_tm[0] if left_tm else 0),
                    reverse_tm=right_tm if isinstance(right_tm, float) else (right_tm[0] if right_tm else 0),
                    product_size=product_size if isinstance(product_size, int) else (product_size[0] if product_size else 0),
                    forward_start=gene_info["region_start"] + left_pos[0],
                    forward_end=gene_info["region_start"] + left_pos[0] + len(left_seq) - 1,
                    reverse_start=gene_info["region_start"] + right_pos[0] - len(right_seq) + 1,
                    reverse_end=gene_info["region_start"] + right_pos[0],
                ))

        return {
            "success": True,
            "gene_id": gene_id,
            "gene_info": gene_info,
            "sequence_length": len(seq),
            "num_primers_found": len(primers),
            "primers": [p.model_dump() for p in primers],
        }

    except Exception as e:
        logger.error(f"Primer3 design failed: {e}")
        return {
            "success": False,
            "gene_id": gene_id,
            "error": str(e),
        }
