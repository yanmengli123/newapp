# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bioinformatics visualization platform for the GRCg6a chicken genome. React/TypeScript frontend with FastAPI backend. Frontend runs on port 5173, backend on port 8001.

**Architecture model**: `C:\Users\32110\Desktop\newapp\backend\` is the development/main copy. `D:\jbrowsedata\projectdata\` is the production data/execution drive. The two directories have different structures — C has a `backend/` subdirectory that D does not. Python code lives in C; data, Docker, and genome files live in D. Only C is synced to Git; D is outside the repo.

## Commands

```bash
# Frontend
npm run dev      # Start dev server (port 5173)
npm run build    # TypeScript check + production build
npm run lint     # ESLint

# Backend — ONLY supported way to start (from C root):
D:\soft\python310\python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8001

# Backend tests (from C root):
D:\soft\python310\python.exe -m backend.test_go_enrichment

# Legacy ways (DEPRECATED — do not use):
# python backend/main.py               ← wrong: uses old import style
# python grcg6a_fastapi_backend.py    ← wrong: different directory structure
```

## Architecture

### Directory Structure

```
C:\Users\32110\Desktop\newapp\   # Source root (Git-managed)
├── src/                          # React/TypeScript frontend
│   ├── pages/                    # Route targets (App.tsx)
│   ├── components/                # UI components
│   │   ├── expression/            # 14 Plotly expression chart components
│   │   ├── kegg/                # KEGG pathway viewer
│   │   ├── go/                   # GO term cards
│   │   ├── go_enrichment/       # GO Enrichment SEA components
│   │   │   ├── GOEnrichmentVisualization.tsx  # Dotplot/Barplot outer container (controls, legend, fullscreen button)
│   │   │   ├── GOEnrichmentChartFullscreen.tsx # Fullscreen Modal with export toolbar (BG/size/filename/Export PNG)
│   │   │   ├── goEnrichmentChartExport.ts     # Canvas compositing export utility (4 size presets)
│   │   │   ├── GOEnrichmentFacetGrid.tsx      # BP/CC/MF flex layout (proportional column widths)
│   │   │   ├── GOEnrichmentDotplotPanel.tsx   # Single ontology ECharts scatter (x=GeneRatio, size=Count, color=FDR)
│   │   │   ├── GOEnrichmentBarplotPanel.tsx   # Single ontology ECharts bar (Count/Ratio/-log10FDR)
│   │   │   ├── goEnrichmentChartUtils.ts      # ratio parsing, sort/slice/reverse, sigColor, tooltip
│   │   │   ├── GOEnrichmentTable.tsx
│   │   │   ├── GOEnrichmentTermDrawer.tsx
│   │   │   └── GOTermDagViewer.tsx   # Cytoscape+dagre DAG viewer (fullscreen via createPortal)
│   │   ├── gene/                 # Gene structure & transcript components
│   │   └── chat/                 # ChatWidget
│   └── lib/                      # API clients
│       ├── apiClient.ts           # Mandatory centralized fetch wrapper
│       ├── geneApi.ts            # Gene/GO/KEGG API
│       ├── goEnrichmentApi.ts    # GO Enrichment SEA API
│       ├── goDagApi.ts           # GO DAG viewer API (dag/metadata, term/{go_id}/dag)
│       ├── genomeApi.ts           # Genome analysis API (ALL /genome-api/*)
│       └── overviewApi.ts         # ESC Atlas overview API
│
└── backend/                       # FastAPI backend (standard Python package)
    ├── __init__.py               # Makes backend a package (required)
    ├── __main__.py               # Optional: python -m backend
    ├── main.py                   # **ONLY entry point** (uvicorn backend.main:app)
    ├── config.py                 # Centralized path config → D:\jbrowsedata\projectdata
    ├── expression_service.py       # Expression queries (PostgreSQL star schema)
    ├── overview_service.py         # Overview aggregation (8 charts)
    ├── gene_utils.py              # Gene ID resolution
    ├── api/                       # Route modules (must have __init__.py)
    │   ├── __init__.py
    │   ├── go_kegg_routes.py     # /annotations/*
    │   ├── overview_routes.py     # /overview/*
    │   ├── genome_analysis_routes.py  # /genome-api/*  ← NOTE prefix
    │   ├── kegg_image_router.py  # /kegg-images/*
    │   ├── tool_routes.py        # /tools/*
    │   └── chat_router.py         # /api/*
    ├── genome_analysis/            # Analysis engine (runtime-loaded)
    │   ├── __init__.py
    │   ├── analyzer.py
    │   ├── task_manager.py
    │   └── ...
    ├── tools/                     # Tool implementations
    │   ├── __init__.py
    │   ├── domain_searcher.py
    │   └── primer3_designer.py
    └── db/                        # Schema and migrations
        ├── schema.sql
        ├── schema_esc_v1.sql      # Fixed: no duplicate columns
        └── migrations/             # Versioned schema changes
            ├── V002__add_dataset_alias.sql
            ├── V003__add_mv_dataset_metric.sql
            ├── V004__go_dag_closure.sql
            ├── V005__add_gene_go_provenance.sql
            └── V006__fix_fold_change_to_stage_level.sql

