"""Output directory configuration for genome analysis."""

from pathlib import Path

from backend.config import GRCG6A_GENOME_OUTPUT

# Base output directory
OUTPUT_BASE = GRCG6A_GENOME_OUTPUT

# Job-specific output subdirectories
JOBS_DIR = OUTPUT_BASE / "jobs"

# Public carousel directory for featured images
PUBLIC_CAROUSEL_DIR = OUTPUT_BASE / "public" / "genome_carousel"

# Carousel image dimensions (16:9 for React carousel)
CAROUSEL_WIDTH = 1600
CAROUSEL_HEIGHT = 900

# Featured carousel image keys (in order)
FEATURED_CAROUSEL_KEYS = [
    "assembly_contig_length_bar",
    "gff_feature_type_bar",
    "gene_length_distribution",
    "cds_start_codon_bar",
    "protein_length_distribution",
]

FEATURED_CAROUSEL_TITLES = {
    "assembly_contig_length_bar": "组装序列长度分布",
    "gff_feature_type_bar": "GFF 特征类型统计",
    "gene_length_distribution": "基因长度分布",
    "cds_start_codon_bar": "CDS 起始密码子分析",
    "protein_length_distribution": "蛋白质长度分布",
}

FEATURED_CAROUSEL_DESCRIPTIONS = {
    "assembly_contig_length_bar": "展示基因组组装的最长序列(contig/chromosome)长度分布",
    "gff_feature_type_bar": "统计GFF注释文件中各特征类型的数量分布",
    "gene_length_distribution": "展示基因长度的频率分布直方图",
    "cds_start_codon_bar": "分析CDS序列的起始密码子使用频率",
    "protein_length_distribution": "展示蛋白质序列长度的分布统计",
}


def ensure_output_dirs():
    """Create all required output directories."""
    (OUTPUT_BASE / "public" / "genome_carousel").mkdir(parents=True, exist_ok=True)
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
