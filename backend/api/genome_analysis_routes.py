"""Genome analysis API routes."""

import json
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from config import GRCG6A_SAMPLE_RESULTS

logger = logging.getLogger("grcg6a_fastapi_backend.genome_analysis")

router = APIRouter(prefix="/genome-api", tags=["Genome Analysis"])


class AnalysisRequest(BaseModel):
    """Optional request body for genome analysis job."""
    # All fields are optional - defaults are used when omitted
    pass


@router.get("/health")
async def genome_health():
    """Health check for genome analysis module."""
    return {
        "status": "healthy",
        "module": "genome_analysis",
        "version": "1.0.0",
    }


@router.post("/files/scan")
async def scan_genome_files():
    """
    Scan for genome files in the data directory.

    Scans for the 5 core genome files:
    - genomic (genome sequence)
    - gff (annotation)
    - cds (CDS sequences)
    - protein (protein sequences)
    - rna (RNA sequences)
    """
    from genome_analysis.file_discovery import genome_file_discovery
    return genome_file_discovery.scan()


@router.get("/files")
async def list_genome_files():
    """Get information about available genome files."""
    from genome_analysis.file_discovery import genome_file_discovery
    return genome_file_discovery.scan()


@router.post("/analysis/run")
async def run_analysis(
    background_tasks: BackgroundTasks,
    body: Optional[AnalysisRequest] = None,
):
    """
    Submit a new genome analysis job.

    The analysis runs in the background and includes:
    - Genome file scanning
    - GFF annotation analysis
    - CDS sequence analysis
    - Protein sequence analysis
    - RNA sequence analysis
    - Cross-file consistency checks
    - Chart generation (PNG, SVG, HTML, JSON)
    - Table export (CSV, XLSX)
    """
    from genome_analysis.task_manager import genome_task_manager
    from genome_analysis.analyzer import run_genome_analysis

    job = genome_task_manager.create_job()
    background_tasks.add_task(run_genome_analysis, job["job_id"])

    return {
        "success": True,
        "job_id": job["job_id"],
        "message": "Genome analysis job submitted",
        "status_url": f"/genome/jobs/{job['job_id']}",
    }


@router.get("/jobs/{job_id}")
async def get_job_status(job_id: str):
    """Get the status of a genome analysis job."""
    from genome_analysis.task_manager import genome_task_manager

    job = genome_task_manager.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    return job


@router.get("/jobs")
async def list_jobs():
    """List all genome analysis jobs."""
    from genome_analysis.task_manager import genome_task_manager
    return {
        "success": True,
        "jobs": genome_task_manager.list_jobs(),
    }


@router.get("/jobs/{job_id}/result")
async def get_analysis_result(job_id: str):
    """Get complete analysis results for a job."""
    from genome_analysis.task_manager import genome_task_manager

    job = genome_task_manager.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    if job["status"] != "success":
        raise HTTPException(
            status_code=400,
            detail=f"Job {job_id} is not complete (status: {job['status']})"
        )

    result_file = Path(job["output_dir"]) / "result" / "analysis_results.json"
    if not result_file.exists():
        raise HTTPException(status_code=404, detail="Results file not found")

    with open(result_file, "r", encoding="utf-8") as f:
        results = json.load(f)

    return {
        "success": True,
        "job_id": job_id,
        "results": results,
    }


@router.get("/jobs/{job_id}/result/{module_name}")
async def get_module_result(job_id: str, module_name: str):
    """Get results for a specific analysis module."""
    from genome_analysis.task_manager import genome_task_manager

    job = genome_task_manager.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    # 统一返回 400：job 未完成时不返回 404
    if job["status"] == "running":
        raise HTTPException(
            status_code=400,
            detail=f"Job {job_id} is still running (status: {job['status']})"
        )

    result_file = Path(job["output_dir"]) / "result" / "analysis_results.json"
    if not result_file.exists():
        raise HTTPException(status_code=404, detail="Results file not found")

    with open(result_file, "r", encoding="utf-8") as f:
        results = json.load(f)

    if module_name not in results:
        raise HTTPException(
            status_code=404,
            detail=f"Module {module_name} not found"
        )

    return {
        "success": True,
        "job_id": job_id,
        "module": module_name,
        "results": results[module_name],
    }