D:\jbrowsedata\projectdata\      # Production data/execution root (NOT in Git)
├── grcg6a_nc.db                 # SQLite (gffutils, read-only at startup)
├── docker-compose.yml           # PostgreSQL Docker (port 5433)
├── static/                       # KEGG pathway images
├── rawdata/                      # Expression TSV matrices
├── outputs/                      # Job results
├── genome_outputs/
├── backend/                      # C's backend/ synced here (manual copy)
├── api/                          # D's own api/ (independent from C)
├── grcg6a_fastapi_backend.py      # D's own entry (independent from C)
└── scripts/                      # ETL scripts
```

### Frontend (src/)

- **App.tsx** — Route definitions; ChatWidget rendered globally here
- **Pages** — `src/pages/` (route targets in App.tsx)
  - `HomePage` — Hero, gene search, chart carousel (11 charts from sample results)
  - `GeneQueryPage` — Autocomplete gene search
  - `GenePage` — Gene detail: gene header (xref/aliases), **GeneStructurePlot** (SVG transcript visualization with drag-pan/scroll-zoom/PNG export), transcripts accordion with exons/CDS/UTR, GO (Accordion), KEGG Pathways, **Expression module**
    - **Data loading**: Four-layer concept — (1) Load main page via `getGenePage(geneId, false)` (no sequences), (2) Hydrate expression from `response.expression`, (3) Annotations consumed directly from `response.annotations` (no separate API calls), (4) Sequences loaded on-demand via `getGenePage(geneId, true)`
  - `ChromosomePage` — Chromosome view with gene list
  - `JBrowsePage` — Linear genome browser via @jbrowse/react-linear-genome-view2; 35 chromosome buttons, navigation via `?loc=` param; **BigWig QuantitativeTrack** integration with 29 tracks from `/bwdata/` (GRCg6a_BWDATA_ROOT config, served via `application/octet-stream` custom route)
  - `PictureMakerPage` — Single-chart generator: Gene Search + Chart Type/Dataset/Metric dropdowns + Run button → renders one of 10 expression charts. Reuses all Expression* components; includes ChartCustomizerDrawer and ChartFullscreenModal. Route: `/picture-maker`
  - `BrowserPage`, `VizPage`, `DataPage`, `BlastPage`, `ToolsPage` — Additional pages
  - **Genome module pages** (registered in App.tsx): `GenomeHomePage`, `GenomeFilesPage`, `GenomeRunPage`, `GenomeJobsPage`, `GenomeJobPage`, `GenomeResultPage`, `GenomeDownloadsPage`
- **`GOEnrichmentPage.tsx`** — GO Enrichment Analysis (SEA) page: gene list input, example gene sets (daily-stable), parameters (ontology/correction/evidence/fdr/min_overlap), **ECharts Dotplot/Barplot visualization** with BP/CC/MF facet panels (clusterProfiler-style), results table with FDR sorting + pagination, term detail drawer with AmiGO/QuickGO links. Toggle "Show all tested terms" to reveal non-significant results. Visualization module uses `result.results` (not `bar_chart_data`) as data source; supports configurable display count (0=all), Dotplot/Barplot mode toggle, per-ontology filtering, and **fullscreen export** (canvas compositing PNG download with size presets and background toggle).
- **`EscOverviewSection.tsx`** — ESC Gene Expression Atlas homepage section: 8 clickable chart cards (Sample Composition / Sex-Biased Genes / Female vs Male Scatter / Stage DEG Count / Expression Distribution / PCA / Top50 Heatmap / Trajectory Clusters). Each card opens in a `Drawer` fullscreen view via `useDisclosure` + `useHotkeys`. Heatmap uses agglomerative hierarchical clustering (pure TypeScript, single linkage) for gene ordering.
- **`DownloadsPage.tsx`** — CSV download cards for all 8 overview charts. Download via `fetch` + `Blob` + `createObjectURL` pattern hitting `/overview/<id>/csv` endpoints.
- **API clients**: `src/lib/geneApi.ts` (gene/chromosome/GO/KEGG/tools), `src/lib/genomeApi.ts` (genome analysis — **all paths use `/genome-api/` prefix**), `src/lib/chatApi.ts` (chat)
  - **`src/lib/apiClient.ts`** — **Mandatory centralized API client**. All URL construction goes through `apiFetch<T>()` here. `API_BASE` is resolved from `import.meta.env.VITE_API_BASE` (defaults to `''` — dev proxy handles routing). Never hardcode URLs in components.
- **Vite proxy** (`vite.config.ts`): All common backend paths (`/api`, `/go-enrichment`, `/health`, `/bwdata`, `/genes`, `/search`, `/chromosomes`, `/datasets`, `/overview`, `/annotations`, `/kegg-images`, `/tools`, `/genome`) proxy to `http://localhost:8001`. **Always include new backend routes in the proxy if the frontend needs them.**
  - `resolveGeneId()` — Auto-resolves non-canonical gene IDs (symbol → gene-XXX). All gene API functions use this internally; components should NOT call search before gene API functions.
- **KEGG components** — `src/components/kegg/`: `KeggPathwaysSection` (section container), `KeggPathwayCard` (View/Interactive/Download/KEGG 4 buttons), `KeggInteractiveViewer` (PNG+SVG proportional overlay interactive viewer). All image URLs use `API_BASE` from `apiClient`, not hardcoded localhost.
- **GO components** — `src/components/go/`: `GOTermCard` (single GO entry card with ID/name/evidence code/source/definition)
- **Expression components** — `src/components/expression/`: 15 chart components + 2 structural components
  - `utils.ts` — Shared utilities (`isValidNumber`/`normalizeSex`/`STAGE_ORDER`/`resolveStageMeans`/`groupSamplesByStageSex`/`groupSamplesByStageSexReplicate`/`PLOT_CONFIG`)
  - `chartCustomizer.types.ts` — `ChartType`, `ResolvedChartStyle`, `ChartStyleConfig` types
  - `chartCustomizer.defaults.ts` — `CHART_TYPE_LABELS`, default style per chart type
  - `chartStyleResolver.ts` — `resolveChartStyle()` merges chart type + user config into final `ResolvedChartStyle`
  - `useChartCustomizer` — `useDisclosure` hook returning `customizerOpened`/`setCustomizerOpened`; `config` holds all per-chart style settings; `setChartStyle` updates a single chart
  - `ChartCustomizerDrawer` — Full style editing drawer (fontSize/chartHeight/colors/chartSpecific), grouped by chart type for selection
  - `ChartFullscreenModal` — Fullscreen modal (Mantine `Modal fullScreen`), captures Plotly graph div via `onInitialized`/`onUpdate` → `graphDivRef`, provides Export Settings (Size/Filename/Background/Download). **Download uses `PlotlyModule.downloadImage`** + `window.Plotly.relayout` for transparent background
  - `chartFullscreen.types.ts` — `FullscreenChartType` union and `FullscreenState` interface
  - `ExpressionHeader` — Dataset/Metric selector + Expand All toggle
  - `ExpressionStatsRow` — 7 stat cards (Max/Min/Mean±Std/CV/Expressed/Top Stage/Sex Bias)
  - `ExpressionStageChart` — Plotly grouped bar chart (Male/Female + Total Mean line, dual Y axis)
  - `ExpressionLineChart` — Plotly line chart (sorted by stage_order, Male/Female color-coded)
  - `ExpressionTable` — Sortable/filterable/paginated (12/page)/CSV export/multi-baseline Log2FC (E0/Mean/Stage median SegmentedControl)/SortIcon extracted outside component
  - `ExpressionComparePanel` — Expand All cross-dataset comparison panel (Dataset Tabs + metric toggle)
  - `ExpressionHeatmap` — Stage × Sex heatmap (based on stage_means)
  - `ExpressionStackedArea` — Stacked area chart (Male/Female layered fill + Total Mean line)
  - `ExpressionRadarChart` — Male vs Female radar chart (normalized to [0,1])
  - `ExpressionViolinPlot` — Violin plot (stage×sex distribution, with embedded box plot)
  - `ExpressionFoldChangeBar` — log2 Fold Change bar chart (Top/Bottom Stage up/down regulation coloring)
  - `ExpressionDendrogram` — Sample clustering scatter (Male circle / Female diamond, arranged by stage)
  - `ExpressionZScoreChart` — Z-Score sample profile (line chart, M/F color-coded + zero-line reference)
  - `ExpressionFoldChangeTrajectory` — Adjacent-stage log2FC grouped bar chart
  - `ExpressionReplicateConsistency` — Pure Mantine layout: Progress bar + CV% warning Badge + consistency label; CV computed within stage×sex groups (3 replicates), with detailed analysis Popover
  - `ExpressionSection` — Integrates all Expression components, `fullscreenState` manages fullscreen modal toggle
  - `EscOverviewSection` — ESC Atlas homepage section, 8 chart cards open fullscreen Drawer on click (`useDisclosure` + `useHotkeys`)
