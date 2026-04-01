# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bioinformatics visualization platform for the GRCg6a chicken genome. React/TypeScript frontend with FastAPI backend. Frontend runs on port 5173, backend on port 8000.

## Commands

```bash
# Frontend
npm run dev      # Start dev server (port 5173)
npm run build    # TypeScript check + production build
npm run lint     # ESLint

# Backend
# 方式1：激活 venv 后运行
cd backend
venv\Scripts\activate
pip install -r requirements.txt
python main.py

# 方式2：直接使用系统 Python
D:\soft\python310\python.exe C:\Users\32110\Desktop\newapp\backend\main.py
```

## Architecture

### Frontend (src/)
- **App.tsx** — Route definitions; ChatWidget rendered globally here
- **Pages** — `src/pages/` (route targets in App.tsx)
  - `HomePage` — Hero, gene search, chart carousel (11 charts from sample results)
  - `GeneQueryPage` — Autocomplete gene search
  - `GenePage` — Gene detail: gene header (xref/aliases), transcripts, exons, CDS, GO (Accordion折叠卡片), KEGG Pathways, **Expression** (6-block 模块: StatsRow/StageChart/LineChart/Table/ComparePanel)
    - **Data loading**: Four-layer concept — (1) Load main page via `getGenePage(geneId, false)` (no sequences), (2) Hydrate expression from `response.expression`, (3) Annotations consumed directly from `response.annotations` (no separate API calls), (4) Sequences loaded on-demand via `getGenePage(geneId, true)`
  - `ChromosomePage` — Chromosome view with gene list
  - `JBrowsePage` — Linear genome browser via @jbrowse/react-linear-genome-view2
  - `BrowserPage`, `VizPage`, `DataPage`, `BlastPage`, `ToolsPage` — Additional pages
  - **Genome module pages** (registered in App.tsx): `GenomeHomePage`, `GenomeFilesPage`, `GenomeRunPage`, `GenomeJobsPage`, `GenomeJobPage`, `GenomeResultPage`, `GenomeDownloadsPage`
- **API clients**: `src/lib/geneApi.ts` (gene/chromosome/GO/KEGG/tools), `src/lib/genomeApi.ts` (genome analysis), `src/lib/chatApi.ts` (chat)
  - **`src/lib/apiClient.ts`** — **Mandatory centralized API client**. All URL construction goes through `apiFetch<T>()` here. `API_BASE` is resolved from `import.meta.env.VITE_API_BASE` (defaults to `http://localhost:8000`). Never hardcode URLs in components.
  - `resolveGeneId()` — Auto-resolves non-canonical gene IDs (symbol → gene-XXX). All gene API functions use this internally; components should NOT call search before gene API functions.
- **KEGG components** — `src/components/kegg/`: `KeggPathwaysSection` (区域容器), `KeggPathwayCard` (View/Interactive/Download/KEGG 4按钮), `KeggInteractiveViewer` (PNG+SVG等比叠加交互查看器). All image URLs use `API_BASE` from `apiClient`, not hardcoded localhost.
- **GO components** — `src/components/go/`: `GOTermCard` (单个GO条目卡片，含ID/名称/证据码/来源/定义)
- **Expression components** — `src/components/expression/`: 6-block Expression 模块
  - `ExpressionHeader` — Dataset/Metric 选择器 + Expand All 切换
  - `ExpressionStatsRow` — 7 张统计卡片（Max/Min/Mean±Std/CV/Expressed/Top Stage/Sex Bias）
  - `ExpressionStageChart` — Plotly 分组柱状图（Male/Female + Total Mean 折线，双 Y 轴）
  - `ExpressionLineChart` — Plotly 折线图（按 stage_order 排序，含 Male/Female 分色）. "All Samples" trace is weakened (dashed/dim) to make Male/Female lines stand out.
  - `ExpressionTable` — 可排序/可筛选/可分页（12/页）/CSV 导出（导出发filtered结果）/SortIcon 提取到组件外避免每次渲染重建
  - `ExpressionComparePanel` — Expand All 跨数据集对比面板（Dataset Tabs + 指标切换）. Maintains local `activeTab`/`localMetric` state; syncs with parent via `selectedDataset`/`selectedMetric` props and calls `onSelectDataset()` on user interactions.
- **Chat**: `src/components/chat/` — ChatWidget (floating), ChatWindow, ChatLauncher, ChatMessageBubble. All responses are grounded in database queries, no hardcoded facts.

