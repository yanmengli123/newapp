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
  - `GenePage` — Gene detail: transcripts, exons, CDS, GO, KEGG
  - `ChromosomePage` — Chromosome view with gene list
  - `JBrowsePage` — Linear genome browser via @jbrowse/react-linear-genome-view2
  - `BrowserPage`, `VizPage`, `DataPage`, `BlastPage`, `ToolsPage` — Additional pages
  - **Genome module pages** (registered in App.tsx): `GenomeHomePage`, `GenomeFilesPage`, `GenomeRunPage`, `GenomeJobsPage`, `GenomeJobPage`, `GenomeResultPage`, `GenomeDownloadsPage`
- **API clients**: `src/lib/geneApi.ts` (gene/chromosome/GO/KEGG/tools), `src/lib/genomeApi.ts` (genome analysis), `src/lib/chatApi.ts` (chat)
- **KEGG components** — `src/components/kegg/`: `KeggPathwaysSection` (区域容器), `KeggPathwayCard` (View/Interactive/Download/KEGG 4按钮), `KeggInteractiveViewer` (PNG+SVG等比叠加交互查看器)
- **Chat**: `src/components/chat/` — ChatWidget (floating), ChatWindow, ChatLauncher, ChatMessageBubble. All responses are grounded in database queries, no hardcoded facts.

### Backend (backend/)
- **config.py** — Centralized path configuration. All modules import from here; no hardcoded `D:\jbrowsedata\projectdata` paths allowed.
- **main.py** — FastAPI app, lifespan context (opens gffutils + SQLite), registers all routers
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

### Core Gene API (10)
- `GET /` — API 根信息
- `GET /health` — 健康检查
- `GET /chromosomes` — 染色体列表
- `GET /chromosomes/{seqid}` — 染色体详情
- `GET /chromosomes/{seqid}/genes` — 染色体上的基因
- `GET /search/genes?q=` — 基因搜索
- `GET /genes/{gene_id}` — 基因详情
- `GET /genes/{gene_id}/transcripts` — 转录本
- `GET /genes/{gene_id}/sequences` — 序列
- `GET /genes/{gene_id}/page` — 完整基因页面（含GO/KEGG）

### GO/KEGG Annotations (11, prefix `/annotations`)
- `GET /annotations/go/{gene_id}` — GO 注释
- `GET /annotations/kegg/{gene_id}` — KEGG 通路（含 png_url/kgml_url/mapdata_api）
- `GET /annotations/kegg/pathways` — 所有 KEGG 通路列表（含节点统计）
- `GET /annotations/kegg/pathway/{pathway_id}` — 通路详情（含成员基因）
- `GET /annotations/kegg/pathway/{pathway_id}/info` — 通路元信息（来自 kegg_pathway_asset）
- `GET /annotations/kegg/pathway/{pathway_id}/image` — 通路 PNG 图片
- `GET /annotations/kegg/pathway/{pathway_id}/mapdata` — 节点坐标 JSON（含 nodes 数组）
- `GET /annotations/kegg/pathway/{pathway_id}/interactive` — 可交互 HTML 数据（支持 `?gene_id=` 查询目标基因）
- `GET /annotations/kegg/kgml-cache/status` — KGML 缓存状态
- `POST /annotations/kegg/kgml-cache/refresh/{pathway_id}` — 刷新单通路 KGML
- `POST /annotations/kegg/kgml-cache/refresh` — 批量刷新 KGML

### KEGG Images (2, prefix `/kegg-images`)
- `GET /kegg-images/{pathway_id}.png` — KEGG 通路图片
- `GET /kegg-images/{pathway_id}/info` — 图片信息

### Tools (2, prefix `/tools`)
- `POST /tools/primer3` — Primer3 PCR 引物设计
- `POST /tools/domain-search` — HMMER/Pfam 蛋白结构域搜索

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

All backend modules import from `config.py` — never hardcode `D:\jbrowsedata\projectdata` directly.

