# Comparative Natural Synteny Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/comparative` use natural-breakpoint whole-genome synteny as the primary research view while keeping the existing 1 Mb PAF as a QC layer and JBrowse2-compatible fallback.

**Architecture:** Generate a primary-only `minimap2 -x asm5` PAF in Ubuntu WSL `blast_env`, keep provenance beside the data, parse PAF files through a tested backend helper, and expose natural/windowed alignment datasets through explicit API endpoints. The React page will present natural synteny, dotplot, window QC, gene-level readiness, and methods/provenance as separate scientific layers.

**Tech Stack:** FastAPI, Python PAF parser, minimap2/seqkit in WSL conda `blast_env`, React 19, Mantine 8, JBrowse2 linear comparative view.

---

### Task 1: Generate Natural PAF

**Files:**
- Create: `backend/scripts/build_natural_synteny.sh`
- Output: `D:\jbrowsedata\projectdata\synteny\natural\grcg6a_vs_grcg7b.natural.asm5.paf`

- [ ] Add a reproducible WSL bash script that runs `seqkit stats` and `minimap2 -x asm5 --secondary=no`.
- [ ] Run the script through `conda run -n blast_env`.
- [ ] Verify the output PAF exists, has non-windowed starts, and has a minimap2 log/provenance file.

### Task 2: Backend PAF Parser

**Files:**
- Create: `backend/comparative_paf.py`
- Create: `backend/test_comparative_paf.py`
- Modify: `backend/comparative_service.py`
- Modify: `backend/api/comparative_routes.py`

- [ ] Write tests for PAF parsing, RefSeq-to-chromosome normalization, windowed-vs-natural detection, and merged coverage statistics.
- [ ] Implement the parser and summary helpers.
- [ ] Add service methods for `natural` and `windowed` alignment datasets.
- [ ] Add routes for alignment blocks, stats, methods, and mode-aware PAF file serving.

### Task 3: Frontend Comparative Page

**Files:**
- Modify: `src/lib/comparativeApi.ts`
- Modify: `src/pages/ComparativeGenomicsPage.tsx`

- [ ] Add API types for alignment blocks, dataset stats, and methods/provenance.
- [ ] Rebuild `/comparative` around natural alignments, whole-genome dotplot, windowed QC, gene-collinearity readiness, and methods.
- [ ] Use true PAF sequence lengths for dotplot scaling instead of inferring chromosome lengths from visible records.

### Task 4: JBrowse2 Compatibility

**Files:**
- Modify: `src/lib/pafSynteny.ts`
- Verify: `src/jbrowseSyntenyViewState.ts`

- [ ] Make JBrowse2 synteny features load `/comparative/paf/file?mode=natural` by default.
- [ ] Preserve RefSeq-to-chromosome normalization and mate lookup behavior.

### Task 5: Verification

**Commands:**
- `python -m pytest backend/test_comparative_paf.py -q`
- `python -m py_compile backend/comparative_paf.py backend/comparative_service.py backend/api/comparative_routes.py`
- `npm run build`
- Browser checks for `/comparative` and `/jbrowse?mode=comparative`

- [ ] Confirm tests pass.
- [ ] Confirm front-end TypeScript build passes.
- [ ] Confirm rendered `/comparative` exposes natural synteny as primary and windowed PAF only as QC.
