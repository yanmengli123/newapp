# Worklog

## 2026-07-23

- **Gene Families primary navigation**: following explicit user authorization,
  promoted `/gene-families` from the Annotations submenu to a direct
  `Gene Families` header tab and removed the duplicate submenu item. This is a
  navigation-only scope exception after feature freeze; no page, API,
  classification or release data changed.
- **Gene Families Tab v1.0.1 frozen-scope defect fix**: corrected Pfam domain
  scaling with observed protein lengths and explicit unknown-length local
  windows; exposed the two unresolved KCTD12 source assertions without
  inventing mappings; made entry capabilities truthful; and established a
  runtime-derived 12-route repository OpenAPI contract. All 67 Gene Families
  backend tests, production build, ESLint, pure contract tests and four Chrome
  visual/geometry regressions passed. RC1 and frozen P0/P1 artifacts remained
  byte-identical; RC1 remains QC-blocked and non-citable. See
  `docs/gene-family/GENE_FAMILY_TAB_V1_0_1_DEFECT_FIX.md`.
- **Gene Families Tab v1.0 feature freeze**: page engineering is complete and
  the feature surface is frozen at `gene-family-tab-v1.0-feature-freeze`.
  Production build, TypeScript, targeted ESLint, API contract, read-only API
  smoke tests and all 62 Gene Families backend tests passed. The active data
  remains `gg-gf-2026-07-rc1` (`release_candidate`, `qc_status=blocked`, five
  blocking checks); no RC2 data switch or scientific publication is authorized.
  See `docs/gene-family/GENE_FAMILY_TAB_FEATURE_FREEZE.md`.

## 2026-07-22

- **Port separation**: 5173 is occupied by another project's nginx (Rice Endosperm Development). Switched newapp frontend to 5174 with `strictPort: true` in `vite.config.ts`. See `logs/frontend-restart.log` and `logs/backend-restart.log` for the full session.
- **Gene Family Catalog feature** (commit `90062c6`): 19 files, 4772 insertions. Backend builds an immutable SQLite release under `D:\jbrowsedata\projectdata\gene family\releases\gg-gf-2026-07-rc1\`; frontend exposes `/gene-families`, `/gene-families/entry/:entryId`, `/gene-families/downloads`. Current release QC status: blocked (5 failing checks — by design of the RC1 release).
- **CLAUDE.md improvements** (commits `c609085`, `8395324`): expanded Commands, added Environment, Verification Workflow, comparative evidence policy; updated Backend Tests table to all 6 modules.
- **Misnamed log files removed**: `C:Users32110Desktopnewappbackend_restart.log` and `C:Users32110Desktopnewappfrontend_restart.log` were artifacts from Git Bash path escaping. Replaced with proper logs in `logs/`.

---

8760c1c refactor(backend): unify entry point, fix module paths, and strengthen schema