- **Gene components** — `src/components/gene/`:
  - `GeneStructurePlot` — SVG gene structure visualization (black body line, blue CDS blocks, gray UTR, intron lines, GT/AG splice triangles, drag-pan, scroll-zoom, hover tooltip in English, PNG export). "Open in JBrowse" button navigates to `/jbrowse?loc=chrN:start..end`. Single-transcript selector above transcript accordion in GenePage.
- **Chat**: `src/components/chat/` — ChatWidget (floating), ChatWindow, ChatLauncher, ChatMessageBubble. All responses are grounded in database queries, no hardcoded facts.

### Backend (backend/)

- **config.py** — Centralized path configuration. All paths resolve to `D:\jbrowsedata\projectdata\` unless overridden by env vars. All modules import from here; no hardcoded paths.
- **main.py** — **The only supported entry point**. Must be started as `uvicorn backend.main:app`. Responsibilities: app creation, lifespan (DB pools + gffutils + in-memory indexes), middleware, exception handlers, router registration. **No business logic** lives here.
- **api/** — Route modules (all importable as `from backend.api.xxx`):
  - `go_enrichment_routes.py` — GO Enrichment SEA (prefix `/go-enrichment`)
  - `go_kegg_routes.py` — Gene/GO/KEGG endpoints (prefix `/annotations`)
  - `overview_routes.py` — ESC Atlas overview charts (prefix `/overview`)
  - `genome_analysis_routes.py` — Genome analysis (prefix `/genome-api`) — **NOTE: prefix was changed from `/genome`**
  - `kegg_image_router.py` — KEGG pathway image serving (prefix `/kegg-images`)
  - `tool_routes.py` — Primer3, Domain Search (prefix `/tools`)
  - `chat_router.py` — Chat (prefix `/api`)
- **expression_service.py** — Expression data service (ESC star schema queries, `stage_means` aggregation, cross-dataset comparison). Depends on `mv_dataset_metric` materialized view.
- **go_enrichment_service.py** — GO Enrichment SEA (Singular Enrichment Analysis): hypergeometric test + per-ontology FDR correction (BH/BY/Bonferroni/none). Supports `evidence_filter` (all / non_iea / experimental). Uses `_evidence_filter_sql()` to build consistent K/N across background, hits, and mapping queries. Core math extracted to pure function `_compute_enrichment_for_namespace()` (testable without DB). `_go_alt_sql_parts(cur)` helper centralizes `_table_exists` + `_go_id_expr` + `alt_join` construction.
- **overview_service.py** — Overview aggregation (8 chart services). Reads from `gene_expression_summary` JSONB `stage_means`; `jsonb_object_keys()` returns `text`, use `stage_key::text` cast in `->>` chains.
- **genome_analysis/** — Analysis engine (imported at runtime, not at startup):
  - `analyzer.py`, `task_manager.py`, `output_config.py`, `carousel_service.py`, `file_discovery.py`, `chart_exporter.py`, `chart_styles.py`, `settings.py`
- **db/migrations/** — Versioned SQL migrations (authoritative source for schema changes):
  - `V002__add_dataset_alias.sql` — `dataset_alias` table for dataset code aliases
  - `V003__add_mv_dataset_metric.sql` — `mv_dataset_metric` materialized view for (dataset, metric) capability registry
  - `V004__go_dag_closure.sql` — GO DAG closure tables (go_term, go_edge, go_closure, go_alt_id)
  - `V005__add_gene_go_provenance.sql` — GO annotation provenance columns (qualifier/reference/pubmed_ids/assigned_by/aspect/source_gene_id)
  - `V006__fix_fold_change_to_stage_level.sql` — Fix fold_change to use stage-level means (log2 scale, NULL for uncomputable)
- `V007__expression_staging_layer.sql` — Staging layer: `import_batch`, `stg_update_expression_matrix`, `gene_source_mapping` tables + `source_gene_count`/`curated_gene_count` on `dataset`

## Backend Endpoints

### Core Gene API (11)
- `GET /` — API root info
- `GET /health` — Health check
- `GET /chromosomes` — Chromosome list
- `GET /chromosomes/{seqid}` — Chromosome detail
- `GET /chromosomes/{seqid}/genes` — Genes on chromosome
- `GET /search/genes?q=` — Gene search
- `GET /genes/{gene_id}` — Gene detail
- `GET /genes/{gene_id}/transcripts` — Transcripts
- `GET /genes/{gene_id}/sequences` — Sequences
- `GET /genes/{gene_id}/page` — Full gene page (annotations.go / annotations.kegg / expression)
- `GET /genes/{gene_id}/expression` — Expression data endpoint (`?dataset=` / `?metric=` / `?expand=true`)

### Datasets (1)
- `GET /datasets` — All available datasets and metric info (for Expression module selector)

### GO/KEGG Annotations (11, prefix `/annotations`)
- `GET /annotations/go/{gene_id}` — GO annotations
- `GET /annotations/kegg/{gene_id}` — KEGG pathways (includes png_url/kgml_url/mapdata_api)
- `GET /annotations/kegg/pathways` — All KEGG pathway list (with node stats)
- `GET /annotations/kegg/pathway/{pathway_id}` — Pathway detail (member genes)
- `GET /annotations/kegg/pathway/{pathway_id}/info` — Pathway metadata (from kegg_pathway_asset)
- `GET /annotations/kegg/pathway/{pathway_id}/image` — Pathway PNG image
- `GET /annotations/kegg/pathway/{pathway_id}/mapdata` — Node coordinate JSON (nodes array); **supports `?highlight_gene=` param** to highlight gene locations on the map
- `GET /annotations/kegg/pathway/{pathway_id}/interactive` — Interactive HTML data (`?highlight_gene=` to highlight query gene)
- `GET /annotations/kegg/kgml-cache/status` — KGML cache status
- `POST /annotations/kegg/kgml-cache/refresh/{pathway_id}` — Refresh single pathway KGML
- `POST /annotations/kegg/kgml-cache/refresh` — Bulk refresh KGML

### GO Enrichment — SEA (6, prefix `/go-enrichment`)
- `POST /go-enrichment/analyze` — Singular Enrichment Analysis for Gallus gallus GRCg6a genes. Params: `gene_list`, `correction` (bh/by/bonferroni/none), `fdr_cutoff` (0–1), `min_overlap` (≥1), `namespace` (all/biological_process/cellular_component/molecular_function), `annotation_mode` (direct/propagated), `evidence_filter` (all/non_iea/experimental). FDR correction applied per ontology (BP/CC/MF corrected separately within each namespace). Returns `results[]` (enriched GO terms with hit genes/symbols/ncbi_ids), `bar_chart_data`, `mapping[]`, `ontology_stats`.
- `GET /go-enrichment/example-sets` — Dynamically generated example gene sets (stable within same day via PostgreSQL `setseed`). Returns 4 sets × 20 genes each, drawn from real shared GO terms in the database.
- `GET /go-enrichment/term/{go_id}` — GO term detail: name, namespace, definition, total_genes, genes[] (gene_id/ncbi_id/symbol). **Supports alt GO ID resolution** — if `go_id` is an alt ID, queries `go_alt_id` table first and returns canonical ID. Response includes `resolved_from_alt: true` when an alt ID was resolved.
- `GET /go-enrichment/dag/metadata` — GO DAG metadata: ready status, term/edge/closure counts, data version, loaded timestamp.
- `GET /go-enrichment/term/{go_id}/dag` — GO DAG sub-graph via BFS on `go_edge` table. Params: `direction` (ancestors/descendants/both), `depth` (1–6), `include_is_a` (bool), `include_part_of` (bool), `max_nodes` (default 80). Returns `{center, resolved_center, direction, depth, nodes[], edges[], truncated, node_count_total, node_count_returned}`.
- `POST /go-enrichment/dag/overview` — Enrichment DAG Overview for SEA results. Accepts `terms[]` (GO terms with p-value/FDR/hit counts), `ontology` (P/C/F), `fdr_cutoff`, `include_is_a`, `include_part_of`, `max_nodes`. Returns DAG subgraph showing all significant terms in GO hierarchy context, with FDR-based significance coloring (sig_level 0-9). Uses BFS via `go_closure` + `go_edge`; `ANY()` params must use `list()` not `tuple()` for psycopg2.

### KEGG Images (2, prefix `/kegg-images`)
- `GET /kegg-images/{pathway_id}.png` — KEGG pathway image
- `GET /kegg-images/{pathway_id}/info` — Image metadata

### Tools (2, prefix `/tools`)
- `GET /tools/primer3` — Primer3 PCR primer design (query params: `gene_id`, `include_flank`, `product_size_min/max`, `num_primers`)
- `GET /tools/domain-search` — HMMER/Pfam protein domain search (query param: `gene_id`)

### Genome Analysis (21, prefix `/genome-api`) — **NOTE: prefix changed from `/genome`**
- `GET /genome-api/health` — Module health check
- `GET /genome-api/files` — Scan genome files
- `POST /genome-api/files/scan` — Re-scan files
- `POST /genome-api/analysis/run` — Submit analysis job
- `GET /genome-api/jobs` — Job list
- `GET /genome-api/jobs/{job_id}` — Job detail
- `GET /genome-api/jobs/{job_id}/result` — Analysis result
- `GET /genome-api/jobs/{job_id}/result/{module_name}` — Single module result
- `GET /genome-api/jobs/{job_id}/downloads` — Download list
- `GET /genome-api/carousel` — Carousel item list
- `GET /genome-api/carousel/images` — Carousel image list
- `GET /genome-api/charts/{job_id}/{chart_key}/json` — Chart JSON
- `GET /genome-api/charts/{job_id}/{chart_key}/html` — Chart HTML
- `GET /genome-api/download/public/carousel/{filename}` — Download carousel image
- `GET /genome-api/download/{job_id}/{category}/{filename}` — Download analysis result
- `GET /genome-api/sample/status` — Pre-generated result status
- `GET /genome-api/sample/result` — Pre-generated analysis result
- `GET /genome-api/sample/downloads` — Pre-generated download list
- `GET /genome-api/sample/charts/{key}/{format}` — Chart (html/png/svg/json)
- `GET /genome-api/sample/tables/{name}/{format}` — Table (csv/xlsx)
- `GET /genome-api/sample/{category}/{filename}` — Sample result/metadata file

### Overview — ESC Atlas (17, prefix `/overview`)
- `GET /overview/summary` — All 8 charts in one request (static file served from `backend/static/overview/summary.json` when present; falls back to live DB)
- `GET /overview/sample_composition` — Sample counts per stage × sex
- `GET /overview/sex_biased_genes` — Female_higher / Male_higher gene counts per stage
- `GET /overview/female_male_scatter` — All genes female_mean vs male_mean (aggregated across stages, ~24K genes)
- `GET /overview/stage_deg_count` — Up/down DEG counts per stage transition
- `GET /overview/expression_distribution` — Per-stage expression quartiles (Q1/Median/Q3)
- `GET /overview/pca` — Sample PCA coordinates (PC1, PC2, 36 samples)
- `GET /overview/top50_heatmap` — Top-50 most variable genes × 36 samples matrix (agglomerative clustered)
- `GET /overview/trajectory_clusters` — Gene trajectory clusters (k-means k=4 on stage-wise expression vectors)
- `GET /overview/<id>/csv` — CSV download for each chart (8 endpoints)

**Static overview JSON**: `backend/static/overview/summary.json` is pre-generated by `scripts/generate_overview_static.py`. Refresh after DB changes:
```bash
python -m scripts.generate_overview_static
```

### JBrowse Genome Files (static, prefix `/genome`)
Served from `RAWDATA_ROOT.parent` = `D:\jbrowsedata\projectdata\` via FastAPI `StaticFiles`. These are **external data files not in the git repo** — they must exist on the server:

| File | Description |
|------|-------------|
| `GCF_000002315.6_GRCg6a_genomic.chr.fna` | Uncompressed FASTA, 35 main chromosomes only (~1 GB) |
| `GCF_000002315.6_GRCg6a_genomic.chr.fna.fai` | FAI index for the chr-only FASTA |
| `GCF_000002315.6_GRCg6a_genomic.gff` | Filtered GFF (excludes `region`/`cDNA_match` types, ~429 MB) |
| `aliases.txt` | chr→NC_ accession mapping (35 entries) |

Regenerate the chr-only FASTA if the full genome FASTA changes:
```bash
python backend/scripts/filter_fasta.py
```

### Chat (1, prefix `/api`)
- `POST /api/chat` — `{ "message": "..." }` → `{ "reply": "...", "type": "...", "data": {...} }`. Intent detected from message; queries database directly. Supported intents: genome_stats, gene_search, chromosome, go, kegg, analysis_results.

## Data Files

All data paths are centralized in `backend/config.py` and resolve to `D:\jbrowsedata\projectdata\` unless overridden by environment variables:

| Env Var | Default | Description |
|---------|---------|-------------|
| `GRCG6A_BASE_DIR` | `D:\jbrowsedata\projectdata` | Project root |
| `GRCG6A_DB_PATH` | `.../grcg6a_nc.db` | SQLite gene DB |
| `GRCG6A_STATIC_ROOT` | `.../static` | KEGG images |
| `GRCG6A_RAWDATA_ROOT` | `.../rawdata` | Raw TSV matrices only (FPKM/TPM); genome FASTA/GFF/aliases live in `RAWDATA_ROOT.parent` and are served via `/genome/` |
| `GRCG6A_BWDATA_ROOT` | `.../bwdata` | BigWig coverage track files (29 .bw files); served via `/bwdata/` with `application/octet-stream` MIME type (custom APIRouter, not StaticFiles) |
| `GRCG6A_GENOME_OUTPUT` | `.../outputs/jobs` | Analysis job outputs |
| `GRCG6A_SAMPLE_RESULTS` | `.../outputs/sample_results` | Pre-generated results |
| `GRCG6A_HMMER_DB` | `.../hmmer_db/Pfam-A.hmm` | HMMER/Pfam domain DB |
| `GRCG6A_PG_DSN` | `postgresql://grcuser:grcpassword@127.0.0.1:5433/grcg6a` | PostgreSQL connection string |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:5174` | CORS allowed origins (comma-separated) |

