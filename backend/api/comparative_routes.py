"""
Comparative Genomics API Routes
Provides endpoints for synteny, coordinate mapping, and cross-assembly analysis
"""

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import PlainTextResponse
from typing import Optional, Literal

from backend.config import GRCG6A_RAWDATA_ROOT

router = APIRouter(prefix="/comparative", tags=["Comparative Genomics"])

# Service instance (set during app startup)
_service = None


def set_service(service):
    global _service
    _service = service


def get_service():
    if _service is None:
        raise HTTPException(status_code=503, detail="Comparative service not initialized")
    return _service


@router.get("/assemblies")
async def list_assemblies():
    """List all available genome assemblies"""
    service = get_service()
    assemblies = service.list_assemblies()
    return {"assemblies": assemblies}


@router.get("/assemblies/{assembly_name}")
async def get_assembly_info(assembly_name: str):
    """Get detailed assembly information"""
    service = get_service()
    info = service.get_assembly_info(assembly_name)
    if not info:
        raise HTTPException(status_code=404, detail=f"Assembly {assembly_name} not found")
    return info


@router.get("/chromosome-mapping")
async def get_chromosome_mapping(
    assembly_from: str = Query("GRCg6a"),
    assembly_to: str = Query("GRCg7b")
):
    """Get chromosome-level mapping between assemblies"""
    service = get_service()
    mapping = service.get_chromosome_mapping(assembly_from, assembly_to)
    return {"mapping": mapping, "count": len(mapping)}


@router.get("/synteny")
async def get_synteny_blocks(
    assembly_1: str = Query("GRCg6a"),
    assembly_2: str = Query("GRCg7b"),
    chr_1: Optional[str] = Query(None),
    start_1: Optional[int] = Query(None),
    end_1: Optional[int] = Query(None),
    chr_2: Optional[str] = Query(None),
    min_score: float = Query(0.0),
    min_identity: float = Query(0.0),
    limit: int = Query(1000, le=5000)
):
    """Get synteny blocks between assemblies"""
    service = get_service()
    blocks = service.get_synteny_blocks(
        assembly_1, assembly_2, chr_1, start_1, end_1, chr_2,
        min_score, min_identity, limit
    )
    return {"blocks": blocks, "count": len(blocks)}


@router.get("/alignment-blocks")
async def get_alignment_blocks(
    assembly_1: str = Query("GRCg6a"),
    assembly_2: str = Query("GRCg7b"),
    mode: Literal["natural", "windowed"] = Query("natural"),
    chr_1: Optional[str] = Query(None),
    chr_2: Optional[str] = Query(None),
    min_quality: int = Query(30, ge=0, le=255),
    min_identity: float = Query(85.0, ge=0.0, le=100.0),
    min_alignment_length: int = Query(50000, ge=0),
    limit: int = Query(5000, le=20000),
    order: Literal["coordinate", "score"] = Query("coordinate")
):
    """Get natural/windowed PAF alignment blocks for scientific synteny views."""
    service = get_service()
    blocks = service.get_alignment_blocks(
        assembly_1=assembly_1,
        assembly_2=assembly_2,
        mode=mode,
        chr_1=chr_1,
        chr_2=chr_2,
        min_quality=min_quality,
        min_identity=min_identity,
        min_alignment_length=min_alignment_length,
        limit=limit,
        order=order,
    )
    return {
        "mode": mode,
        "blocks": blocks,
        "count": len(blocks),
        "filters": {
            "min_quality": min_quality,
            "min_identity": min_identity,
            "min_alignment_length": min_alignment_length,
            "order": order,
        },
    }


@router.get("/alignment-stats")
async def get_alignment_stats(
    assembly_1: str = Query("GRCg6a"),
    assembly_2: str = Query("GRCg7b"),
    mode: Literal["natural", "windowed"] = Query("natural"),
    min_quality: int = Query(30, ge=0, le=255),
    min_identity: float = Query(85.0, ge=0.0, le=100.0),
    min_alignment_length: int = Query(50000, ge=0)
):
    """Get QC/statistics for a natural or windowed PAF alignment layer."""
    service = get_service()
    return service.get_alignment_stats(
        assembly_1=assembly_1,
        assembly_2=assembly_2,
        mode=mode,
        min_quality=min_quality,
        min_identity=min_identity,
        min_alignment_length=min_alignment_length,
    )


@router.get("/methods")
async def get_comparative_methods():
    """Get comparative synteny methods and provenance metadata."""
    service = get_service()
    return service.get_comparative_methods()


@router.get("/map")
async def map_coordinates(
    gene_id: str = Query(..., description="Gene ID"),
    assembly_from: str = Query("GRCg6a"),
    assembly_to: str = Query("GRCg7b")
):
    """Map gene coordinates between assemblies"""
    service = get_service()
    result = service.map_coordinates(gene_id, assembly_from, assembly_to)
    if not result:
        raise HTTPException(status_code=404, detail="Mapping not found")
    return result


