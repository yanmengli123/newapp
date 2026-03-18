"""
工具路由
提供 Primer3 引物设计和 Domain Search 功能
"""
from fastapi import APIRouter, HTTPException, Request, Query

router = APIRouter(prefix="/tools", tags=["tools"])


def get_state(request: Request):
    """获取应用状态"""
    return request.app.state


@router.post("/primer3")
async def design_primers(
    request: Request,
    gene_id: str = Query(..., description="基因 ID，如 gene-A4GALT"),
    include_flank: int = Query(default=100, ge=0, le=500, description="基因上下游侧翼序列长度"),
    product_size_min: int = Query(default=150, ge=50, le=1000, description="最小产物大小"),
    product_size_max: int = Query(default=300, ge=50, le=1000, description="最大产物大小"),
    num_primers: int = Query(default=5, ge=1, le=10, description="设计的引物对数量"),
):
    """
    Primer3 引物设计

    根据基因 ID 从基因组序列中提取基因区域，使用 Primer3 设计引物对。
    """
    from tools.primer3_designer import design_primers_for_gene

    state = get_state(request)
    gff_db = state.gff

    if product_size_min > product_size_max:
        raise HTTPException(
            status_code=400,
            detail="product_size_min must be less than or equal to product_size_max"
        )

    result = design_primers_for_gene(
        gene_id=gene_id,
        gff_db=gff_db,
        product_size_range=(product_size_min, product_size_max),
        num_primers=num_primers,
        include_flank=include_flank,
    )

    if not result.get("success"):
        raise HTTPException(
            status_code=404,
            detail=result.get("error", f"Failed to design primers for {gene_id}")
        )

    return result


@router.post("/domain-search")
async def search_domains(
    request: Request,
    gene_id: str = Query(..., description="基因 ID，如 gene-A4GALT"),
):
    """
    Protein Domain 搜索

    根据基因 ID 获取蛋白序列，使用本地 HMMER + Pfam 搜索蛋白结构域。
    """
    from tools.domain_searcher import search_domains_for_gene

    state = get_state(request)
    sql_conn = state.sql

    result = search_domains_for_gene(
        gene_id=gene_id,
        sql_conn=sql_conn,
    )

    return result.model_dump()
