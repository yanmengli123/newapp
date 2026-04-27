"""
GO Enrichment API Routes
POST /go-enrichment/analyze
GET  /go-enrichment/example-sets
GET  /go-enrichment/term/{go_id}
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from typing import Literal, Optional
from backend.go_enrichment_service import GOEnrichmentAnalyzer, EnrichmentParams

router = APIRouter(prefix="/go-enrichment", tags=["GO Enrichment"])

VALID_NAMESPACES = {"all", "biological_process", "cellular_component", "molecular_function"}
VALID_CORRECTIONS = {"bh", "by", "bonferroni", "none"}
VALID_ANNOTATION_MODES = {"direct"}


class AnalyzeRequest(BaseModel):
    gene_list: list[str] = Field(..., description="输入基因列表，支持 NCBI Gene ID / symbol / gene_id")
    correction: Literal["bh", "by", "bonferroni", "none"] = Field(default="bh")
    fdr_cutoff: float = Field(default=0.05, ge=0, le=1)
    min_overlap: int = Field(default=2, ge=1)
    namespace: Literal["all", "biological_process", "cellular_component", "molecular_function"] = Field(default="all")
    annotation_mode: Literal["direct"] = Field(default="direct")

    @field_validator("correction")
    @classmethod
    def validate_correction(cls, v: str) -> str:
        if v not in VALID_CORRECTIONS:
            raise ValueError(f"correction must be one of: {', '.join(sorted(VALID_CORRECTIONS))}")
        return v

    @field_validator("namespace")
    @classmethod
    def validate_namespace(cls, v: str) -> str:
        if v not in VALID_NAMESPACES:
            raise ValueError(f"namespace must be one of: {', '.join(sorted(VALID_NAMESPACES))}")
        return v

    @field_validator("annotation_mode")
    @classmethod
    def validate_annotation_mode(cls, v: str) -> str:
        if v not in VALID_ANNOTATION_MODES:
            raise ValueError(f"annotation_mode must be one of: {', '.join(sorted(VALID_ANNOTATION_MODES))}")
        return v


class MappingRecordOut(BaseModel):
    input_id: str
    resolved_gene_id: Optional[str]
    ncbi_gene_id: Optional[str]
    gene_symbol: Optional[str]
    status: str


class ResultOut(BaseModel):
    go_id: str
    term_name: str
    namespace: str
    ontology: str
    query_count: int
    query_total: int
    background_count: int
    background_total: int
    gene_ratio: str
    background_ratio: str
    p_value: float
    fdr: float
    significant: bool
    hit_genes: list[str]
    hit_ncbi_ids: list[str]
    hit_symbols: list[str]


class AnalyzeResponse(BaseModel):
    query_count: int
    mapped_count: int
    annotated_count: int
    background_count: int
    tested_term_count: int
    significant_count: int
    annotation_source: str
    annotation_mode: str
    background_mode: str
    parameters: dict
    ontology_stats: dict
    mapping: list[MappingRecordOut]
    results: list[ResultOut]
    bar_chart_data: dict


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_enrichment(req: AnalyzeRequest, request: Request):
    if not req.gene_list:
        raise HTTPException(status_code=400, detail="gene_list cannot be empty")

    if len(req.gene_list) > 5000:
        raise HTTPException(status_code=400, detail="gene_list cannot exceed 5000")

    pg_getconn = request.app.state.pg_getconn
    pg_putconn = request.app.state.pg_putconn

    params = EnrichmentParams(
        correction=req.correction,
        fdr_cutoff=req.fdr_cutoff,
        min_overlap=req.min_overlap,
        namespace=req.namespace,
        annotation_mode=req.annotation_mode,
    )

    analyzer = GOEnrichmentAnalyzer()
    try:
        result = analyzer.analyze(req.gene_list, params, pg_getconn, pg_putconn)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return AnalyzeResponse(
        query_count=result.query_count,
        mapped_count=result.mapped_count,
        annotated_count=result.annotated_count,
        background_count=result.background_count,
        tested_term_count=result.tested_term_count,
        significant_count=result.significant_count,
        annotation_source=result.annotation_source,
        annotation_mode=result.annotation_mode,
        background_mode=result.background_mode,
        parameters=result.parameters,
        ontology_stats=result.ontology_stats,
        mapping=[
            MappingRecordOut(
                input_id=r.input_id,
                resolved_gene_id=r.resolved_gene_id,
                ncbi_gene_id=r.ncbi_gene_id,
                gene_symbol=r.gene_symbol,
                status=r.status,
            )
            for r in result.mapping
        ],
        results=[
            ResultOut(
                go_id=t.go_id,
                term_name=t.term_name,
                namespace=t.namespace,
                ontology=t.ontology,
                query_count=t.query_count,
                query_total=t.query_total,
                background_count=t.background_count,
                background_total=t.background_total,
                gene_ratio=t.gene_ratio,
                background_ratio=t.background_ratio,
                p_value=t.p_value,
                fdr=t.fdr,
                significant=t.significant,
                hit_genes=t.hit_genes,
                hit_ncbi_ids=t.hit_ncbi_ids,
                hit_symbols=t.hit_symbols,
            )
            for t in result.results
        ],
        bar_chart_data=result.bar_chart_data,
    )


@router.get("/example-sets")
async def get_example_sets(request: Request):
    """动态生成示例基因集，从数据库选取 GO 注释丰富的真实基因"""
    pg_getconn = request.app.state.pg_getconn
    pg_putconn = request.app.state.pg_putconn

    conn = pg_getconn()
    try:
        cur = conn.cursor()

        # 选 GO 注释丰富的基因，分 4 组（限制为有 ncbi_gene_id 的基因，与 SEA 背景一致）
        cur.execute("""
            SELECT gx.gene_id, gx.gene_symbol, COUNT(DISTINCT gt.go_namespace) as ns_count
            FROM gene_xref gx
            JOIN gene_go gg ON gg.gene_id = gx.gene_id
            JOIN go_term gt ON gt.go_id = gg.go_id
            WHERE gx.gene_symbol IS NOT NULL AND gx.ncbi_gene_id IS NOT NULL
            GROUP BY gx.gene_id, gx.gene_symbol
            HAVING COUNT(DISTINCT gt.go_namespace) >= 2
            ORDER BY RANDOM()
            LIMIT 80
        """)
        rows = cur.fetchall()
        cur.close()

        genes = [r[1] for r in rows if r[1]][:80]

        # 分成 4 组
        chunk_size = len(genes) // 4
        sets = [
            {"name": "Example Set 1", "description": "Random genes with GO annotations (set 1)", "genes": genes[:chunk_size]},
            {"name": "Example Set 2", "description": "Random genes with GO annotations (set 2)", "genes": genes[chunk_size:2*chunk_size]},
            {"name": "Example Set 3", "description": "Random genes with GO annotations (set 3)", "genes": genes[2*chunk_size:3*chunk_size]},
            {"name": "Example Set 4", "description": "Random genes with GO annotations (set 4)", "genes": genes[3*chunk_size:]},
        ]

        return {"sets": [s for s in sets if s["genes"]]}

    finally:
        pg_putconn(conn)


@router.get("/term/{go_id}")
async def get_go_term(go_id: str, request: Request):
    """获取单个 GO term 详情"""
    pg_getconn = request.app.state.pg_getconn
    pg_putconn = request.app.state.pg_putconn

    conn = pg_getconn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT go_id, go_name, go_namespace, go_definition FROM go_term WHERE go_id = %s",
            (go_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"GO term {go_id} not found")

        term_name, namespace, definition = row[1], row[2], row[3]

        cur.execute(
            "SELECT gene_id, ncbi_gene_id::text, gene_symbol FROM gene_xref "
            "WHERE gene_id IN (SELECT gene_id FROM gene_go WHERE go_id = %s) "
            "AND ncbi_gene_id IS NOT NULL",
            (go_id,)
        )
        genes = [{"gene_id": r[0], "ncbi_id": r[1], "symbol": r[2]} for r in cur.fetchall()]

        cur.close()

        return {
            "go_id": go_id,
            "term_name": term_name,
            "namespace": namespace,
            "definition": definition or "",
            "total_genes": len(genes),
            "genes": genes,
        }

    finally:
        pg_putconn(conn)