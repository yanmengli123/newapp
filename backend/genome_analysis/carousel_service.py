"""Carousel service: generates featured images for homepage carousel."""

import json
import logging
import shutil
from datetime import datetime
from pathlib import Path

logger = logging.getLogger("grcg6a_fastapi_backend.carousel_service")

# Carousel dimensions
CAROUSEL_WIDTH = 1600
CAROUSEL_HEIGHT = 900

# Featured image keys in order
FEATURED_KEYS = [
    "assembly_contig_length_bar",
    "gff_feature_type_bar",
    "gene_length_distribution",
    "cds_start_codon_bar",
    "protein_length_distribution",
]

# Featured image metadata
FEATURED_META = {
    "assembly_contig_length_bar": {
        "title": "组装序列长度分布",
        "description": "展示基因组组装的最长序列(contig/chromosome)长度分布",
    },
    "gff_feature_type_bar": {
        "title": "GFF 特征类型统计",
        "description": "统计GFF注释文件中各特征类型的数量分布",
    },
    "gene_length_distribution": {
        "title": "基因长度分布",
        "description": "展示基因长度的频率分布直方图",
    },
    "cds_start_codon_bar": {
        "title": "CDS 起始密码子分析",
        "description": "分析CDS序列的起始密码子使用频率",
    },
    "protein_length_distribution": {
        "title": "蛋白质长度分布",
        "description": "展示蛋白质序列长度的分布统计",
    },
}


def get_carousel_dir() -> Path:
    """Get the public carousel directory."""
    from genome_analysis.output_config import PUBLIC_CAROUSEL_DIR
    return PUBLIC_CAROUSEL_DIR


def generate_carousel_from_job(job_id: str, job_charts_dir: Path) -> dict:
    """
    Copy featured charts to public carousel directory.

    Args:
        job_id: The job ID
        job_charts_dir: Path to job's charts directory

    Returns:
        dict with generation results
    """
    carousel_dir = get_carousel_dir()
    carousel_dir.mkdir(parents=True, exist_ok=True)

    # Clean up old carousel images
    for f in carousel_dir.glob("featured_*.png"):
        f.unlink(missing_ok=True)

    results = []
    unavailable = []

    for i, key in enumerate(FEATURED_KEYS, 1):
        src_png = job_charts_dir / f"{key}.png"
        dst_name = f"featured_{i:02d}_{key}.png"
        dst_path = carousel_dir / dst_name

        if src_png.exists():
            try:
                shutil.copy2(src_png, dst_path)
                # Also copy SVG
                src_svg = job_charts_dir / f"{key}.svg"
                if src_svg.exists():
                    shutil.copy2(src_svg, dst_path.with_suffix(".svg"))
                results.append({
                    "order": i,
                    "key": key,
                    "filename": dst_name,
                    "status": "copied",
                })
                logger.info(f"Carousel: copied {key} -> {dst_name}")
            except Exception as e:
                logger.error(f"Failed to copy {key}: {e}")
                unavailable.append({"key": key, "reason": str(e), "order": i})
        else:
            unavailable.append({"key": key, "reason": "file not found", "order": i})
            logger.warning(f"Carousel: {key}.png not found in job charts")

    # Build manifest
    manifest = build_manifest(job_id, results, unavailable)
    manifest_path = carousel_dir / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    logger.info(f"Carousel manifest written: {manifest_path}")

    return {
        "job_id": job_id,
        "carousel_dir": str(carousel_dir),
        "featured_count": len(results),
        "unavailable": unavailable,
        "manifest": manifest,
    }


def build_manifest(job_id: str, results: list, unavailable: list) -> dict:
    """Build the carousel manifest.json."""
    items = []

    # Add available items
    for r in results:
        meta = FEATURED_META.get(r["key"], {})
        items.append({
            "order": r["order"],
            "key": r["key"],
            "title": meta.get("title", r["key"]),
            "description": meta.get("description", ""),
            "filename": r["filename"],
            "image_url": f"/genome/download/public/carousel/{r['filename']}",
            "target_url": f"/genome/jobs/{job_id}/result",
            "available": True,
        })

    # Add unavailable items
    for u in unavailable:
        meta = FEATURED_META.get(u["key"], {})
        items.append({
            "order": u["order"],
            "key": u["key"],
            "title": meta.get("title", u["key"]),
            "description": meta.get("description", ""),
            "filename": None,
            "image_url": None,
            "target_url": None,
            "available": False,
            "unavailable_reason": u.get("reason", "file not found"),
        })

    # Sort by order
    items.sort(key=lambda x: x["order"])

    return {
        "title": "GRCg6a 基因组分析轮播图",
        "subtitle": "鸡基因组 (GRCg6a) 综合分析结果",
        "job_id": job_id,
        "updated_at": datetime.now().isoformat(),
        "image_width": CAROUSEL_WIDTH,
        "image_height": CAROUSEL_HEIGHT,
        "aspect_ratio": "16:9",
        "total_items": len(FEATURED_KEYS),
        "available_count": len(results),
        "items": items,
    }


def get_carousel_manifest() -> dict:
    """Read and return the current carousel manifest."""
    manifest_path = get_carousel_dir() / "manifest.json"
    if manifest_path.exists():
        with open(manifest_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def list_carousel_files() -> list:
    """List all carousel image files."""
    carousel_dir = get_carousel_dir()
    files = []
    for f in sorted(carousel_dir.glob("featured_*.png")):
        files.append({
            "filename": f.name,
            "size_bytes": f.stat().st_size,
            "url": f"/genome/download/public/carousel/{f.name}",
        })
    return files