**PostgreSQL Docker startup**:
```bash
cd /d/jbrowsedata/projectdata && docker-compose up -d postgres
```

All backend modules import from `config.py` — never hardcode `D:\jbrowsedata\projectdata` directly.

### Dual-Database Architecture

| Database | Purpose | Driver |
|--------|------|------|
| **SQLite** (gffutils) | GFF features, chromosomes, sequences, search | `gffutils` library |
| **PostgreSQL** (Docker 5433) | GO/KEGG annotations, gene expression data | `psycopg2` connection pool |

**Rationale**: gffutils interval indexing and parent-child feature management requires SQLite; GO/KEGG/Expression is relational data suited for PostgreSQL.

**Connection management**:
```python
pg_conn = pg_getconn()    # borrow from ThreadedConnectionPool
try:
    cur.execute("SELECT ...")
finally:
    pg_putconn(pg_conn)   # return to pool
```

**Graceful degradation**: GO/KEGG/Expression endpoints return `status: "unavailable"` when PG is down; SQLite-only features (gene search, chromosome view) are unaffected. GenePage checks `status === 'unavailable'` to catch all degraded scenarios.

### Gene Expression Response

`GET /genes/{gene_id}/expression` and `/genes/{gene_id}/page.expression` both return expression data:

```typescript
interface GeneExpressionResponse {
  status: "available" | "no_data" | "unavailable";
  gene_id?: string;
  dataset?: string;
  metric?: string;
  samples: ExpressionSample[];
  summary?: {
    sample_count: number;
    mean_value: number | null;
    max_value: number | null;
    min_value: number | null;
    std_value: number | null;
    cv: number | null;
    expressed_samples: number | null;
    zero_samples: number | null;
    top_sample: string | null;
    top_stage: string | null;
    sex_bias_label: string | null;
    sex_bias_ratio: number | null;
    fold_change_top: number | null;
    fold_change_bottom: number | null;
    stage_means?: Record<string, { male: number; female: number; mean: number } | number>;
    stage_sample_count?: Record<string, number>;
  };
}

interface ExpressionSample {
  dataset_sample_id: number;
  sample_name: string;
  srr_run_id: string | null;
  stage: string;
  stage_label: string | null;
  stage_order: number | null;
  sex: string;
  sex_code: string | null;
  replicate: number | null;
  batch: string | null;
  tissue: string | null;
  value: number;
  z_score: number | null;
  log2fc: number | null;
}

// GET /genes/{id}/expression?expand=true → cross-dataset comparison
interface GeneExpressionExpandResponse {
  gene_id: string;
  cross_comparison: {
    dataset_count: number;
    available_datasets: string[];
    trend_note: string;
    opposite_trends: boolean | null;
  };
  datasets: Array<{
    dataset_code: string;
    dataset_name: string;
    normalization_family: string;
    sample_count: number;
    metrics: Array<{
      metric_code: string; metric_name: string; unit_desc: string;
      is_comparable: boolean; gene_count?: number;
      summary?: GeneExpressionResponse["summary"];
      samples: ExpressionSample[];
    }>;
  }>;
}
```

