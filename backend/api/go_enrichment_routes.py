"""
GO Enrichment API Routes
POST /go-enrichment/analyze
GET  /go-enrichment/example-sets
GET  /go-enrichment/term/{go_id}
"""

import random
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from typing import Literal, Optional
from backend.go_enrichment_service import GOEnrichmentAnalyzer, EnrichmentParams, GODagNotReadyError

router = APIRouter(prefix="/go-enrichment", tags=["GO Enrichment"])

VALID_NAMESPACES = {"all", "biological_process", "cellular_component", "molecular_function"}
VALID_CORRECTIONS = {"bh", "by", "bonferroni", "none"}
VALID_ANNOTATION_MODES = {"direct", "propagated"}
VALID_EVIDENCE_FILTERS = {"all", "non_iea", "experimental"}


class AnalyzeRequest(BaseModel):
    gene_list: list[str] = Field(..., description="Input gene list, supports NCBI Gene ID / symbol / gene_id")
    correction: Literal["bh", "by", "bonferroni", "none"] = Field(default="bh")
    fdr_cutoff: float = Field(default=0.05, ge=0.001, le=0.5)
    min_overlap: int = Field(default=2, ge=1, le=100)
    namespace: Literal["all", "biological_process", "cellular_component", "molecular_function"] = Field(default="all")
    annotation_mode: Literal["direct", "propagated"] = Field(default="direct")
    evidence_filter: Literal["all", "non_iea", "experimental"] = Field(default="all")

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

    @field_validator("evidence_filter")
    @classmethod
    def validate_evidence_filter(cls, v: str) -> str:
        if v not in VALID_EVIDENCE_FILTERS:
            raise ValueError(f"evidence_filter must be one of: {', '.join(sorted(VALID_EVIDENCE_FILTERS))}")
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
    background_count: Optional[int]  # None when namespace="all"
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
        evidence_filter=req.evidence_filter,
    )

    analyzer = GOEnrichmentAnalyzer()
    try:
        result = analyzer.analyze(req.gene_list, params, pg_getconn, pg_putconn)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except GODagNotReadyError as e:
        raise HTTPException(status_code=503, detail=str(e))

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
    """Dynamically generate example gene sets from real shared-GO-term genes in the database."""
    pg_getconn = request.app.state.pg_getconn
    pg_putconn = request.app.state.pg_putconn

    conn = pg_getconn()
    try:
        cur = conn.cursor()

        # Step 1: randomly select 4 hub GO terms (30-600 direct-annotated genes each)
        # Use today's date as seed so same day is stable for reproducibility and screenshots
        import datetime
        today = datetime.date.today()
        # PostgreSQL setseed() accepts values in [-1, 1]
        # Map YYYYMMDD to a fraction by using day's position in 4-year leap cycle
        day_of_cycle = (today.toordinal() % 1461) / 1461.0  # 0.0 to 0.999
        cur.execute("SELECT setseed(%s)", (day_of_cycle,))
        cur.execute("""
            SELECT gg.go_id
            FROM gene_go gg
            JOIN gene_xref gx ON gx.gene_id = gg.gene_id
            WHERE gx.ncbi_gene_id IS NOT NULL AND gg.evidence_code != 'IEA'
            GROUP BY gg.go_id
            HAVING COUNT(DISTINCT gg.gene_id) >= 30 AND COUNT(DISTINCT gg.gene_id) <= 600
            ORDER BY RANDOM()
            LIMIT 4
        """)
        hub_go_ids = [r[0] for r in cur.fetchall()]

        # Step 2: for each hub, pick 20 genes (that hub GO term + ≥2 total direct GO terms)
        all_rows = []
        for hub_id in hub_go_ids:
            cur.execute("""
                SELECT sub.gene_symbol
                FROM (
                    SELECT gx.gene_symbol,
                           ROW_NUMBER() OVER (ORDER BY RANDOM()) as rn
                    FROM gene_go gg
                    JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                    WHERE gx.ncbi_gene_id IS NOT NULL
                      AND gg.evidence_code != 'IEA'
                      AND gg.gene_id IN (
                          SELECT gg2.gene_id
                          FROM gene_go gg2
                          JOIN gene_xref gx2 ON gx2.gene_id = gg2.gene_id
                          WHERE gx2.ncbi_gene_id IS NOT NULL AND gg2.evidence_code != 'IEA'
                          GROUP BY gg2.gene_id
                          HAVING COUNT(DISTINCT gg2.go_id) >= 2
                      )
                    AND gg.go_id = %s
                    GROUP BY gg.gene_id, gx.gene_symbol
                ) sub
                WHERE sub.rn <= 20
            """, (hub_id,))
            for row in cur.fetchall():
                all_rows.append((hub_id, row[0]))

        cur.close()

        # Group by go_id
        by_go = {}
        for go_id, symbol in all_rows:
            if go_id not in by_go:
                by_go[go_id] = []
            by_go[go_id].append(symbol)

        # Build sets (reusing the same connection)
        cur = conn.cursor()
        sets = []
        for i, (go_id, genes) in enumerate(by_go.items()):
            cur.execute("SELECT go_name FROM go_term WHERE go_id = %s", (go_id,))
            row = cur.fetchone()
            go_name = row[0] if row else go_id
            sets.append({
                "name": f"Example Set {i+1}",
                "description": f"Genes sharing GO:{go_id} — {go_name[:60]}",
                "genes": genes,
            })
        cur.close()

        return {"sets": [s for s in sets if s["genes"]]}

    finally:
        pg_putconn(conn)


