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
│   │   ├── gene/                 # Gene structure & transcript components
│   │   └── chat/                 # ChatWidget
│   └── lib/                      # API clients
│       ├── apiClient.ts           # Mandatory centralized fetch wrapper
│       ├── geneApi.ts            # Gene/GO/KEGG API
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
            └── V003__add_mv_dataset_metric.sql

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
  - `GenePage` — Gene detail: gene header (xref/aliases), **GeneStructurePlot** (SVG transcript visualization with drag-pan/scroll-zoom/PNG export), transcripts accordion with exons/CDS/UTR, GO (Accordion), KEGG Pathways, **Expression 模块**
    - **Data loading**: Four-layer concept — (1) Load main page via `getGenePage(geneId, false)` (no sequences), (2) Hydrate expression from `response.expression`, (3) Annotations consumed directly from `response.annotations` (no separate API calls), (4) Sequences loaded on-demand via `getGenePage(geneId, true)`
  - `ChromosomePage` — Chromosome view with gene list
  - `JBrowsePage` — Linear genome browser via @jbrowse/react-linear-genome-view2; 35 chromosome buttons, navigation via `?loc=` param; **BigWig QuantitativeTrack** integration with 29 tracks from `/bwdata/` (GRCg6a_BWDATA_ROOT config, served via `application/octet-stream` custom route)
  - `PictureMakerPage` — Single-chart generator: Gene Search + Chart Type/Dataset/Metric dropdowns + Run button → renders one of 10 expression charts. Reuses all Expression* components; includes ChartCustomizerDrawer and ChartFullscreenModal. Route: `/picture-maker`
  - `BrowserPage`, `VizPage`, `DataPage`, `BlastPage`, `ToolsPage` — Additional pages
  - **Genome module pages** (registered in App.tsx): `GenomeHomePage`, `GenomeFilesPage`, `GenomeRunPage`, `GenomeJobsPage`, `GenomeJobPage`, `GenomeResultPage`, `GenomeDownloadsPage`
- **`EscOverviewSection.tsx`** — ESC Gene Expression Atlas homepage section: 8 clickable chart cards (Sample Composition / Sex-Biased Genes / Female vs Male Scatter / Stage DEG Count / Expression Distribution / PCA / Top50 Heatmap / Trajectory Clusters). Each card opens in a `Drawer` fullscreen view via `useDisclosure` + `useHotkeys`. Heatmap uses agglomerative hierarchical clustering (pure TypeScript, single linkage) for gene ordering.
- **`DownloadsPage.tsx`** — CSV download cards for all 8 overview charts. Download via `fetch` + `Blob` + `createObjectURL` pattern hitting `/overview/<id>/csv` endpoints.
- **API clients**: `src/lib/geneApi.ts` (gene/chromosome/GO/KEGG/tools), `src/lib/genomeApi.ts` (genome analysis — **all paths use `/genome-api/` prefix**), `src/lib/chatApi.ts` (chat)
  - **`src/lib/apiClient.ts`** — **Mandatory centralized API client**. All URL construction goes through `apiFetch<T>()` here. `API_BASE` is resolved from `import.meta.env.VITE_API_BASE` (defaults to `http://localhost:8000`; **dev proxy routes most paths to port 8001**). Never hardcode URLs in components.
- **Vite proxy** (`vite.config.ts`): All common backend paths (`/api`, `/health`, `/bwdata`, `/genes`, `/search`, `/chromosomes`, `/datasets`, `/overview`, `/annotations`, `/kegg-images`, `/tools`, `/genome`) proxy to `http://localhost:8001`. **Always include new backend routes in the proxy if the frontend needs them.**
  - `resolveGeneId()` — Auto-resolves non-canonical gene IDs (symbol → gene-XXX). All gene API functions use this internally; components should NOT call search before gene API functions.