@router.get("/jobs/{job_id}/downloads")
async def get_download_index(job_id: str):
    """
    Get complete download index for a job.

    Returns all downloadable files organized by category:
    - charts: PNG, SVG, HTML, JSON chart files
    - tables: CSV, XLSX table files
    - result: Analysis result JSON files
    - metadata: Job metadata files
    """
    from genome_analysis.task_manager import genome_task_manager

    job = genome_task_manager.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    output_dir = Path(job["output_dir"])
    downloads = {
        "charts": [],
        "tables": [],
        "result": [],
        "metadata": [],
    }

    # Scan charts
    charts_dir = output_dir / "charts"
    if charts_dir.exists():
        for chart_file in sorted(charts_dir.glob("*.json")):
            chart_key = chart_file.stem
            files = {}
            for fmt in ["png", "svg", "html", "json"]:
                fmt_file = charts_dir / f"{chart_key}.{fmt}"
                if fmt_file.exists():
                    files[fmt] = f"/genome/download/{job_id}/charts/{chart_key}.{fmt}"
            if files:
                downloads["charts"].append({
                    "chart_key": chart_key,
                    "title": chart_key.replace("_", " ").title(),
                    "files": files,
                })

    # Scan tables
    tables_dir = output_dir / "tables"
    if tables_dir.exists():
        for table_file in sorted(tables_dir.glob("*.csv")):
            table_name = table_file.stem
            files = {}
            for fmt in ["csv", "xlsx"]:
                fmt_file = tables_dir / f"{table_name}.{fmt}"
                if fmt_file.exists():
                    files[fmt] = f"/genome/download/{job_id}/tables/{table_name}.{fmt}"
            if files:
                downloads["tables"].append({
                    "name": table_name,
                    "title": table_name.replace("_", " ").title(),
                    "files": files,
                })

    # Scan result
    result_dir = output_dir / "result"
    if result_dir.exists():
        for result_file in sorted(result_dir.glob("*.json")):
            downloads["result"].append({
                "name": result_file.stem,
                "files": {
                    "json": f"/genome/download/{job_id}/result/{result_file.name}"
                },
            })

    # Scan metadata
    metadata_dir = output_dir / "metadata"
    if metadata_dir.exists():
        for meta_file in sorted(metadata_dir.glob("*.json")):
            downloads["metadata"].append({
                "name": meta_file.stem,
                "files": {
                    "json": f"/genome/download/{job_id}/metadata/{meta_file.name}"
                },
            })

    return {
        "success": True,
        "job_id": job_id,
        "downloads": downloads,
    }


# =============================================================================
# Carousel endpoints
# =============================================================================
@router.get("/carousel")
async def get_carousel():
    """
    Get the homepage carousel manifest.

    Returns the manifest.json from public/genome_carousel/ directory.
    Contains metadata for all featured carousel images with dimensions 1600x900.
    """
    from genome_analysis.carousel_service import get_carousel_manifest, list_carousel_files

    manifest = get_carousel_manifest()
    if manifest is None:
        raise HTTPException(
            status_code=404,
            detail="No carousel manifest found. Please run an analysis job first."
        )

    files = list_carousel_files()

    return {
        "success": True,
        "manifest": manifest,
        "files": files,
    }


@router.get("/carousel/images")
async def list_carousel_images():
    """List all available carousel image files."""
    from genome_analysis.carousel_service import list_carousel_files

    files = list_carousel_files()
    return {
        "success": True,
        "count": len(files),
        "images": files,
    }


