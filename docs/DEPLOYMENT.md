# Developer deployment handoff

The frontend and backend have one canonical source repository:
<https://github.com/yanmengli123/newapp>.
The current complete development branch is `fix/gene-family-tab-v1.0.1`.
The repository's default `master` branch is older; select the branch explicitly.

```bash
git clone --branch fix/gene-family-tab-v1.0.1 --single-branch https://github.com/yanmengli123/newapp.git
cd newapp
```

The original checkout is `C:\Users\32110\Desktop\newapp`.
`D:\newapp` does not exist on the source machine as of 2026-10-09.
Code can be checked out anywhere; set the data root through environment variables
rather than replacing paths throughout the source.

## Data that must be supplied separately

A Git clone provides the application and database schemas, not the populated
scientific databases. Supply the contents of `D:\jbrowsedata\projectdata`
through a private file transfer or a managed data store, preserving relative
paths. The deployment directory is `/srv/newapp-data` in the Linux example.

| Asset | Purpose |
| --- | --- |
| `grcg6a_nc.db` | Required SQLite/gffutils database. Backend startup requires the populated `features`, `chromosome`, and `gene_xref` tables. |
| A current PostgreSQL dump | GO/KEGG, expression atlas, and comparative database tables. SQL migrations alone do not recreate the populated data. |
| Genome FASTA/GFF files and their indexes/aliases at the data root | JBrowse and sequence endpoints. Preserve the `primary_35`, `primary_42`, and `genomic.chr` filenames used by the application. |
| `rawdata/`, `static/`, `bwdata/` | Input matrices, KEGG images and BigWig tracks. |
| `comparative/`, `synteny/`, `grcg7b/` | Audited alignment evidence, indexes, provenance, and genome references. |
| `gene family/releases/gg-gf-2026-07-rc1/` | Immutable catalog SQLite and download assets. Select another release only if supplied and verified. |
| `outputs/sample_results/` | Pre-generated sample analysis results. |
| `hmmer_db/Pfam-A.hmm` | Domain search database; it must be uncompressed. |

Transfer a consistent SQLite copy taken while writers are stopped, or use SQLite's
backup facility. Include matching indexes and provenance files with the genome
data. Generate a fresh PostgreSQL backup at handoff time; a historical backup may
not match the current data release. PostgreSQL data and SQLite serve different
features, so both are needed for a full deployment.

Current source-machine gaps documented in `CLAUDE.md`: some BigWig files have an
invalid header and the Pfam database is still compressed. Those assets need
repair/preparation before accepting their corresponding features. Container
startup or `/health` returning 200 does not establish that every dataset is valid.

The 2026-10-09 handoff audit (`npm audit --omit=dev`) reported 11 production
dependency advisories: 2 critical, 4 high, and 5 moderate. These are dependency
audit findings, not proof that every advisory is reachable in this application.
Review and update the affected dependencies with regression checks before a
public production launch; the handoff preserves the existing dependency lockfile.

## Docker Compose deployment

Use Docker with the Compose plugin and Linux containers. Copy the example and
edit the local configuration:

```bash
cp deploy/.env.example deploy/.env
```

Set `DATA_DIR` to an existing populated directory, set a unique
`POSTGRES_PASSWORD`, and set `ALLOWED_ORIGINS` to the browser origin. For Windows
Docker Desktop, `DATA_DIR=D:/jbrowsedata/projectdata` is supported. Because the
password is included in a PostgreSQL connection URI, use a long random password
consisting of URI-safe letters/digits with this configuration. Supporting reserved
characters requires a separately URI-encoded connection string; do not encode
`POSTGRES_PASSWORD` itself, which PostgreSQL uses as the actual password. Local
`.env` files are ignored by Git and Docker build contexts.

`VITE_BLAST_BASE` must point to a separately deployed, browser-accessible BLAST
web service. The sample `/blast-service` path is a placeholder, not a service
included in this Compose file. Configure its proxy or supply the real URL before
building. Empty `VITE_API_BASE` uses the included same-origin backend proxy.
Frontend variables are embedded at build time and are public browser values.

Run commands from the repository root:

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yaml build
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d postgres
```

The new PostgreSQL volume starts empty. Restore the supplied **custom-format**
backup into this new database before starting the application. `docker compose cp`
avoids binary corruption from Windows PowerShell text redirection:

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml cp /path/to/grcg6a.dump postgres:/tmp/grcg6a.dump
docker compose --env-file deploy/.env -f deploy/compose.yaml exec postgres sh -c 'pg_restore --exit-on-error --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/grcg6a.dump'
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
```

For a plain SQL backup, restore with `psql -v ON_ERROR_STOP=1 -f` instead of
`pg_restore`. Do not replay schema migrations automatically over a restored dump;
first establish its schema version and apply only the required later migrations.
The existing `backend/docker-compose.yml` is an older local-development database
configuration with a default password; use the new deployment configuration.

Open `http://localhost:8080` (or the configured host/port). Only the frontend port
is published; PostgreSQL and FastAPI stay on the Compose network. Add HTTPS at
your ingress/reverse proxy before exposing the site externally. To update code:

```bash
git pull --ff-only
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
```

The Nginx configuration serves React routes and proxies backend requests without
rewriting their paths. It treats `/tools`, `/search`, `/go-enrichment`,
`/comparative`, and the `/genome` UI routes as pages; `/tools/domain-search`,
`/search/genes`, and `/genome/*.fna` remain backend requests. Production does not
use Vite's development proxy.

## Deployment acceptance

```bash
curl --fail http://localhost:8080/health
curl --fail http://localhost:8080/chromosomes
curl --fail http://localhost:8080/datasets
curl --fail http://localhost:8080/comparative/gold-standard
curl --fail http://localhost:8080/api/v1/gene-family-catalog/releases/current
```

Check the response bodies for populated datasets, expected release IDs, and
unavailable/missing layers. In a browser, verify gene search, gene detail,
expression, GO enrichment, JBrowse (including range reads), comparative evidence,
catalog downloads, and page refreshes at `/tools` and `/genome/jobs`.

Code quality checks can also run on a developer workstation:

```bash
python -m pip install -r backend/requirements.txt pytest
python -m pytest backend -q
npm ci
npm run test:api-contract
npm run test:vite-routing
npm run lint
npm run build
```

## Running without containers

Use Python 3.11 and Node 22. Create a virtual environment and install
`backend/requirements.txt` plus `pyhmmer` and `pysam` for domain search and native
tabix queries. Linux image export also needs Chromium and system fonts.

Set `GRCG6A_BASE_DIR`, `DATABASE_URL`, and `ALLOWED_ORIGINS` in the process
environment before running:

```bash
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8001
```

Build the frontend with `npm ci` and `npm run build`, then serve `dist/` through a
web server using the same routing policy as `deploy/nginx.conf`. A filesystem path
such as `C:\Users\32110\Desktop\newapp` is not an API URL. The dev server is on
port **5174**, while the deployed frontend defaults to **8080**.