@router.get("/genes-in-region")
async def get_genes_in_region(
    assembly: str = Query("GRCg6a"),
    chr: str = Query(..., description="Chromosome"),
    start: int = Query(..., description="Start position"),
    end: int = Query(..., description="End position")
):
    """Get genes in a genomic region"""
    service = get_service()
    genes = service.get_genes_in_region(assembly, chr, start, end)
    return {"genes": genes, "count": len(genes)}


@router.get("/dotplot")
async def get_dotplot_data(
    assembly_1: str = Query("GRCg6a"),
    assembly_2: str = Query("GRCg7b"),
    chr_1: Optional[str] = Query(None),
    chr_2: Optional[str] = Query(None),
    min_score: float = Query(50.0)
):
    """Get dotplot data for visualization"""
    service = get_service()
    data = service.get_dotplot_data(assembly_1, assembly_2, chr_1, chr_2, min_score)
    return {"data": data, "count": len(data)}


@router.get("/paf")
async def get_paf_alignments(
    assembly_1: str = Query("GRCg6a"),
    assembly_2: str = Query("GRCg7b"),
    mode: Literal["natural", "windowed"] = Query("natural"),
    query_chr: Optional[str] = Query(None),
    target_chr: Optional[str] = Query(None),
    min_quality: int = Query(30),
    min_alignment_length: int = Query(50000, ge=0),
    limit: int = Query(5000, le=20000)
):
    """Get PAF alignments for JBrowse2 SyntenyTrack"""
    service = get_service()
    if {assembly_1, assembly_2} == {"GRCg6a", "GRCg7b"}:
        alignments = service.get_alignment_blocks(
            assembly_1=assembly_1,
            assembly_2=assembly_2,
            mode=mode,
            chr_1=query_chr,
            chr_2=target_chr,
            min_quality=min_quality,
            min_alignment_length=min_alignment_length,
            limit=limit,
            order="coordinate",
        )
        return {"alignments": alignments, "count": len(alignments), "mode": mode}

    alignments = service.get_paf_alignments(
        assembly_1, assembly_2, query_chr, target_chr, min_quality, limit
    )
    return {"alignments": alignments, "count": len(alignments)}


@router.get("/paf/file", response_class=PlainTextResponse)
async def get_paf_file(
    assembly_1: str = Query("GRCg6a"),
    assembly_2: str = Query("GRCg7b"),
    mode: Literal["natural", "windowed"] = Query("natural"),
    min_quality: int = Query(30),
    min_identity: float = Query(85.0, ge=0.0, le=100.0),
    min_alignment_length: int = Query(50000, ge=0)
):
    """Get PAF file content for JBrowse2"""
    service = get_service()
    if {assembly_1, assembly_2} == {"GRCg6a", "GRCg7b"}:
        content = service.get_paf_file_content(
            assembly_1=assembly_1,
            assembly_2=assembly_2,
            mode=mode,
            min_quality=min_quality,
            min_identity=min_identity,
            min_alignment_length=min_alignment_length,
        )
        return PlainTextResponse(content, media_type="text/plain")

    alignments = service.get_paf_alignments(
        assembly_1, assembly_2, min_quality=min_quality, limit=100000
    )

    if not alignments and {assembly_1, assembly_2} == {"GRCg6a", "GRCg7b"}:
        fallback_paf = GRCG6A_RAWDATA_ROOT.parent / "synteny" / "grcg6a_vs_grcg7b.paf"
        if fallback_paf.exists():
            return PlainTextResponse(
                fallback_paf.read_text(encoding="utf-8", errors="replace"),
                media_type="text/plain",
            )

    # Convert to PAF format
    paf_lines = []
    for a in alignments:
        line = "\t".join([
            a['query_name'], str(a['query_length']),
            str(a['query_start']), str(a['query_end']),
            a['strand'],
            a['target_name'], str(a['target_length']),
            str(a['target_start']), str(a['target_end']),
            str(a['residue_matches']), str(a['alignment_length']),
            str(a['mapping_quality'])
        ])
        paf_lines.append(line)

    content = "\n".join(paf_lines)
    if content:
        content += "\n"
    return PlainTextResponse(content, media_type="text/plain")


@router.get("/stats")
async def get_comparison_stats(
    assembly_1: str = Query("GRCg6a"),
    assembly_2: str = Query("GRCg7b")
):
    """Get comprehensive comparison statistics"""
    service = get_service()
    stats = service.get_comparison_stats(assembly_1, assembly_2)
    return stats


@router.get("/orthologs")
async def get_ortholog_table(
    assembly_1: str = Query("GRCg6a"),
    assembly_2: str = Query("GRCg7b"),
    chr: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0)
):
    """Get ortholog table with pagination"""
    service = get_service()
    result = service.get_ortholog_table(assembly_1, assembly_2, chr, limit, offset)
    return result