@router.get("/download/public/carousel/{filename}")
async def download_carousel_file(filename: str):
    """
    Download a public carousel image.

    Args:
        filename: Carousel image filename (e.g., featured_01_assembly_contig_length_bar.png)
    """
    from genome_analysis.carousel_service import get_carousel_dir

    carousel_dir = get_carousel_dir()
    file_path = carousel_dir / filename

    # Security check - prevent path traversal
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")

    ext = file_path.suffix.lower()
    media_types = {
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".json": "application/json",
    }
    media_type = media_types.get(ext, "application/octet-stream")

    return FileResponse(file_path, media_type=media_type, filename=filename)


@router.get("/download/{job_id}/{category}/{filename}")
async def download_file(job_id: str, category: str, filename: str):
    """
    Download a specific file.

    Args:
        job_id: The job ID
        category: One of: charts, tables, result, metadata
        filename: The filename to download
    """
    from genome_analysis.task_manager import genome_task_manager

    valid_categories = ["charts", "tables", "result", "metadata"]
    if category not in valid_categories:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category. Must be one of: {valid_categories}"
        )

    job = genome_task_manager.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    output_dir = Path(job["output_dir"])
    file_path = output_dir / category / filename

    # Security check
    try:
        file_resolved = file_path.resolve()
        output_resolved = output_dir.resolve()
        if not str(file_resolved).startswith(str(output_resolved)):
            raise HTTPException(status_code=403, detail="Access denied")
    except Exception:
        raise HTTPException(status_code=403, detail="Access denied")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")

    ext = file_path.suffix.lower()
    media_types = {
        ".json": "application/json",
        ".csv": "text/csv",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".html": "text/html",
    }
    media_type = media_types.get(ext, "application/octet-stream")

    return FileResponse(file_path, media_type=media_type, filename=filename)


@router.get("/charts/{job_id}/{chart_key}/json")
async def get_chart_json(job_id: str, chart_key: str):
    """Get Plotly JSON for a specific chart."""
    from genome_analysis.task_manager import genome_task_manager

    job = genome_task_manager.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    chart_file = Path(job["output_dir"]) / "charts" / f"{chart_key}.json"
    if not chart_file.exists():
        raise HTTPException(status_code=404, detail=f"Chart {chart_key} not found")

    return FileResponse(chart_file, media_type="application/json", filename=f"{chart_key}.json")


@router.get("/charts/{job_id}/{chart_key}/html")
async def get_chart_html(job_id: str, chart_key: str):
    """Get standalone HTML for a specific chart."""
    from genome_analysis.task_manager import genome_task_manager

    job = genome_task_manager.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    chart_file = Path(job["output_dir"]) / "charts" / f"{chart_key}.html"
    if not chart_file.exists():
        raise HTTPException(status_code=404, detail=f"Chart {chart_key} not found")

    return FileResponse(chart_file, media_type="text/html", filename=f"{chart_key}.html")


# =============================================================================
# Sample / Pre-generated Results Endpoints
# Serves content from GRCG6A_SAMPLE_RESULTS without running analysis
# =============================================================================

@router.get("/sample/status")
async def get_sample_status():
    """Check if pre-generated sample results are available."""
    results_dir = GRCG6A_SAMPLE_RESULTS
    charts_dir = results_dir / "charts"
    chart_count = 0
    if charts_dir.exists():
        chart_count = len(list(charts_dir.glob("*.html")))

    return {
        "available": results_dir.exists() and (results_dir / "result").exists(),
        "has_charts": chart_count > 0,
        "chart_count": chart_count,
        "results_dir": str(results_dir),
    }


@router.get("/sample/result")
async def get_sample_result():
    """Get pre-generated analysis results."""
    result_file = GRCG6A_SAMPLE_RESULTS / "result" / "analysis_results.json"
    if not result_file.exists():
        raise HTTPException(status_code=404, detail="Sample results not found")

    with open(result_file, "r", encoding="utf-8") as f:
        results = json.load(f)

    return {
        "success": True,
        "job_id": "sample",
        "is_sample": True,
        "results": results,
    }