- **KEGG components** — `src/components/kegg/`: `KeggPathwaysSection` (区域容器), `KeggPathwayCard` (View/Interactive/Download/KEGG 4按钮), `KeggInteractiveViewer` (PNG+SVG等比叠加交互查看器). All image URLs use `API_BASE` from `apiClient`, not hardcoded localhost.
- **GO components** — `src/components/go/`: `GOTermCard` (单个GO条目卡片，含ID/名称/证据码/来源/定义)
- **Expression components** — `src/components/expression/`: 15 chart components + 2 structural components
  - `utils.ts` — 共享工具 (`isValidNumber`/`normalizeSex`/`STAGE_ORDER`/`resolveStageMeans`/`groupSamplesByStageSex`/`groupSamplesByStageSexReplicate`/`PLOT_CONFIG`)
  - `chartCustomizer.types.ts` — `ChartType`, `ResolvedChartStyle`, `ChartStyleConfig` 类型
  - `chartCustomizer.defaults.ts` — `CHART_TYPE_LABELS`, 各 chart type 的默认 style
  - `chartStyleResolver.ts` — `resolveChartStyle()` 根据 chart type + user config 合并出最终 `ResolvedChartStyle`
  - `useChartCustomizer` — `useDisclosure` hook 返回 `customizerOpened`/`setCustomizerOpened`，`config` 持有所有 per-chart style 配置，`setChartStyle` 更新单个 chart
  - `ChartCustomizerDrawer` — 全量样式编辑抽屉（fontSize/chartHeight/colors/chartSpecific），按 chart type 分类选择要编辑哪个
  - `ChartFullscreenModal` — 全屏弹窗（Mantine `Modal fullScreen`），捕获 Plotly graph div via `onInitialized`/`onUpdate` → `graphDivRef`，提供 Export Settings（Size/Filename/Background/Download）。**下载走 `PlotlyModule.downloadImage`** + `window.Plotly.relayout` 透明背景
  - `chartFullscreen.types.ts` — `FullscreenChartType` union 和 `FullscreenState` 接口
  - `ExpressionHeader` — Dataset/Metric 选择器 + Expand All 切换
  - `ExpressionStatsRow` — 7 张统计卡片（Max/Min/Mean±Std/CV/Expressed/Top Stage/Sex Bias）
  - `ExpressionStageChart` — Plotly 分组柱状图（Male/Female + Total Mean 折线，双 Y 轴）
  - `ExpressionLineChart` — Plotly 折线图（按 stage_order 排序，含 Male/Female 分色）
  - `ExpressionTable` — 可排序/可筛选/可分页（12/页）/CSV 导出/多基准 Log2FC（E0/Mean/Stage median SegmentedControl）/SortIcon 提取到组件外
  - `ExpressionComparePanel` — Expand All 跨数据集对比面板（Dataset Tabs + 指标切换）
  - `ExpressionHeatmap` — Stage × Sex 热力图（基于 stage_means）
  - `ExpressionStackedArea` — 堆叠面积图（Male/Female 分层填充 + Total Mean 折线）
  - `ExpressionRadarChart` — Male vs Female 雷达图（归一化到 [0,1]）
  - `ExpressionViolinPlot` — 小提琴图（按 stage×sex 分布，含内嵌箱线图）
  - `ExpressionFoldChangeBar` — log2 Fold Change 柱状图（Top/Bottom Stage 上调/下调色彩）
  - `ExpressionDendrogram` — 样本聚类散点图（Male 圆形 / Female 菱形，按 stage 排列）
  - `ExpressionZScoreChart` — Z-Score 样本谱图（折线图，M/F 分色 + 零线参考）
  - `ExpressionFoldChangeTrajectory` — 相邻阶段 log2FC 分组柱状图
  - `ExpressionReplicateConsistency` — 纯 Mantine 布局：Progress 条 + CV% 预警 Badge + 一致性标签；CV 按 stage×sex 组内 3 个 replicate 计算，附详细分析说明 Popover
  - `ExpressionSection` — 整合所有 Expression 组件，`fullscreenState` state 管理全屏弹窗开关
  - `EscOverviewSection` — ESC Atlas 首页区域，8 个 chart card 点击开 Drawer 全屏（`useDisclosure` + `useHotkeys`）
- **Gene components** — `src/components/gene/`:
  - `GeneStructurePlot` — SVG gene structure visualization (black body line, blue CDS blocks, gray UTR, intron lines, GT/AG splice triangles, drag-pan, scroll-zoom, hover tooltip in English, PNG export). "Open in JBrowse" button navigates to `/jbrowse?loc=chrN:start..end`. Single-transcript selector above transcript accordion in GenePage.
- **Chat**: `src/components/chat/` — ChatWidget (floating), ChatWindow, ChatLauncher, ChatMessageBubble. All responses are grounded in database queries, no hardcoded facts.