### Registered Routers
所有路由已在 `main.py` 中注册：

| 路由文件 | 前缀 | 接口数 | 状态 |
|---|---|---|---|
| main.py | `/` | 10 | 已注册 |
| go_kegg_routes.py | `/annotations` | 11 | 已注册 |
| kegg_image_router.py | `/kegg-images` | 2 | 已注册 |
| tool_routes.py | `/tools` | 2 | 已注册 |
| genome_analysis_routes.py | `/genome` | 21 | 已注册 |
| chat_router.py | `/api` | 1 | 已注册 |
| **总计** | | **47** | |

### Database Schema (grcg6a_nc.db)
Key tables: `features`, `chromosome`, `transcript_seq`, `cds_seq`, `protein_seq`, `gene_xref`, `gene_go`, `gene_kegg`, `gene_kegg_pathway`. DB is opened read-only at startup; indexes (`gene_index_by_id`, `gene_index_by_symbol`, `genes_by_seqid`, `chromosome_by_seqid`) are built in memory on app startup.

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

**`/mapdata` 返回格式**（`nodes` 数组，每节点含）：
- `left/top/right/bottom`：前端可直接用的像素坐标
- `graphics_type`：rectangle / circle / line 等
- `genes[]`：含 `kegg_gene_id`、`gene_symbol`、`in_pathway`（是否通路注释基因）
- `highlighted`：节点是否包含通路注释基因（用于热区着色）

**`/gene/page` KEGG 整合字段**：每条 pathway 含 `png_url`、`kgml_url`、`mapdata_api`、`interactive_api`（来自 kegg_pathway_asset）

### Sample Results (pre-generated)
Charts (12 types), tables, result JSON, metadata. Charts: amino_acid_composition_bar, assembly_contig_length_bar, assembly_length_histogram, cds_gc123_bar, cds_length_distribution, cds_start_codon_bar, gene_length_distribution, genome_gc_window_line, gff_biotype_bar, gff_feature_type_bar, protein_length_distribution, plus additional charts per job. Interactive HTML via Plotly.

## Key Patterns

- **Gene IDs**: `gene-XXXXX` format (e.g., `gene-A4GALT`). Search accepts gene_id, symbol, name, or ncbi_gene_id.
- **Chromosome IDs**: seqid is the NC_ accession (e.g., `NC_006088.5`); chr_name is the display name (e.g., `1`, `W`, `Z`, `MT`). `genes_by_seqid` uses seqid as key.
- **Chat**: Never hardcode numbers in responses. All stats must come from `state.sql.execute("SELECT ...")` or in-memory indexes. Chromosome lookup uses `chr_name` field, not hardcoded NC_ mapping.
- **Mantine**: `size` prop with `rem()` for responsive sizing. `<Button component={Link}>` for nav links. `useDisclosure` for modal state.
- **React Router v7**: `<Routes>` + `<Route element=...>` pattern in App.tsx.
- **Genome analysis**: `/genome/analysis/run` submits jobs; `/genome/sample/*` serves pre-generated results without running analysis.
- **Interactive charts**: Load HTML via `fetch` + `srcDoc` in iframe. Show Loader in Modal while fetching; never show blank iframe.
- **KEGG Interactive Viewer**: PNG + SVG overlay via `viewBox` matching original image dimensions (`png_width`/`png_height`), `preserveAspectRatio="xMidYMid meet"` for responsive scaling. CSS pulse animation: `.kegg-pulse-ring { animation: kegg-pulse 1.8s ease-in-out infinite }` (defined in `App.css`).
- **KEGG image paths**: `_get_asset_path()` in `kegg_image_router.py` resolves `png_relpath` using `GRCG6A_STATIC_ROOT.parent` (project root), not filesystem root.

## Git

```bash
git branch                    # Current branch
git log --oneline            # Recent commits
git add <files>
git commit -m "message"
git push origin <branch>
```