@router.get("/sample/downloads")
async def get_sample_downloads():
    """Get download index for pre-generated sample results."""
    results_dir = GRCG6A_SAMPLE_RESULTS
    downloads = {
        "charts": [],
        "tables": [],
        "result": [],
        "metadata": [],
    }

    # Scan charts
    charts_dir = results_dir / "charts"
    if charts_dir.exists():
        for chart_file in sorted(charts_dir.glob("*.json")):
            chart_key = chart_file.stem
            files = {}
            for fmt in ["png", "svg", "html", "json"]:
                fmt_file = charts_dir / f"{chart_key}.{fmt}"
                if fmt_file.exists():
                    files[fmt] = f"/genome/sample/charts/{chart_key}/{fmt}"
            if files:
                downloads["charts"].append({
                    "chart_key": chart_key,
                    "title": chart_key.replace("_", " ").title(),
                    "files": files,
                })

    # Scan tables
    tables_dir = results_dir / "tables"
    if tables_dir.exists():
        for table_file in sorted(tables_dir.glob("*.csv")):
            table_name = table_file.stem
            files = {}
            for fmt in ["csv", "xlsx"]:
                fmt_file = tables_dir / f"{table_name}.{fmt}"
                if fmt_file.exists():
                    files[fmt] = f"/genome/sample/tables/{table_name}/{fmt}"
            if files:
                downloads["tables"].append({
                    "name": table_name,
                    "title": table_name.replace("_", " ").title(),
                    "files": files,
                })

    # Scan result
    result_dir = results_dir / "result"
    if result_dir.exists():
        for result_file in sorted(result_dir.glob("*.json")):
            downloads["result"].append({
                "name": result_file.stem,
                "files": {"json": f"/genome/sample/result/{result_file.name}"},
            })

    # Scan metadata
    metadata_dir = results_dir / "metadata"
    if metadata_dir.exists():
        for meta_file in sorted(metadata_dir.glob("*.json")):
            downloads["metadata"].append({
                "name": meta_file.stem,
                "files": {"json": f"/genome/sample/metadata/{meta_file.name}"},
            })

    return {
        "success": True,
        "job_id": "sample",
        "is_sample": True,
        "downloads": downloads,
    }


@router.get("/sample/charts/{chart_key}/{fmt}")
async def get_sample_chart(chart_key: str, fmt: str):
    """Serve a chart file from sample results."""
    media_types = {
        "html": "text/html",
        "json": "application/json",
        "png": "image/png",
        "svg": "image/svg+xml",
    }
    if fmt not in media_types:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {fmt}")

    chart_file = GRCG6A_SAMPLE_RESULTS / "charts" / f"{chart_key}.{fmt}"
    if not chart_file.exists():
        raise HTTPException(status_code=404, detail=f"Chart {chart_key}.{fmt} not found")

    return FileResponse(chart_file, media_type=media_types[fmt], filename=f"{chart_key}.{fmt}")


@router.get("/sample/tables/{table_name}/{fmt}")
async def get_sample_table(table_name: str, fmt: str):
    """Serve a table file from sample results."""
    media_types = {
        "csv": "text/csv",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "json": "application/json",
    }
    if fmt not in media_types:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {fmt}")

    table_file = GRCG6A_SAMPLE_RESULTS / "tables" / f"{table_name}.{fmt}"
    if not table_file.exists():
        raise HTTPException(status_code=404, detail=f"Table {table_name}.{fmt} not found")

    return FileResponse(table_file, media_type=media_types[fmt], filename=f"{table_name}.{fmt}")


@router.get("/sample/{category}/{filename}")
async def get_sample_file(category: str, filename: str):
    """Serve arbitrary files from sample results (result/, metadata/)."""
    allowed_categories = {"result", "metadata"}
    if category not in allowed_categories:
        raise HTTPException(status_code=403, detail="Category not allowed")

    safe_filename = Path(filename).name
    file_path = GRCG6A_SAMPLE_RESULTS / category / safe_filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(file_path, media_type="application/json", filename=safe_filename)
