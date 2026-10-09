# GRCg6a Bioinformatics Browser

React/TypeScript + FastAPI platform for the GRCg6a chicken genome, expression atlas, GO/KEGG annotation, genome analysis jobs, JBrowse2, and GRCg6a/GRCg7b comparative genomics.

## Repository Layout

- `src/` - Vite React frontend.
- `backend/` - only supported FastAPI backend package.
- `backend/api/` - route modules.
- `backend/db/migrations/` - versioned PostgreSQL schema changes.
- `backend/scripts/` - data import and comparative-genomics build scripts.
- `D:\jbrowsedata\projectdata` - default external data root, not committed to this repo.

Deprecated root-level backend entrypoints now exit with a message. Start only `backend.main:app`.

## Developer Handoff and Deployment

Clone the complete frontend/backend branch:

```bash
git clone --branch fix/gene-family-tab-v1.0.1 --single-branch https://github.com/yanmengli123/newapp.git
```

See [deployment instructions](docs/DEPLOYMENT.md) for Docker Compose, Nginx,
environment configuration, database restoration, and the external data checklist.
The GitHub repository contains code and schemas; populated databases and large
scientific data must be transferred separately. The repository's `master` branch
is older than the active development branch.

## Runtime Commands

```powershell
npm run dev
npm run build
npm run lint
npm run test:api-contract

D:\soft\python310\python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8001
D:\soft\python310\python.exe -m backend.test_go_enrichment
D:\soft\python310\python.exe -m backend.test_comparative_paf
D:\soft\python310\python.exe -m backend.test_core_config
```

Frontend dev server defaults to `http://localhost:5174`; backend defaults to `http://localhost:8001`.

## Configuration

Backend paths are centralized in `backend/config.py`.

| Variable | Default |
| --- | --- |
| `GRCG6A_BASE_DIR` | `D:\jbrowsedata\projectdata` |
| `GRCG6A_DB_PATH` | `%GRCG6A_BASE_DIR%\grcg6a_nc.db` |
| `GRCG6A_RAWDATA_ROOT` | `%GRCG6A_BASE_DIR%\rawdata` |
| `GRCG6A_STATIC_ROOT` | `%GRCG6A_BASE_DIR%\static` |
| `GRCG6A_BWDATA_ROOT` | `%GRCG6A_BASE_DIR%\bwdata` |
| `DATABASE_URL` | `postgresql://grcuser:grcpassword@127.0.0.1:5433/grcg6a` |

Frontend API routing goes through `src/lib/apiClient.ts`. Components should pass relative backend paths to `apiFetch`; direct `fetch` calls must explicitly use `API_BASE`.

## Comparative Genomics Evidence Policy

The GRCg6a/GRCg7b page is evidence-layered:

- Natural-breakpoint minimap2 `asm5` PAF is the primary synteny display.
- Base-level `--cs` PAF is indexed and used for local block detail, not streamed wholesale.
- Gene collinearity is a separate functional/gene-order layer.
- Fixed-window PAF is not a fallback for the primary comparative display.
- SV results are candidates unless independently validated.

Current gold-standard status should be checked with:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8001/comparative/gold-standard
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8001/comparative/citation
```

## Verification Expectations

Before reporting a code change as complete, run at least:

```powershell
D:\soft\python310\python.exe -m backend.test_comparative_paf
D:\soft\python310\python.exe -m backend.test_go_enrichment
D:\soft\python310\python.exe -m backend.test_core_config
npm run test:api-contract
npm run lint
npm run build
```

For browser-visible changes, also verify the affected route in a browser and check backend health:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8001/health
```