@router.get("/term/{go_id}")
async def get_go_term(go_id: str, request: Request):
    """Get single GO term detail."""
    pg_getconn = request.app.state.pg_getconn
    pg_putconn = request.app.state.pg_putconn

    conn = pg_getconn()
    try:
        cur = conn.cursor()

        # Resolve alt_id → primary (same as /term/{go_id}/dag)
        cur.execute(
            "SELECT primary_go_id FROM go_alt_id WHERE alt_go_id = %s",
            (go_id,),
        )
        row = cur.fetchone()
        resolved_go_id = row[0] if row else go_id

        cur.execute(
            "SELECT go_id, go_name, go_namespace, go_definition FROM go_term WHERE go_id = %s",
            (resolved_go_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"GO term {go_id} not found")

        term_name, namespace, definition = row[1], row[2], row[3]

        cur.execute(
            "SELECT gene_id, ncbi_gene_id::text, gene_symbol FROM gene_xref "
            "WHERE gene_id IN (SELECT gene_id FROM gene_go WHERE go_id = %s) "
            "AND ncbi_gene_id IS NOT NULL",
            (resolved_go_id,)
        )
        genes = [{"gene_id": r[0], "ncbi_id": r[1], "symbol": r[2]} for r in cur.fetchall()]

        cur.close()

        return {
            "go_id": resolved_go_id,
            "input_go_id": go_id,
            "resolved_from_alt": go_id != resolved_go_id,
            "term_name": term_name,
            "namespace": namespace,
            "definition": definition or "",
            "total_genes": len(genes),
            "genes": genes,
        }

    finally:
        pg_putconn(conn)


# ---------------------------------------------------------------------------
# DAG sub-graph endpoints
# ---------------------------------------------------------------------------

from typing import Annotated


@router.get("/dag/metadata")
async def get_dag_metadata(request: Request):
    """Return GO DAG metadata: table load status, row counts, version."""
    pg_getconn = request.app.state.pg_getconn
    pg_putconn = request.app.state.pg_putconn
    conn = pg_getconn()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'go_closure'
            )
        """)
        exists = cur.fetchone()[0]
        if not exists:
            return {
                "ready": False, "term_count": 0, "edge_count": 0,
                "closure_count": 0, "data_version": None,
                "loaded_at": None, "include_part_of": None, "obo_path": None,
            }

        cur.execute("""
            SELECT key, value FROM go_dag_metadata
            WHERE key IN ('term_count','edge_count','closure_count',
                          'data_version','loaded_at','include_part_of','obo_path')
        """)
        meta = dict(cur.fetchall())

        cur.execute("SELECT COUNT(*) FROM go_closure LIMIT 1")
        closure_count = cur.fetchone()[0]

        return {
            "ready": closure_count > 0,
            "term_count": int(meta.get("term_count", 0)),
            "edge_count": int(meta.get("edge_count", 0)),
            "closure_count": closure_count,
            "data_version": meta.get("data_version"),
            "loaded_at": meta.get("loaded_at"),
            "include_part_of": meta.get("include_part_of"),
            "obo_path": meta.get("obo_path"),
        }
    finally:
        pg_putconn(conn)


class DagNode(BaseModel):
    id: str
    label: str
    namespace: str
    depth: int
    is_center: bool
    gene_count_direct: Optional[int] = None
    gene_count_propagated: Optional[int] = None


class DagEdge(BaseModel):
    source: str
    target: str
    relation: Literal["is_a", "part_of"]


class DagResponse(BaseModel):
    center: str
    resolved_center: str
    direction: str
    depth: int
    relations: list[str]
    nodes: list[DagNode]
    edges: list[DagEdge]
    truncated: bool
    node_count_total: int
    node_count_returned: int
    metadata: dict


@router.get("/term/{go_id}/dag", response_model=DagResponse)
async def get_go_term_dag(
    go_id: str,
    request: Request,
    direction: Annotated[Literal["ancestors", "descendants", "both"], ...] = "ancestors",
    depth: Annotated[int, "Maximum distance from center term"] = 3,
    include_is_a: bool = True,
    include_part_of: bool = True,
    max_nodes: Annotated[int, "Maximum nodes returned"] = 80,
):
    """
    Return GO DAG subgraph (via go_edge BFS).

    Uses go_edge instead of go_closure to collect nodes and edges,
    so include_is_a / include_part_of filters actually control which paths are expanded.
    gene_count_propagated is still computed via go_closure (relation-agnostic).
    """
    depth = max(1, min(6, depth))
    max_nodes = max(10, min(200, max_nodes))

    pg_getconn = request.app.state.pg_getconn
    pg_putconn = request.app.state.pg_putconn
    conn = pg_getconn()
    try:
        cur = conn.cursor()

        # Resolve alt_id → primary
        cur.execute(
            "SELECT primary_go_id FROM go_alt_id WHERE alt_go_id = %s",
            (go_id,),
        )
        row = cur.fetchone()
        resolved_center = row[0] if row else go_id

        # Verify term exists
        cur.execute(
            "SELECT go_name, go_namespace FROM go_term WHERE go_id = %s",
            (resolved_center,),
        )
        term_row = cur.fetchone()
        if not term_row:
            raise HTTPException(
                status_code=404,
                detail=f"GO term {go_id} not found in go_term table",
            )

        # Build enabled-relations list
        relations: list[str] = []
        if include_is_a:
            relations.append("is_a")
        if include_part_of:
            relations.append("part_of")

        # BFS using go_edge (respects relation filter)
        all_nodes: dict[str, int] = {resolved_center: 0}  # go_id → min distance
        all_edges: list[tuple[str, str, str]] = []  # (child, parent, relation)
        edge_seen: set[tuple[str, str, str]] = set()  # O(1) dedup without rebuilding set each iteration

        if relations:
            # Ancestors BFS: from frontier, find rows where child is in frontier → those are edges
            # pointing from child (in frontier) to parent (new node = ancestor).
            # go_edge: child=more-specific, parent=more-general.
            # For GO:0007189, we want edge (GO:0007189 → GO:0007188) where GO:0007188 is its parent.
            if direction in ("ancestors", "both"):
                frontier = {resolved_center}
                for _level in range(depth):
                    if not frontier:
                        break
                    cur.execute(
                        """
                        SELECT child_go_id, parent_go_id, relation
                        FROM go_edge
                        WHERE child_go_id = ANY(%s)
                          AND relation = ANY(%s)
                        """,
                        (list(frontier), relations),
                    )
                    next_frontier: set[str] = set()
                    for child_id, parent_id, rel in cur.fetchall():
                        edge_key = (child_id, parent_id, rel)
                        if edge_key not in edge_seen:
                            edge_seen.add(edge_key)
                            all_edges.append(edge_key)
                        if parent_id not in all_nodes:
                            all_nodes[parent_id] = all_nodes[child_id] + 1
                            next_frontier.add(parent_id)
                        elif all_nodes[child_id] + 1 < all_nodes[parent_id]:
                            all_nodes[parent_id] = all_nodes[child_id] + 1
                            next_frontier.add(parent_id)
                    frontier = next_frontier

            # Descendants BFS: from frontier, find rows where parent is in frontier → those are edges
            # pointing from child (new node = descendant) to parent (in frontier).
            if direction in ("descendants", "both"):
                frontier = {resolved_center}
                for _level in range(depth):
                    if not frontier:
                        break
                    cur.execute(
                        """
                        SELECT child_go_id, parent_go_id, relation
                        FROM go_edge
                        WHERE parent_go_id = ANY(%s)
                          AND relation = ANY(%s)
                        """,
                        (list(frontier), relations),
                    )
                    next_frontier: set[str] = set()
                    for child_id, parent_id, rel in cur.fetchall():
                        edge_key = (child_id, parent_id, rel)
                        if edge_key not in edge_seen:
                            edge_seen.add(edge_key)
                            all_edges.append(edge_key)
                        if child_id not in all_nodes:
                            all_nodes[child_id] = all_nodes[parent_id] + 1
                            next_frontier.add(child_id)
                        elif all_nodes[parent_id] + 1 < all_nodes[child_id]:
                            all_nodes[child_id] = all_nodes[parent_id] + 1
                            next_frontier.add(child_id)
                    frontier = next_frontier

        total_found = len(all_nodes)
        truncated = total_found > max_nodes
        if truncated:
            sorted_ids = sorted(all_nodes, key=lambda g: (all_nodes[g], g))
            all_nodes = {gid: all_nodes[gid] for gid in sorted_ids[:max_nodes]}

        go_ids_list = list(all_nodes)

        # Fetch term details
        cur.execute(
            "SELECT go_id, go_name, go_namespace FROM go_term WHERE go_id = ANY(%s)",
            (go_ids_list,),
        )
        term_info = {r[0]: (r[1], r[2]) for r in cur.fetchall()}

        # Direct gene counts per node
        cur.execute(
            "SELECT go_id, COUNT(DISTINCT gene_id) FROM gene_go "
            "WHERE go_id = ANY(%s) GROUP BY go_id",
            (go_ids_list,),
        )
        direct_counts = dict(cur.fetchall())

        # Propagated gene counts (via go_closure — relation-agnostic)
        cur.execute(
            "SELECT gc.ancestor_go_id, COUNT(DISTINCT gg.gene_id) "
            "FROM gene_go gg "
            "JOIN go_closure gc ON gc.descendant_go_id = gg.go_id "
            "WHERE gc.ancestor_go_id = ANY(%s) "
            "GROUP BY gc.ancestor_go_id",
            (go_ids_list,),
        )
        propagated_counts = dict(cur.fetchall())

        cur.close()

        # Build nodes (only terms that exist in go_term)
        nodes = [
            DagNode(
                id=gid,
                label=term_info[gid][0],
                namespace=term_info[gid][1],
                depth=all_nodes[gid],
                is_center=(gid == resolved_center),
                gene_count_direct=direct_counts.get(gid),
                gene_count_propagated=propagated_counts.get(gid),
            )
            for gid in go_ids_list
            if gid in term_info
        ]

        # Build edges — both endpoints must be in the returned node set (term_info).
        # GO:0051716 has no go_term entry so its node is excluded; exclude its edges too.
        valid_node_ids = set(term_info.keys())
        edges = [
            DagEdge(source=c, target=p, relation=r)
            for c, p, r in all_edges
            if c in valid_node_ids and p in valid_node_ids
        ]

        nodes.sort(key=lambda n: (0 if n.is_center else 1, n.depth, n.label))

        return DagResponse(
            center=go_id,
            resolved_center=resolved_center,
            direction=direction,
            depth=depth,
            relations=relations,
            nodes=nodes,
            edges=edges,
            truncated=truncated,
            node_count_total=total_found,
            node_count_returned=len(nodes),
            metadata={
                "include_is_a": include_is_a,
                "include_part_of": include_part_of,
            },
        )
    finally:
        pg_putconn(conn)


# ---------------------------------------------------------------------------
# Enrichment DAG Overview endpoint
# ---------------------------------------------------------------------------

class OverviewTermItem(BaseModel):
    go_id: str
    term_name: str
    namespace: str
    ontology: str
    query_count: int
    query_total: int
    background_count: int
    background_total: int
    p_value: float
    fdr: float
    significant: bool


class EnrichmentDagOverviewRequest(BaseModel):
    terms: list[OverviewTermItem]
    ontology: Literal["P", "C", "F"]
    fdr_cutoff: float = 0.05
    include_is_a: bool = True
    include_part_of: bool = True
    max_nodes: int = 150


class OverviewDagNode(BaseModel):
    id: str
    label: str
    namespace: str
    depth: int
    is_root: bool
    is_enriched: bool
    significant: bool
    p_value: Optional[float] = None
    fdr: Optional[float] = None
    query_count: Optional[int] = None
    query_total: Optional[int] = None
    background_count: Optional[int] = None
    background_total: Optional[int] = None
    significance_level: int = 0


class OverviewDagEdge(BaseModel):
    source: str
    target: str
    relation: Literal["is_a", "part_of"]
    both_significant: bool = False
    one_significant: bool = False


class EnrichmentDagOverviewResponse(BaseModel):
    ontology: str
    root_go_id: str
    nodes: list[OverviewDagNode]
    edges: list[OverviewDagEdge]
    truncated: bool = False
    node_count_total: int = 0
    node_count_returned: int = 0


# Root GO IDs per ontology
ONTOLOGY_ROOTS: dict[str, str] = {
    "P": "GO:0008150",
    "F": "GO:0003674",
    "C": "GO:0005575",
}

# Significance level thresholds (FDR → level 0-9)
SIG_THRESHOLDS = [
    (1e-9, 9), (1e-8, 8), (1e-7, 7), (1e-6, 6),
    (1e-5, 5), (1e-4, 4), (1e-3, 3), (1e-2, 2), (5e-2, 1),
]


def _sig_level(fdr: float) -> int:
    for threshold, level in SIG_THRESHOLDS:
        if fdr <= threshold:
            return level
    return 0


@router.post("/dag/overview", response_model=EnrichmentDagOverviewResponse)
async def get_enrichment_dag_overview(
    request_data: EnrichmentDagOverviewRequest,
    request: Request,
):
    """
    Return Enrichment DAG Overview for an entire SEA run.
    Builds per ontology (P/C/F), showing significant GO terms in global GO hierarchy context.
    """
    pg_getconn = request.app.state.pg_getconn
    pg_putconn = request.app.state.pg_putconn
    conn = pg_getconn()
    try:
        cur = conn.cursor()

        root_go_id = ONTOLOGY_ROOTS.get(request_data.ontology, "GO:0008150")
        fdr_cutoff = request_data.fdr_cutoff

        # Filter significant terms for the requested ontology
        sig_go_ids: set[str] = set(
            t.go_id for t in request_data.terms
            if t.ontology == request_data.ontology and t.significant and t.fdr <= fdr_cutoff
        )
        if not sig_go_ids:
            return EnrichmentDagOverviewResponse(
                ontology=request_data.ontology,
                root_go_id=root_go_id,
                nodes=[],
                edges=[],
                truncated=False,
                node_count_total=0,
                node_count_returned=0,
            )

        # Build relations filter
        relations: list[str] = []
        if request_data.include_is_a:
            relations.append("is_a")
        if request_data.include_part_of:
            relations.append("part_of")
        if not relations:
            relations = ["is_a", "part_of"]

        max_nodes = max(20, min(request_data.max_nodes, 500))

        # Step 1: Get all ancestors via go_closure for significant terms (no LIMIT — rely on Python-side max_nodes)
        # Use list() not tuple() — psycopg2 interprets single-element tuple as scalar
        cur.execute(
            """
            SELECT DISTINCT ancestor_go_id
            FROM go_closure
            WHERE descendant_go_id = ANY(%s)
            """,
            (sorted(sig_go_ids),),
        )
        ancestor_ids = {row[0] for row in cur.fetchall()}

        # Candidate nodes = sig terms + ancestors + root
        candidate_ids: set[str] = sig_go_ids | ancestor_ids
        if root_go_id not in candidate_ids:
            cur.execute("SELECT go_id FROM go_term WHERE go_id = %s", (root_go_id,))
            if cur.fetchone():
                candidate_ids.add(root_go_id)

        # Build sig_data_raw for sorting and overflow handling
        sig_data_raw: dict[str, OverviewTermItem] = {
            t.go_id: t
            for t in request_data.terms
            if t.ontology == request_data.ontology and t.significant and t.fdr <= fdr_cutoff
        }
        # Sort sig terms by FDR then p-value for stable truncation
        sig_terms_sorted = sorted(
            sig_go_ids,
            key=lambda gid: (
                sig_data_raw[gid].fdr,
                sig_data_raw[gid].p_value,
                gid,
            )
        )

        # Compute depth_map BEFORE truncation so ancestor priority is meaningful
        cur.execute(
            """
            SELECT descendant_go_id, ancestor_go_id, distance
            FROM go_closure
            WHERE descendant_go_id = ANY(%s)
              AND ancestor_go_id = ANY(%s)
            """,
            (sorted(sig_go_ids), sorted(candidate_ids)),
        )
        depth_map: dict[tuple[str, str], int] = {}
        for desc, anc, dist in cur.fetchall():
            key = (desc, anc)
            if key not in depth_map or dist < depth_map[key]:
                depth_map[key] = dist

        root_depth = max((depth_map.get((g, root_go_id), 999) for g in sig_go_ids), default=0) + 1

        # Enforce max_nodes: handle sig term overflow, then ancestor prioritization
        root_slot = 1 if root_go_id in candidate_ids else 0
        sig_slots = len(sig_go_ids)
        total_candidates = len(candidate_ids)

        if sig_slots + root_slot > max_nodes:
            # Not enough room for all sig terms — truncate by FDR priority
            kept_sig_ids: set[str] = set(sig_terms_sorted[: max_nodes - root_slot])
            all_candidate_ids = sig_terms_sorted[: max_nodes - root_slot] + ([root_go_id] if root_slot else [])
            truncated = True
        elif len(candidate_ids) > max_nodes:
            # Count how many sig terms each ancestor connects (via depth_map)
            ancestor_sig_count: dict[str, int] = {}
            for (desc, anc), _dist in depth_map.items():
                if anc not in sig_go_ids:
                    ancestor_sig_count[anc] = ancestor_sig_count.get(anc, 0) + 1

            # Remaining slots for ancestors after reserving sig terms + root
            remaining = max_nodes - sig_slots - root_slot

            # Sort non-sig ancestors: prefer nodes on root paths from sig terms, then connectivity, then depth
            non_sig_ancestors = [
                x for x in candidate_ids
                if x not in sig_go_ids and x != root_go_id
            ]

            def ancestor_priority(gid: str) -> tuple:
                conn_count = ancestor_sig_count.get(gid, 0)
                min_dist_from_sig = min(
                    (depth_map.get((sig, gid), 999) for sig in sig_terms_sorted),
                    default=999,
                )
                return (-conn_count, min_dist_from_sig, gid)

            non_sig_ancestors.sort(key=ancestor_priority)
            all_candidate_ids = (
                sig_terms_sorted
                + ([root_go_id] if root_slot else [])
                + non_sig_ancestors[:remaining]
            )
            truncated = total_candidates > len(all_candidate_ids)
        else:
            all_candidate_ids = sorted(candidate_ids)
            truncated = False

        node_id_list = all_candidate_ids
        node_id_set = set(node_id_list)

        # Step 2: Fetch term details
        cur.execute(
            "SELECT go_id, go_name, go_namespace FROM go_term WHERE go_id = ANY(%s)",
            (list(node_id_list),),
        )
        term_info: dict[str, tuple[str, str]] = {row[0]: (row[1], row[2]) for row in cur.fetchall()}

        # Filter to only nodes that exist in go_term
        valid_ids = set(term_info.keys())
        sig_go_ids &= valid_ids

        # Step 3: Collect edges (go_edge, both endpoints in valid_ids)
        if relations:
            cur.execute(
                """
                SELECT child_go_id, parent_go_id, relation
                FROM go_edge
                WHERE child_go_id = ANY(%s)
                  AND parent_go_id = ANY(%s)
                  AND relation = ANY(%s)
                """,
                (list(valid_ids), list(valid_ids), list(relations)),
            )
            raw_edges = cur.fetchall()
        else:
            raw_edges = []

        # Step 4: Build go_id → significance data
        sig_data: dict[str, OverviewTermItem] = {
            t.go_id: t for t in request_data.terms
            if t.go_id in sig_go_ids
        }

        # Step 5: (depth_map already computed above)

        # Step 6: Build nodes
        nodes: list[OverviewDagNode] = []
        for go_id in node_id_list:
            if go_id not in valid_ids:
                continue
            go_name, go_namespace = term_info[go_id]
            is_root = go_id == root_go_id
            is_enriched = go_id in sig_data
            significant = is_enriched

            if is_root:
                sig_lvl = 0
                pval = None
                fdr_val = None
                qc = None
                qt = None
                bc = None
                bt = None
            elif is_enriched:
                td = sig_data[go_id]
                sig_lvl = _sig_level(td.fdr)
                pval = td.p_value
                fdr_val = td.fdr
                qc = td.query_count
                qt = td.query_total
                bc = td.background_count
                bt = td.background_total
            else:
                sig_lvl = 0
                pval = None
                fdr_val = None
                qc = None
                qt = None
                bc = None
                bt = None

            label = go_name[:80] + "..." if len(go_name) > 80 else go_name

            if is_enriched and fdr_val is not None:
                display_lines = f"{go_id}\np={pval:.2e}\n{label}"
            else:
                display_lines = f"{go_id}\n{label}"

            nodes.append(OverviewDagNode(
                id=go_id,
                label=display_lines,
                namespace=go_namespace,
                depth=root_depth if is_root else depth_map.get((go_id, root_go_id), 0),
                is_root=is_root,
                is_enriched=is_enriched,
                significant=significant,
                p_value=pval,
                fdr=fdr_val,
                query_count=qc,
                query_total=qt,
                background_count=bc,
                background_total=bt,
                significance_level=sig_lvl,
            ))

        # Step 7: Build edges
        valid_node_set = set(n.id for n in nodes)
        edges: list[OverviewDagEdge] = []
        for child_id, parent_id, rel in raw_edges:
            if child_id not in valid_node_set or parent_id not in valid_node_set:
                continue
            child_sig = child_id in sig_go_ids
            parent_sig = parent_id in sig_go_ids
            edges.append(OverviewDagEdge(
                source=child_id,
                target=parent_id,
                relation=rel,
                both_significant=child_sig and parent_sig,
                one_significant=child_sig or parent_sig,
            ))

        nodes.sort(key=lambda n: (0 if n.is_root else 1, n.depth, n.label))

        return EnrichmentDagOverviewResponse(
            ontology=request_data.ontology,
            root_go_id=root_go_id,
            nodes=nodes,
            edges=edges,
            truncated=truncated,
            node_count_total=total_candidates,
            node_count_returned=len(nodes),
        )
    finally:
        pg_putconn(conn)