### Backend (backend/)
- **config.py** — Centralized path configuration. All modules import from here; no hardcoded `D:\jbrowsedata\projectdata` paths allowed.
- **main.py** — FastAPI app, lifespan context (opens gffutils + SQLite + PostgreSQL pool), registers all routers
- **api/** — Route modules:
  - `go_kegg_routes.py` — Gene/GO/KEGG endpoints (**registered**, prefix `/annotations`)
  - `kegg_image_router.py` — KEGG pathway image serving via `_get_asset_path()` (**registered**, prefix `/kegg-images`)
  - `tool_routes.py` — Primer3, Domain Search tools (**registered**, prefix `/tools`)
  - `genome_analysis_routes.py` — Genome analysis job management + sample results (**registered**, prefix `/genome`)
  - `chat_router.py` — Chat (**registered**, prefix `/api`)
- **genome_analysis/** — Analysis engine (not imported by main.py at startup; called at runtime):
  - `analyzer.py` — Main analysis pipeline
  - `task_manager.py` — Job queue, state in `jobs/` JSON files
  - `output_config.py` — Chart keys, output structure
  - `carousel_service.py` — Featured carousel management
  - `file_discovery.py` — Genome file scanning
  - `chart_exporter.py` — Chart export (HTML/PNG/SVG/JSON)
  - `chart_styles.py` — Plotly chart theming
  - `settings.py` — Analysis configuration

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

### Genome Analysis (21, prefix `/genome`)
- `GET /genome/health` — 模块健康检查
- `GET /genome/files` — 扫描基因组文件
- `POST /genome/files/scan` — 重新扫描文件
- `POST /genome/analysis/run` — 提交分析任务
- `GET /genome/jobs` — 任务列表
- `GET /genome/jobs/{job_id}` — 任务详情
- `GET /genome/jobs/{job_id}/result` — 分析结果
- `GET /genome/jobs/{job_id}/result/{module_name}` — 单模块结果
- `GET /genome/jobs/{job_id}/downloads` — 下载列表
- `GET /genome/carousel` — 轮播图清单
- `GET /genome/carousel/images` — 轮播图片列表
- `GET /genome/charts/{job_id}/{chart_key}/json` — 图表 JSON
- `GET /genome/charts/{job_id}/{chart_key}/html` — 图表 HTML
- `GET /genome/download/public/carousel/{filename}` — 下载轮播图
- `GET /genome/download/{job_id}/{category}/{filename}` — 下载分析结果
- `GET /genome/sample/status` — 预生成结果状态
- `GET /genome/sample/result` — 预生成分析结果
- `GET /genome/sample/downloads` — 预生成下载列表
- `GET /genome/sample/charts/{key}/{format}` — 图表 (html/png/svg/json)
- `GET /genome/sample/tables/{name}/{format}` — 表格 (csv/xlsx)
- `GET /genome/sample/{category}/{filename}` — 样本结果/元数据文件

### Chat (1, prefix `/api`)
- `POST /api/chat` — `{ "message": "..." }` → `{ "reply": "...", "type": "...", "data": {...} }`. Intent 从消息中检测，直接查询数据库。支持的 intent: genome_stats, gene_search, chromosome, go, kegg, analysis_results。

## Data Files

All data paths are centralized in `backend/config.py` and resolve to `D:\jbrowsedata\projectdata\` unless overridden by environment variables:

| Env Var | Default | Description |
|---------|---------|-------------|
| `GRCG6A_BASE_DIR` | `D:\jbrowsedata\projectdata` | Project root |
| `GRCG6A_DB_PATH` | `.../grcg6a_nc.db` | SQLite gene DB |
| `GRCG6A_STATIC_ROOT` | `.../static` | KEGG images |
| `GRCG6A_RAWDATA_ROOT` | `.../rawdata` | Genome FASTA/GFF files |
| `GRCG6A_GENOME_OUTPUT` | `.../outputs/jobs` | Analysis job outputs |
| `GRCG6A_SAMPLE_RESULTS` | `.../outputs/sample_results` | Pre-generated results |
| `GRCG6A_HMMER_DB` | `.../hmmer_db/Pfam-A.hmm` | HMMER/Pfam domain DB |
| `GRCG6A_PG_DSN` | `postgresql://grcuser:grcpassword@127.0.0.1:5433/grcg6a` | PostgreSQL 连接字符串 |

**PostgreSQL 启动**（Docker）：
```bash
cd backend && docker compose up -d   # 端口 5433，自动初始化 schema
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
# PostgreSQL：按需从池中借/还
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
  dataset?: string;   // e.g. "day_deseq2_36"
  metric?: string;    // e.g. "normcount"
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
    sex_bias_label: string | null;   // "Female_higher" | "Male_higher" | "No_difference"
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
  stage: string;        // "E0", "E3.5", "E7", ...
  stage_label: string | null;
  stage_order: number | null;
  sex: string;         // "Male" | "Female"
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

| 路由文件 | 前缀 | 接口数 | 状态 |
|---|---|---|---|
| main.py | `/` | 12 | 已注册 |
| go_kegg_routes.py | `/annotations` | 11 | 已注册 |
| kegg_image_router.py | `/kegg-images` | 2 | 已注册 |
| tool_routes.py | `/tools` | 2 | 已注册 |
| genome_analysis_routes.py | `/genome` | 21 | 已注册 |
| chat_router.py | `/api` | 1 | 已注册 |
| **总计** | | **49** | |

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

**导入脚本**：`D:\jbrowsedata\projectdata\scripts\import_kegg_kgml_cache.py`
```bash
# 初始化表结构
sqlite3 grcg6a_nc.db < scripts/kegg_schema.sql

# 批量导入（PNG=kegg_pathways, KGML=kegg_kgml）
python scripts/import_kegg_kgml_cache.py --db grcg6a_nc.db --png-dir static/kegg_pathways --kgml-dir static/kegg_kgml --replace

# 单通路
python scripts/import_kegg_kgml_cache.py --pathway-id gga00010 --replace

# 干跑（不写入）
python scripts/import_kegg_kgml_cache.py --dry-run
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
- **Gene IDs**: `gene-XXXXX` format (e.g., `gene-A4GALT`). Search accepts gene_id, symbol, name, or ncbi_gene_id. Use `resolveGeneId()` to canonicalize before API calls — geneApi functions call this internally, components should NOT call search separately.
- **Chromosome IDs**: seqid is the NC_ accession (e.g., `NC_006088.5`); chr_name is the display name (e.g., `1`, `W`, `Z`, `MT`). `genes_by_seqid` uses seqid as key.
- **Chat**: Never hardcode numbers in responses. All stats must come from `state.sql.execute("SELECT ...")` or in-memory indexes. Chromosome lookup uses `chr_name` field, not hardcoded NC_ mapping.
- **Mantine**: `size` prop with `rem()` for responsive sizing. `<Button component={Link}>` for nav links. `useDisclosure` for modal state.
- **React Router v7**: `<Routes>` + `<Route element=...>` pattern in App.tsx.
- **Genome analysis**: `/genome/analysis/run` submits jobs; `/genome/sample/*` serves pre-generated results without running analysis.
- **Interactive charts**: Load HTML via `fetch` + `srcDoc` in iframe. Show Loader in Modal while fetching; never show blank iframe.
- **Expression Status**: Three states only — `'available'`, `'no_data'`, `'unavailable'`. Check `status === 'available'` before rendering charts/tables. Never check for `'pg_unavailable'`.
- **KEGG Interactive Viewer**：`KeggInteractiveViewer` 使用 Drawer + CSS fullscreen（`size="100%"` 切换）实现全屏。PNG + SVG overlay，`getKEGGPathwayMapdata(pathwayId, geneId)` 高亮基因。`viewBox="0 0 ${pngW} ${pngH}"` 使用后端原始像素坐标，`ResizeObserver` 监听 img 尺寸变化。点击节点 `window.open(node.url)` 跳转 KEGG。highlighted 判断：kegg_gene_id 精确匹配。CSS: `.kegg-pulse-ring { animation: kegg-pulse 1.8s ease-in-out infinite }`（`App.css`）。
- **KEGG image paths**: `_get_asset_path()` in `kegg_image_router.py` resolves `png_relpath` using `GRCG6A_STATIC_ROOT.parent` (project root), not filesystem root.
- **Plotly charts**: `plotly.js-dist-min` + `react-plotly.js`; types declared in `src/plotly.d.ts` (required because `@types/plotly.js` does not cover the dist bundle). Expression chart components use `any[]` for trace/layout/config to avoid type conflicts; keep eslint-disable annotations nearby if adding new traces.

## Git

```bash
git branch                    # Current branch
git log --oneline            # Recent commits
git add <files>
git commit -m "message"
git push origin <branch>
```