### Backend (backend/)

- **config.py** — Centralized path configuration. All paths resolve to `D:\jbrowsedata\projectdata\` unless overridden by env vars. All modules import from here; no hardcoded paths.
- **main.py** — **The only supported entry point**. Must be started as `uvicorn backend.main:app`. Responsibilities: app creation, lifespan (DB pools + gffutils + in-memory indexes), middleware, exception handlers, router registration. **No business logic** lives here.
- **api/** — Route modules (all importable as `from backend.api.xxx`):
  - `go_kegg_routes.py` — Gene/GO/KEGG endpoints (prefix `/annotations`)
  - `overview_routes.py` — ESC Atlas overview charts (prefix `/overview`)
  - `genome_analysis_routes.py` — Genome analysis (prefix `/genome-api`) — **NOTE: prefix was changed from `/genome`**
  - `kegg_image_router.py` — KEGG pathway image serving (prefix `/kegg-images`)
  - `tool_routes.py` — Primer3, Domain Search (prefix `/tools`)
  - `chat_router.py` — Chat (prefix `/api`)
- **expression_service.py** — Expression data service (ESC star schema queries, `stage_means` aggregation, cross-dataset comparison). Depends on `mv_dataset_metric` materialized view.
- **overview_service.py** — Overview aggregation (8 chart services). Reads from `gene_expression_summary` JSONB `stage_means`; `jsonb_object_keys()` returns `text`, use `stage_key::text` cast in `->>` chains.
- **genome_analysis/** — Analysis engine (imported at runtime, not at startup):
  - `analyzer.py`, `task_manager.py`, `output_config.py`, `carousel_service.py`, `file_discovery.py`, `chart_exporter.py`, `chart_styles.py`, `settings.py`
- **db/migrations/** — Versioned SQL migrations (authoritative source for schema changes):
  - `V002__add_dataset_alias.sql` — `dataset_alias` table for dataset code aliases
  - `V003__add_mv_dataset_metric.sql` — `mv_dataset_metric` materialized view for (dataset, metric) capability registry

## Backend Endpoints

### Core Gene API (11)
- `GET /` — API 根信息
- `GET /health` — 健康检查
- `GET /chromosomes` — 染色体列表
- `GET /chromosomes/{seqid}` — 染色体详情
- `GET /chromosomes/{seqid}/genes` — 染色体上的基因
- `GET /search/genes?q=` — 基因搜索
- `GET /genes/{gene_id}` — 基因详情
- `GET /genes/{gene_id}/transcripts` — 转录本
- `GET /genes/{gene_id}/sequences` — 序列
- `GET /genes/{gene_id}/page` — 完整基因页面（含 annotations.go / annotations.kegg / expression）
- `GET /genes/{gene_id}/expression` — 独立表达数据端点（支持 `?dataset=` / `?metric=` / `?expand=true`）

### Datasets (1)
- `GET /datasets` — 返回所有可用数据集及其指标信息（用于 Expression 模块选择器）

### GO/KEGG Annotations (11, prefix `/annotations`)
- `GET /annotations/go/{gene_id}` — GO 注释
- `GET /annotations/kegg/{gene_id}` — KEGG 通路（含 png_url/kgml_url/mapdata_api）
- `GET /annotations/kegg/pathways` — 所有 KEGG 通路列表（含节点统计）
- `GET /annotations/kegg/pathway/{pathway_id}` — 通路详情（含成员基因）
- `GET /annotations/kegg/pathway/{pathway_id}/info` — 通路元信息（来自 kegg_pathway_asset）
- `GET /annotations/kegg/pathway/{pathway_id}/image` — 通路 PNG 图片
- `GET /annotations/kegg/pathway/{pathway_id}/mapdata` — 节点坐标 JSON（含 nodes 数组）；**支持 `?highlight_gene=` 参数**高亮特定基因在图中的所有出现位置
- `GET /annotations/kegg/pathway/{pathway_id}/interactive` — 可交互 HTML 数据（支持 `?highlight_gene=` 查询目标基因）
- `GET /annotations/kegg/kgml-cache/status` — KGML 缓存状态
- `POST /annotations/kegg/kgml-cache/refresh/{pathway_id}` — 刷新单通路 KGML
- `POST /annotations/kegg/kgml-cache/refresh` — 批量刷新 KGML

### KEGG Images (2, prefix `/kegg-images`)
- `GET /kegg-images/{pathway_id}.png` — KEGG 通路图片
- `GET /kegg-images/{pathway_id}/info` — 图片信息

### Tools (2, prefix `/tools`)
- `GET /tools/primer3` — Primer3 PCR 引物设计（query 参数：`gene_id`, `include_flank`, `product_size_min/max`, `num_primers`）
- `GET /tools/domain-search` — HMMER/Pfam 蛋白结构域搜索（query 参数：`gene_id`）

### Genome Analysis (21, prefix `/genome-api`) — **NOTE: prefix changed from `/genome`**
- `GET /genome-api/health` — 模块健康检查
- `GET /genome-api/files` — 扫描基因组文件
- `POST /genome-api/files/scan` — 重新扫描文件
- `POST /genome-api/analysis/run` — 提交分析任务
- `GET /genome-api/jobs` — 任务列表
- `GET /genome-api/jobs/{job_id}` — 任务详情
- `GET /genome-api/jobs/{job_id}/result` — 分析结果
- `GET /genome-api/jobs/{job_id}/result/{module_name}` — 单模块结果
- `GET /genome-api/jobs/{job_id}/downloads` — 下载列表
- `GET /genome-api/carousel` — 轮播图清单
- `GET /genome-api/carousel/images` — 轮播图片列表
- `GET /genome-api/charts/{job_id}/{chart_key}/json` — 图表 JSON
- `GET /genome-api/charts/{job_id}/{chart_key}/html` — 图表 HTML
- `GET /genome-api/download/public/carousel/{filename}` — 下载轮播图
- `GET /genome-api/download/{job_id}/{category}/{filename}` — 下载分析结果
- `GET /genome-api/sample/status` — 预生成结果状态
- `GET /genome-api/sample/result` — 预生成分析结果
- `GET /genome-api/sample/downloads` — 预生成下载列表
- `GET /genome-api/sample/charts/{key}/{format}` — 图表 (html/png/svg/json)
- `GET /genome-api/sample/tables/{name}/{format}` — 表格 (csv/xlsx)
- `GET /genome-api/sample/{category}/{filename}` — 样本结果/元数据文件

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
- `POST /api/chat` — `{ "message": "..." }` → `{ "reply": "...", "type": "...", "data": {...} }`. Intent 从消息中检测，直接查询数据库。支持的 intent: genome_stats, gene_search, chromosome, go, kegg, analysis_results。

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
| `GRCG6A_PG_DSN` | `postgresql://grcuser:grcpassword@127.0.0.1:5433/grcg6a` | PostgreSQL 连接字符串 |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:5174` | CORS allowed origins (comma-separated) |