**ESC star-schema datasets** (`dataset` table):
| dataset_code | dataset_name | Supported metrics |
|---|---|---|
| `day_deseq2_36` | DESeq2 NC — 36 developmental stage samples | normcount |
| `raw_ballgown_36` | Ballgown TPM/FPKM — 36 developmental stage samples | tpm, fpkm |
| `day_featurecounts_36` | featureCounts Raw Count — 36 developmental stage samples | raw_count |
| `esc_srr_23` | ESC SRR Runs — 23 SRA Runs (deprecated, no data) | — |

### Registered Routers
All routers registered in `main.py`:

| Router file | Prefix | Endpoint count |
|---|---|---|
| main.py (inline) | `/` | 11 |
| go_enrichment_routes.py | `/go-enrichment` | 6 |
| go_kegg_routes.py | `/annotations` | 11 |
| kegg_image_router.py | `/kegg-images` | 2 |
| tool_routes.py | `/tools` | 2 |
| genome_analysis_routes.py | `/genome-api` | 21 |
| chat_router.py | `/api` | 1 |
| overview_routes.py | `/overview` | 17 |
| **Total** | | **69** |

### Database Schema (grcg6a_nc.db)
Key tables: `features`, `chromosome`, `transcript_seq`, `cds_seq`, `protein_seq`, `gene_xref`, `gene_go`, `gene_kegg`, `gene_kegg_pathway`. DB is opened read-only at startup; indexes (`gene_index_by_id`, `gene_index_by_symbol`, `genes_by_seqid`, `chromosome_by_seqid`) are built in memory on app startup.

### PostgreSQL ESC Schema (Docker 5433, grcg6a database)

**gene_xref extensions** (ESC):
- `gene_alias` — Gene aliases (alias_type: legacy_gene_id / loc_id / symbol / ncbi_gene_id etc.)
- `unmapped_feature` — Unmappable annotations (tRNA/miRNA)
- `gene_xref` new fields: `gene_type`, `display_symbol`, `is_canonical`

**Expression star-schema**:
- `dataset` — Dataset definitions (4: raw_ballgown_36 / day_deseq2_36 / day_featurecounts_36 / esc_srr_23[deprecated])
- `expr_metric` — Metric definitions (tpm / fpkm / normcount / raw_count)
- `dataset_sample` — Dataset-sample associations (144 rows: 4 datasets × 36 samples)
- `expression_sample` — Sample metadata (36 rows: 6 stages × 2 sexes × 3 replicates)
- `expression_fact` — Expression fact table (~3.3M rows, gene × sample × metric center table)
- `gene_expression_summary` — Pre-aggregated stats (93,040 rows: mean/max/min/std/cv/sex_bias/stage_means/top_stage/fold_change)

**dataset_alias table** (V002 migration):
- `alias_code` → `canonical_code` mapping
- Currently empty (no active aliases after 2026-05-18 expression data update)

**mv_dataset_metric materialized view** (V003 migration):
- (dataset, metric) capability registry; `ExpressionService` validates user query against enabled pairs

**Staging tables**:
- `stg_esc_master` — ESC raw data (23 SRR Run × 3 metrics)
- `stg_day_deseq2` — DESeq2 results (36-sample wide table)
- `stg_update_expression_matrix` — Raw staging: 100% of source matrix data (V007)
- `gene_source_mapping` — Audit trail: source gene_id → canonical mapping (V007)
- `import_batch` — Import run tracking with file hashes and gene counts (V007)

