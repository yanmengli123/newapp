# Worklog

## 2026-07-22

- **Port separation**: 5173 is occupied by another project's nginx (Rice Endosperm Development). Switched newapp frontend to 5174 with `strictPort: true` in `vite.config.ts`. See `logs/frontend-restart.log` and `logs/backend-restart.log` for the full session.
- **Gene Family Catalog feature** (commit `90062c6`): 19 files, 4772 insertions. Backend builds an immutable SQLite release under `D:\jbrowsedata\projectdata\gene family\releases\gg-gf-2026-07-rc1\`; frontend exposes `/gene-families`, `/gene-families/entry/:entryId`, `/gene-families/downloads`. Current release QC status: blocked (5 failing checks — by design of the RC1 release).
- **CLAUDE.md improvements** (commits `c609085`, `8395324`): expanded Commands, added Environment, Verification Workflow, comparative evidence policy; updated Backend Tests table to all 6 modules.
- **Misnamed log files removed**: `C:Users32110Desktopnewappbackend_restart.log` and `C:Users32110Desktopnewappfrontend_restart.log` were artifacts from Git Bash path escaping. Replaced with proper logs in `logs/`.

---

8760c1c refactor(backend): unify entry point, fix module paths, and strengthen schema