**PostgreSQL 启动**（Docker）：
```bash
cd /d/jbrowsedata/projectdata && docker-compose up -d postgres
```

All backend modules import from `config.py` — never hardcode `D:\jbrowsedata\projectdata` directly.

### Dual-Database Architecture

| 数据库 | 用途 | 驱动 |
|--------|------|------|
| **SQLite** (gffutils) | GFF 特征、染色体、序列、搜索 | `gffutils` 库，读写 gff 文件 |
| **PostgreSQL** (Docker 5433) | GO/KEGG 注释、基因表达数据 | `psycopg2` 连接池 |

**设计原因**：gffutils 的区间索引和父子特征管理只能用于 SQLite；GO/KEGG/Expression 是标准关系型数据，用 PostgreSQL 更合适。

**连接管理**：
```python
pg_conn = pg_getconn()    # 从 ThreadedConnectionPool 借
try:
    cur.execute("SELECT ...")
finally:
    pg_putconn(pg_conn)   # 归还池中
```

**PG 不可用时自动降级**：GO/KEGG/Expression 端点返回 `status: "unavailable"`，不影响 SQLite 核心功能。GenePage 统一检查 `status === 'unavailable'` 即可捕获所有降级场景。

### Gene Expression Response

`GET /genes/{gene_id}/expression` 和 `/genes/{gene_id}/page.expression` 均返回表达数据：

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

**ESC 星型模型可用数据集**（`dataset` 表）：
| dataset_code | dataset_name | 支持指标 |
|---|---|---|
| `day_deseq2_36` | DESeq2 NC — 36 发育阶段样本 | normcount |
| `raw_ballgown_36` | Ballgown TPM/FPKM — 36 发育阶段样本 | tpm, fpkm |
| `esc_srr_23` | ESC SRR Runs — 23 个 SRA Runs | tpm, fpkm, normcount |