### KEGG Asset Tables (from KGML cache import)
| Table | Rows | Description |
|------|------|------|
| `kegg_pathway_asset` | ~195 | PNG/KGML file metadata, width/height, stats |
| `kegg_pathway_node` | ~31000 | KGML node coordinates (left/top/right/bottom/graphics_type) |
| `kegg_pathway_node_gene` | ~15000 | Node-gene mapping (kegg_gene_id → gene_symbol) |

**Key fields:**
- `kegg_pathway_asset`: `png_relpath` (relative to project root, backslash like `static\kegg_pathways\{id}.png`; resolve via `GRCG6A_STATIC_ROOT.parent` and normalize), `png_url`, `png_width`, `png_height`, `kgml_filename`, `node_count`, `gene_count`
- `kegg_pathway_node`: `entry_id`, `entry_type`, `entry_name`, `graphics_type`, `x/y/width/height`, `left_x/top_y/right_x/bottom_y`, `raw_names`, `link_url`
- `kegg_pathway_node_gene`: `node_id` (FK to node), `kegg_gene_id` (format `gga:NNNNNN`), `gene_symbol`

**Import script**: `backend/scripts/import_kegg_kgml_cache.py`
```bash
# Initialize schema
sqlite3 grcg6a_nc.db < backend/scripts/kegg_schema.sql

# Bulk import (PNG=kegg_pathways, KGML=kegg_kgml)
python backend/scripts/import_kegg_kgml_cache.py --db grcg6a_nc.db --png-dir static/kegg_pathways --kgml-dir static/kegg_kgml --replace

# Single pathway
python backend/scripts/import_kegg_kgml_cache.py --pathway-id gga00010 --replace

# Dry run (no writes)
python backend/scripts/import_kegg_kgml_cache.py --dry-run
```

**Pre-fill `pathway_class`**: `backend/scripts/fetch_kegg_pathway_class.py`
```bash
# Fill all null pathway_class values (195 rows, includes 9 Overview-derived + gga04977)
cd backend && python scripts/fetch_kegg_pathway_class.py
```

**`/mapdata` response format** (`nodes` array, each node contains):
- `left/top/right/bottom` — Pixel coordinates usable directly by frontend (KGML center points already converted)
- `url` — Node jump link (`https://www.kegg.jp/entry/{kegg_gene_id}`)
- `graphics_type` — rectangle / circle / line, etc.
- `highlighted` — Whether node is the queried gene (exact kegg_gene_id match)
- `image_width/image_height` — PNG original pixel dimensions from `kegg_pathway_asset` table
- `node_count` — Total node count (backend response field, frontend type alias `total_nodes`)
- **No `genes` array** — mapdata nodes are per-gene, one node per hotspot

> **Note**: `/mapdata` response field names differ from `KEGGPathwayNode` type — use `KEGGPathwayMapdataNode` type instead.

**Frontend KEGG data loading**: GenePage calls `getGeneKEGGAnnotations(geneId)` which hits `/annotations/kegg/{gene_id}` to get the pathway list; each `pathway` contains `png_url` (`/static/kegg_pathways/`), `mapdata_api`, `interactive_api`.

> **Note**: The `pathway_class` field is pre-populated for all 195 pathways (`backend/scripts/fetch_kegg_pathway_class.py`), so no live KEGG REST API requests are needed — API responses are very fast. The 9 Overview-type pathways (gga01100, etc.) have class derived as `"Metabolism; Global/Overview maps"`.

### Sample Results (pre-generated)
Charts (12 types), tables, result JSON, metadata. Charts: amino_acid_composition_bar, assembly_contig_length_bar, assembly_length_histogram, cds_gc123_bar, cds_length_distribution, cds_start_codon_bar, gene_length_distribution, genome_gc_window_line, gff_biotype_bar, gff_feature_type_bar, protein_length_distribution, plus additional charts per job. Interactive HTML via Plotly.

## Key Patterns