### Registered Routers
所有路由已在 `main.py` 中注册：

| 路由文件 | 前缀 | 接口数 |
|---|---|---|
| main.py (inline) | `/` | 11 |
| go_kegg_routes.py | `/annotations` | 11 |
| kegg_image_router.py | `/kegg-images` | 2 |
| tool_routes.py | `/tools` | 2 |
| genome_analysis_routes.py | `/genome-api` | 21 |
| chat_router.py | `/api` | 1 |
| overview_routes.py | `/overview` | 17 |
| **总计** | | **65** |

### Database Schema (grcg6a_nc.db)
Key tables: `features`, `chromosome`, `transcript_seq`, `cds_seq`, `protein_seq`, `gene_xref`, `gene_go`, `gene_kegg`, `gene_kegg_pathway`. DB is opened read-only at startup; indexes (`gene_index_by_id`, `gene_index_by_symbol`, `genes_by_seqid`, `chromosome_by_seqid`) are built in memory on app startup.

### PostgreSQL ESC Schema (Docker 5433, grcg6a database)

**gene_xref 扩展**（ESC）：
- `gene_alias` — 基因别名（alias_type: legacy_gene_id / loc_id / symbol / ncbi_gene_id 等）
- `unmapped_feature` — 无法映射的注释（tRNA/miRNA）
- `gene_xref` 新增字段：`gene_type`, `display_symbol`, `is_canonical`

**表达星型模型**：
- `dataset` — 数据集定义（3 个：raw_ballgown_36 / day_deseq2_36 / esc_srr_23）
- `expr_metric` — 指标定义（tpm / fpkm / normcount / raw_count）
- `dataset_sample` — 数据集-样本关联（SRA Run / stage / sex / replicate / tissue / batch）
- `expression_sample` — 样本元信息（stage / stage_label / sex / replicate）
- `expression_fact` — 表达事实表（~3M 行，基因×样本×指标的中心表）
- `gene_expression_summary` — 预聚合统计（mean/max/min/std / sex_bias / stage_means）

**dataset_alias 表**（V002 migration）：
- `alias_code` → `canonical_code` 映射，用于解析 `raw_ballgown_36` → `esc_srr_23` 等别名

**mv_dataset_metric 物化视图**（V003 migration）：
- (dataset, metric) 能力注册表，`ExpressionService` 验证用户查询的 (dataset, metric) 是否启用

**Staging 表**：
- `stg_esc_master` — ESC 原始数据（23 SRR Run × 3 种 metric）
- `stg_day_deseq2` — DESeq2 结果（36 样本宽表）

### KEGG Asset Tables (from KGML 解析入库)
| 表名 | 行数 | 说明 |
|------|------|------|
| `kegg_pathway_asset` | ~195 | PNG/KGML 文件元数据、宽高、统计 |
| `kegg_pathway_node` | ~31000 | KGML 节点坐标（left/top/right/bottom/graphics_type） |
| `kegg_pathway_node_gene` | ~15000 | 节点-基因映射（kegg_gene_id → gene_symbol） |

**关键字段：**
- `kegg_pathway_asset`: `png_relpath`（相对项目根，含反斜杠如 `static\kegg_pathways\{id}.png`；读取时需用 `GRCG6A_STATIC_ROOT.parent` 拼接并规范化）, `png_url`, `png_width`, `png_height`, `kgml_filename`, `node_count`, `gene_count`
- `kegg_pathway_node`: `entry_id`, `entry_type`, `entry_name`, `graphics_type`, `x/y/width/height`, `left_x/top_y/right_x/bottom_y`, `raw_names`, `link_url`
- `kegg_pathway_node_gene`: `node_id`（关联 node）, `kegg_gene_id`（格式 `gga:NNNNNN`）, `gene_symbol`

**导入脚本**：`backend/scripts/import_kegg_kgml_cache.py`
```bash
# 初始化表结构
sqlite3 grcg6a_nc.db < backend/scripts/kegg_schema.sql

# 批量导入（PNG=kegg_pathways, KGML=kegg_kgml）
python backend/scripts/import_kegg_kgml_cache.py --db grcg6a_nc.db --png-dir static/kegg_pathways --kgml-dir static/kegg_kgml --replace

# 单通路
python backend/scripts/import_kegg_kgml_cache.py --pathway-id gga00010 --replace

# 干跑（不写入）
python backend/scripts/import_kegg_kgml_cache.py --dry-run
```

**预填充 `pathway_class`**：`backend/scripts/fetch_kegg_pathway_class.py`
```bash
# 填充所有空值 pathway_class（195 条，含 9 条 Overview 推导值 + gga04977）
cd backend && python scripts/fetch_kegg_pathway_class.py
```

**`/mapdata` 返回格式**（`nodes` 数组，每节点含）：
- `left/top/right/bottom`：前端可直接用的像素坐标（KGML 中心点已转换）
- `url`：节点跳转链接（`https://www.kegg.jp/entry/{kegg_gene_id}`）
- `graphics_type`：rectangle / circle / line 等
- `highlighted`：节点是否为当前查询基因（kegg_gene_id 精确匹配）
- `image_width/image_height`：来自 `kegg_pathway_asset` 表的 PNG 原始像素尺寸
- `node_count`：节点总数（backend 返回字段，frontend 类型别名 `total_nodes`）
- **无 `genes` 数组** — mapdata 节点是 per-gene 的，每个 hotspot 一个节点

> **注意**：`/mapdata` 响应中字段名与 `KEGGPathwayNode` 类型不同 — 使用 `KEGGPathwayMapdataNode` 类型。

**前端 KEGG 数据加载**：GenePage 通过 `getGeneKEGGAnnotations(geneId)` 调用 `/annotations/kegg/{gene_id}` 获取通路列表，每个 `pathway` 含 `png_url`（`/static/kegg_pathways/`）、`mapdata_api`、`interactive_api`。

> **注意**：`pathway_class` 字段已预填充至全部 195 条通路（`backend/scripts/fetch_kegg_pathway_class.py`），无需实时请求 KEGG REST API，接口响应极快。9 条 Overview 类通路（gga01100 等）的 class 为 `"Metabolism; Global/Overview maps"` 推导值。

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
- **KEGG Interactive Viewer**：`KeggInteractiveViewer` 使用 Drawer + CSS fullscreen（`size="100%"` 切换）实现全屏。PNG + SVG overlay，`getKEGGPathwayMapdata(pathwayId, geneId)` 高亮基因。`viewBox="0 0 ${pngW} ${pngH}"` 使用后端原始像素坐标，`ResizeObserver` 监听 img 尺寸变化。点击节点 `window.open(node.url)` 跳转 KEGG。highlighted 判断：kegg_gene_id 精确匹配。CSS: `.kegg-pulse-ring { animation: kegg-pulse 1.8s ease-in-out infinite }`（`App.css`）。
- **KEGG image paths**: `_get_asset_path()` in `kegg_image_router.py` resolves `png_relpath` using `GRCG6A_STATIC_ROOT.parent` (project root), not filesystem root.
- **Plotly charts**: `plotly.js-dist-min` + `react-plotly.js`; types declared in `src/plotly.d.ts` (required because `@types/plotly.js` does not cover the dist bundle). Expression chart components use `any[]` for trace/layout/config to avoid type conflicts; keep eslint-disable annotations nearby if adding new traces.
- **Plotly image export** (ChartFullscreenModal): Use `react-plotly`'s `onInitialized`/`onUpdate` callbacks to capture the real Plotly `graphDiv` DOM node into a `useRef`. Download sequence: save original `paper_bgcolor`/`plot_bgcolor` → `window.Plotly.relayout(gd, {paper_bgcolor:"rgba(0,0,0,0)", plot_bgcolor:"rgba(0,0,0,0)"})` → `PlotlyModule.downloadImage(gd, {format:"png", width, height, scale:2})` → restore original bg. `PlotlyModule.downloadImage` is the primary API (direct import); `window.Plotly.downloadImage` is the fallback. `PlotlyModule.relayout` does not exist on the module type — always use `window.Plotly.relayout` for the relayout calls.

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
# Frontend (from C root)
npm run dev

# Backend (ONLY way — from C root)
D:\soft\python310\python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8001

# Restart PostgreSQL Docker
cd /d/jbrowsedata/projectdata && docker-compose stop postgres && docker-compose rm -f postgres && docker-compose up -d
```