- **API Client**: All backend calls go through `src/lib/apiClient.ts`. Never hardcode URLs — use `apiFetch<T>(path)` which prefixes `API_BASE` automatically. All API functions in `geneApi.ts`/`genomeApi.ts`/`chatApi.ts` use `apiFetch` internally.
- **Genome API paths**: All `genomeApi.ts` functions use `/genome-api/` prefix (changed from `/genome/`). Frontend components only call `genomeApi.ts` functions — never hardcode `/genome-api/` paths directly.
- **Gene IDs**: `gene-XXXXX` format (e.g., `gene-A4GALT`). Search accepts gene_id, symbol, name, or ncbi_gene_id. Use `resolveGeneId()` to canonicalize before API calls — geneApi functions call this internally, components should NOT call search separately.
- **Chromosome IDs**: seqid is the NC_ accession (e.g., `NC_006088.5`); chr_name is the display name (e.g., `1`, `W`, `Z`, `MT`). `genes_by_seqid` uses seqid as key.
- **JBrowse**: Chromosome list in `JBrowsePage.tsx` hardcodes the 35 GRCg6a chromosomes (chr1–32, chrW, chrZ, chrMT) with their NC_ accessions. Search uses the chr-only FASTA (`.chr.fna`) so only these 35 appear — NW_ scaffolds are excluded. Gene-specific navigation via `?loc=chrN:start..end` query param (e.g. from GeneStructurePlot "Open in JBrowse" button); NC_ accessions are auto-converted to chr IDs using a 35-entry lookup table. Navigate to `${chr.id}:1..${Math.min(chr.length, 5000000)}`. BigWig tracks in `jbrowseConfig.ts` use `QuantitativeTrack` + `BigWigAdapter` referencing `/bwdata/*.bw` (29 files, stage × sex × replicate naming, e.g. `E0_Female1.bw`). **NOTE: BigWig files have non-standard header byte order — mixed BE/LE in 8-byte offset fields. UCSC `bedGraphToBigWig` re-generation required for full JBrowse2 compatibility.**
- **Chat**: Never hardcode numbers in responses. All stats must come from `state.sql.execute("SELECT ...")` or in-memory indexes. Chromosome lookup uses `chr_name` field, not hardcoded NC_ mapping.
- **Mantine**: `size` prop with `rem()` for responsive sizing. `<Button component={Link}>` for nav links. `useDisclosure` for modal state. `<Text>` defaults to `<p>` — never nest block elements (`<div>`, `<Badge>`, `<Card>`) inside `<Text>`; use `component="span"` if Badge is needed inline.
- **React Router v7**: `<Routes>` + `<Route element=...>` pattern in App.tsx.
- **Genome analysis**: `/genome-api/analysis/run` submits jobs; `/genome-api/sample/*` serves pre-generated results without running analysis.
- **Interactive charts**: Load HTML via `fetch` + `srcDoc` in iframe. Show Loader in Modal while fetching; never show blank iframe.
- **Expression Status**: Three states only — `'available'`, `'no_data'`, `'unavailable'`. Check `status === 'available'` before rendering charts/tables. Never check for `'pg_unavailable'`.
- **KEGG Interactive Viewer**: `KeggInteractiveViewer` uses Drawer + CSS fullscreen (`size="100%"` toggle). PNG + SVG overlay; `getKEGGPathwayMapdata(pathwayId, geneId)` highlights genes. `viewBox="0 0 ${pngW} ${pngH}"` uses backend raw pixel coordinates; `ResizeObserver` watches img size changes. Node click → `window.open(node.url)` to KEGG. Highlight match: kegg_gene_id exact match. CSS: `.kegg-pulse-ring { animation: kegg-pulse 1.8s ease-in-out infinite }` (`App.css`).
- **GO DAG Viewer (`GOTermDagViewer.tsx`)**: Cytoscape.js + cytoscape-dagre rendering via dynamic `import("cytoscape")` / `import("cytoscape-dagre")`. Type declarations at `src/types/cytoscape-dagre.d.ts`. Uses `createPortal` for fullscreen overlay (not Mantine Modal) to avoid React/Cytoscape DOM unmount race conditions. Live cy instance stored on container as `container._cy` for toolbar access. DAG data fetched via `getGOTermDag()` from `goDagApi.ts`. Selector-based tap events (`cy.on("tap", "node", ...)`) for popup display.
- **KEGG image paths**: `_get_asset_path()` in `kegg_image_router.py` resolves `png_relpath` using `GRCG6A_STATIC_ROOT.parent` (project root), not filesystem root.
- **Plotly charts**: `plotly.js-dist-min` + `react-plotly.js`; types declared in `src/plotly.d.ts` (required because `@types/plotly.js` does not cover the dist bundle). Expression chart components use `any[]` for trace/layout/config to avoid type conflicts; keep eslint-disable annotations nearby if adding new traces.
- **ECharts charts**: `echarts` + `echarts-for-react` (installed in package.json); types declared in `src/echarts-for-react.d.ts` (includes `onEvents` prop). GO Enrichment Dotplot/Barplot panels use ECharts; expression heatmap/trend/distribution/zscore/FC-trajectory also use ECharts. Use `notMerge` + `key` on `ReactECharts` to ensure clean re-render on data change. Type `any` is used for option objects to avoid complex ECharts type conflicts.
- **Plotly image export** (ChartFullscreenModal): Use `react-plotly`'s `onInitialized`/`onUpdate` callbacks to capture the real Plotly `graphDiv` DOM node into a `useRef`. Download sequence: save original `paper_bgcolor`/`plot_bgcolor` → `window.Plotly.relayout(gd, {paper_bgcolor:"rgba(0,0,0,0)", plot_bgcolor:"rgba(0,0,0,0)"})` → `PlotlyModule.downloadImage(gd, {format:"png", width, height, scale:2})` → restore original bg. `PlotlyModule.downloadImage` is the primary API (direct import); `window.Plotly.downloadImage` is the fallback. `PlotlyModule.relayout` does not exist on the module type — always use `window.Plotly.relayout` for the relayout calls.
- **ECharts image export** (GOEnrichmentChartFullscreen): Canvas compositing approach — no external dependency. `exportGOEnrichmentChart()` in `goEnrichmentChartExport.ts` finds all `<canvas>` elements in the modal container via `querySelectorAll`, composites them onto a single canvas at the target size (preserving relative positions), and triggers PNG download via `canvas.toDataURL()`. Background can be white or transparent. Size presets: 1200×800, 1600×1000, 2000×1200, 2400×1600. The fullscreen modal renders `GOEnrichmentVisualization` inside a Mantine `Modal fullScreen` — the export captures the canvases from that rendered content.
- **GO Enrichment service** (`go_enrichment_service.py`): Core enrichment math extracted to pure function `_compute_enrichment_for_namespace(query_go_hits, bg_go_counts, go_names, gene_info, N, n, params) → (tested_results, significant_results)`. Pure function handles: hypergeometric p-values, `min_overlap` filter (before FDR), per-ontology FDR correction, significance flagging. `_go_alt_sql_parts(cur)` helper centralizes the 3-line `_table_exists` + `_go_id_expr` + `alt_join` pattern used across 4 call sites (background builder, direct hits, annotated_count, mapping report).
- **GO Enrichment table sort**: `GOEnrichmentTable` sorts Gene Ratio and BG Ratio columns by actual computed ratio (`query_count / query_total` and `background_count / background_total`), not just the numerator count. Sort field names are `"gene_ratio"` and `"background_ratio"` (computed values), not `"query_count"` / `"background_count"` (raw integers).
- **GO Enrichment DAG stability**: All set→list conversions use `sorted()` or pre-sorted lists. `sig_terms_sorted` (sorted by FDR, p_value, go_id) is the canonical order for DAG node truncation, ancestor prioritization, and SQL `ANY()` params. `ancestor_priority` key: `(-conn_count, min_dist_from_sig, gid)` — `on_root_path` was removed because `depth_map` keys are (sig→ancestor) not (ancestor→root), so the lookup was always 999.

### Expression Data Import

**Three-Layer Architecture** (V007 migration):
1. **Staging** (multiple tables): 100% raw source data, no gene mapping, no data loss
   - `stg_update_expression_matrix` — 4 matrix files (TPM/FPKM/normcount/raw_count), includes `source_gene_id_raw` (original) + `source_gene_id` (normalized)
   - `stg_update_gene_annotation` — gene annotation (chr/start/end/strand/length)
   - `stg_featurecounts_raw` — featureCounts raw output (all columns)
   - `stg_featurecounts_summary` — featureCounts assignment summary
   - `stg_master_expression_table` — master expression table (wide format)
2. **Mapping** (`gene_source_mapping`): Full audit trail — every source gene_id tracked with status/reason
3. **Curated** (`expression_fact`): Only mapped genes, product-ready for frontend queries

**Import batch tracking** (`import_batch`): Each import run recorded with file hashes, gene counts, staging/fact row counts, status.

**QC Assertions** (`import_qc_result`): Per-file QC checks recorded during import — row counts, gene counts, 36-sample completeness, mapping completeness.

**Mapping status enum**:
- `mapped_exact_symbol` — gene_symbol exact match (confidence=1.0)
- `mapped_display_symbol` — display_symbol match (confidence=0.9)
- `mapped_alias` — gene_alias match (confidence=0.8)
- `ambiguous_symbol` — multiple genes share same symbol (excluded from fact)
- `unmapped` — no match found (excluded from fact)
- `invalid_source_id` — source gene_id is `.`, empty, or `#`-prefixed

**Update Data Import** (`backend/scripts/import_update_data.py`):
Replaces expression-related tables from `D:\jbrowsedata\projectdata\update data\` while preserving GO/KEGG/genome annotations. **All 8 files** in the directory are staged.

| File | Table | Content |
|------|-------|---------|
| `gene_TPM_matrix.tsv` | `stg_update_expression_matrix` | TPM values |
| `gene_FPKM_matrix.tsv` | `stg_update_expression_matrix` | FPKM values |
| `day_DESeq2_normalized_counts.tsv` | `stg_update_expression_matrix` | normcount values |
| `day_gene_count_matrix.tsv` | `stg_update_expression_matrix` | raw_count values |
| `day_gene_annotation.tsv` | `stg_update_gene_annotation` | Gene coordinates |
| `day_featureCounts.txt` | `stg_featurecounts_raw` | Raw featureCounts |
| `day_featureCounts.txt.summary` | `stg_featurecounts_summary` | Assignment stats |
| `day_master_expression_table.tsv` | `stg_master_expression_table` | Wide-format all metrics |

```bash
# Dry-run (no DB changes)
python backend/scripts/import_update_data.py --data-dir "D:/jbrowsedata/projectdata/update data" --dry-run

# Import (replaces expression_fact, gene_expression_summary, expression_sample, dataset_sample)
python backend/scripts/import_update_data.py --data-dir "D:/jbrowsedata/projectdata/update data"
```

**Post-import steps**:
1. Refresh materialized view: `REFRESH MATERIALIZED VIEW mv_dataset_metric;`
2. Run derived fields: `python backend/scripts/fix_summary_derived_fields.py`
3. Regenerate overview static cache: `cd backend && python -m scripts.generate_overview_static`
4. Restart backend (to pick up new data)
5. Verify API spot checks (see below)

**fold_change formula** (log2 scale):
- `fold_change_top = log2(max_stage_mean / overall_mean)`
- `fold_change_bottom = log2(min_positive_stage_mean / overall_mean)`
- Uncomputable values → `NULL` (not -999)

**Per-metric gene counts** (source vs curated):
| Dataset | Metric | Source genes | Curated genes |
|---------|--------|-------------|---------------|
| raw_ballgown_36 | tpm/fpkm | 23,701 | 23,119 |
| day_deseq2_36 | normcount | 24,154 | 23,300 |
| day_featurecounts_36 | raw_count | 24,154 | 23,300 |

**`/datasets` API lineage info**: Each dataset now includes `lineage` with batch_id, import_time, source/curated gene counts, unmapped/ambiguous counts, and per-file hash + QC summary.

**Current State** (as of 2026-05-20, V007 3-layer import):
- **Staging**: 3,445,632 matrix rows + 24,154 gene annotations + 869,544 featureCounts + 14 summary rows + 24,359 master rows
- **Mapping audit**: 24,156 source genes → 23,300 mapped + 783 unmapped + 73 ambiguous
- **expression_fact**: 3,342,168 rows (mapped genes only)
- **gene_expression_summary**: 92,838 rows (mean/max/min/std/cv/sex_bias/stage_means/top_stage populated; fold_change NULL for zero-expression genes)
- **QC**: All 14 checks passed (row counts, gene counts, 36-sample completeness, mapping completeness)

### GO Annotation Import Scripts

**Coverage note**: 60.7% GO coverage is normal for chicken (GRCg6a) — it's not a model organism like human/mouse. The two annotation sources (Ensembl BioMart + NCBI GAF) complement each other well. For publication-level enrichment analysis, consider using `evidence_filter="non_iea"` to exclude electronic annotations (IEA is 92.9% of all annotations).

**GAF Import** (`backend/scripts/import_go_from_gaf.py`):
```bash
# Dry-run (no DB changes)
python backend/scripts/import_go_from_gaf.py --gaf GCF_016699485.2_gene_ontology.gaf --dry-run

# Import
python backend/scripts/import_go_from_gaf.py --gaf GCF_016699485.2_gene_ontology.gaf --batch-size 10000
```

**gene2go Import** (`backend/scripts/import_go_from_gene2go.py`):
```bash
# Dry-run (no DB changes)
python backend/scripts/import_go_from_gene2go.py --gene2go gene2go.gz --dry-run --taxon 9031

# Import
python backend/scripts/import_go_from_gene2go.py --gene2go gene2go.gz --batch-size 10000 --taxon 9031
```

**QC Script** (`backend/scripts/qc_go_annotation_sources.py`):
```bash
python backend/scripts/qc_go_annotation_sources.py
```

**Current State** (as of 2026-05-20):
- Source: `ensembl_biomart` (144,234 annotations, 12,890 genes) + `ncbi_gaf_gcf_016699485.2` (27,239 annotations, 9,987 genes)
- Genes with GO: 14,835 (60.7% of 24,421 total gene_xref)
- Background genes: P=12,739 / C=12,893 / F=12,702
- Evidence codes: IEA 92.9%, IBA 5.1%, experimental <1%
- GO DAG: 14,651 terms, 497,764 closure rows, 65,124 edges, 3,646 alt IDs
- Migration V005: Added provenance columns (qualifier/reference/pubmed_ids/assigned_by/aspect/source_gene_id)
- Migration V006: Fixed fold_change to use stage-level means (log2 scale, NULL for uncomputable)
- **Expression data**: 3,349,440 fact rows, 23,373 genes, 36 samples, 4 metrics

## Git

```bash
git branch                    # Current branch
git log --oneline            # Recent commits
git add <files>
git commit -m "message"
git push origin <branch>
```

## Running Services

```bash
# Frontend (from C root) — runs on port 5173
npm run dev

# Backend (ONLY way — from C root) — runs on port 8001
D:\soft\python310\python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8001

# Restart all services (kill then start)
taskkill //F //IM node.exe 2>/dev/null; taskkill //F //IM python.exe 2>/dev/null

# Restart PostgreSQL Docker
cd /d/jbrowsedata/projectdata && docker-compose stop postgres && docker-compose rm -f postgres && docker-compose up -d
```

**Service status check**:
```bash
# Check if ports are listening
netstat -ano | grep -E "5173|8001"

# Quick health check
curl -s http://localhost:5173 | head -3    # Frontend
curl -s http://localhost:8001/health       # Backend
```

## Backend Tests

Backend tests run from the project root (C:). The test file is `backend/test_go_enrichment.py` and tests pure math and SQL helper logic without requiring a running database.

```bash
# Run all backend tests (from C root)
D:\soft\python310\python.exe -m backend.test_go_enrichment

# Run via pytest (if installed)
python -m pytest backend/test_go_enrichment.py
```

Key test functions:
- `test_compute_enrichment_pure` — calls production `_compute_enrichment_for_namespace()` directly with edge cases (K=0, missing go_names, min_overlap filter)
- `test_compute_enrichment_correction_none` — verifies correction=none returns raw p-values
- `test_go_alt_sql_parts` — verifies mock cursor receives correct args for `_table_exists("go_alt_id")`
- `test_hypergeometric_*` — mathematical correctness of hypergeometric p-values
- `test_fdr_*` — FDR correction behavior (BH, none, per-ontology separation, cutoff boundary)
