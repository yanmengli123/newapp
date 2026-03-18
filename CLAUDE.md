# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a bioinformatics visualization platform built with React, TypeScript, and Vite. It uses Mantine UI (v8) for components and React Router for navigation. The app provides a homepage with placeholder routes for future modules: Genome Browser, Visualizations, and Datasets.

## Commands

```bash
# Frontend
npm run dev      # Start development server with HMR (port 5173)
npm run build    # Build for production (TypeScript check + Vite build)
npm run lint     # Run ESLint on all files
npm run preview  # Preview production build locally

# Backend (requires Python with gffutils)
# Install dependencies: pip install gffutils fastapi uvicorn pydantic
python backend/main.py  # Starts on port 8000
```

## Statistics

- **Chromosomes**: 35 (chr1-28, chr29-32, chrW, chrZ, chrMT)
- **Genes**: 23,640
- **Genome size**: ~1.05 Gb (1,050,156,607 bp)
- **Genes with GO annotations**: 12,890
- **Genes with KEGG pathways**: 6,212

## Architecture

- **Entry point**: `src/main.tsx` - Sets up MantineProvider, BrowserRouter, and renders App
- **Routing**: `src/App.tsx` - Defines routes at `/`, `/query`, `/browser`, `/jbrowse`, `/blast`, `/viz`, `/data`, `/tools`, `/gene/:geneId`, `/chromosome/:seqid`
- **UI Framework**: Mantine v8 with `@mantine/core` and `@mantine/hooks`
- **Icons**: Tabler icons via `@tabler/icons-react`
- **Genome Browser**: JBrowse via `@jbrowse/react-linear-genome-view2`
- **Routing**: React Router v7 via `react-router-dom`

The app uses an `AppShell` layout with a header navigation bar. All pages are wrapped in a `Container` with consistent padding and dividers. The ChatWidget is rendered globally in App.tsx and floats over all pages.

## Component Organization

- **Layout components**: `src/components/layout/` - AppHeader, AppFooter
- **Home components**: `src/components/home/` - HeroSection, FeatureGrid, WhySection, GeneSearch
- **Common components**: `src/components/common/` - PlaceholderPage
- **Pages**: `src/pages/` - HomePage, GeneQueryPage, BrowserPage, JBrowsePage, BlastPage, VizPage, DataPage, GenePage, ChromosomePage, ToolsPage
- **Chat components**: `src/components/chat/` - ChatWidget, ChatLauncher, ChatWindow, ChatMessageBubble
- **API client**: `src/lib/chatApi.ts` - Chat API wrapper
- **Gene API client**: `src/lib/geneApi.ts` - Gene/Chromosome/GO/KEGG API wrapper (GRCg6a database)
- **JBrowse config**: `src/jbrowseConfig.ts` - Linear genome view configuration with GRCg6a chicken genome assembly
- **KEGG pathways**: `public/static/kegg_pathways/` - Local pathway images

## Backend

- **Location**: `backend/main.py` - FastAPI server
- **Port**: 8000
- **Endpoints**:
  - `GET /health` - Health check
  - `POST /api/chat` - Chat API (accepts `{"message": "..."}`)
  - `GET /search/genes?q=` - Gene search by gene_id/symbol/name
  - `GET /chromosomes` - List all chromosomes
  - `GET /chromosomes/{seqid}` - Get chromosome details
  - `GET /genes/{gene_id}` - Get gene details
  - `GET /genes/{gene_id}/transcripts` - Get gene transcripts
  - `GET /genes/{gene_id}/page` - Get full gene page with transcripts
  - `GET /chromosomes/{seqid}/genes` - Get genes on chromosome (with start/end filter)
  - `GET /annotations/go/{gene_id}` - Get GO annotations (biological_process, molecular_function, cellular_component)
  - `GET /annotations/kegg/{gene_id}` - Get KEGG pathway annotations with links
  - `GET /annotations/kegg/pathway/{pathway_id}/info` - Get KEGG pathway JSON metadata
  - `GET /annotations/kegg/pathway/{pathway_id}/image` - Get KEGG pathway image
  - `GET /static/kegg_pathways/{pathway_id}.png` - Direct access to KEGG pathway images
  - `GET /kegg-images/{pathway_id}.png` - Alternative route for KEGG pathway images
  - `GET /kegg-images/{pathway_id}/info` - Alternative route for pathway metadata
  - `POST /tools/primer3` - Primer3 PCR primer design (gene_id, include_flank, product_size_min/max, num_primers)
  - `POST /tools/domain-search` - Protein domain search using local HMMER + Pfam database
- **CORS**: Enabled for localhost:5173-5175, localhost:3000
- **Chat Features**: Intent detection for bioinformatics queries (genome stats, GFF stats, sequence extraction, gene finding)
- **Data Files**:
  - GRCg6a genome: `D:\jbrowsedata\rawdata\` (source files)
  - Served from: `public/genome/` (filtered FASTA, GFF, and .fai index files)
  - Gene database: `D:\jbrowsedata\projectdata\grcg6a_nc.db`
    - Tables: features, relations, chromosome, transcript_seq, cds_seq, protein_seq, gene_xref, gene_go, gene_kegg, gene_kegg_pathway
    - ~23,640 genes, ~6,212 genes with KEGG pathways
  - KEGG pathway images: `D:\jbrowsedata\projectdata\static\kegg_pathways\`

## Genome Data

- **Source**: NCBI GCF_000002315.6 (GRCg6a chicken genome)
- **Files in public/genome/**:
  - `GCF_000002315.6_GRCg6a_genomic.fna` - Full genome sequence
  - `GCF_000002315.6_GRCg6a_genomic.fna.fai` - FASTA index
  - `GCF_000002315.6_GRCg6a_genomic.gff` - Gene annotations (filtered to NC_ chromosomes only)
  - `aliases.txt` - Chromosome name aliases (NC_ IDs to chr1, chr2, etc.)
- **Chromosomes**: 35 main chromosomes (chr1-28, chr29-32, chrW, chrZ, chrMT)
- **Genome size**: ~1.05 Gb (1,050,156,607 bp)

## Key Patterns

- Mantine components use the `size` prop with `rem()` for responsive sizing (e.g., `p={{ base: 'xl', md: rem(48) }}`)
- Routes use the `<Routes>` and `<Route>` components from react-router-dom
- Navigation links use Mantine's `<Button component={Link}>` pattern
- Theme is customized with `createTheme` (primaryColor: "cyan", defaultRadius: "md")
- Chat API uses intent detection based on Chinese keywords to route queries
- Frontend runs on Vite's dev server (typically port 5173)
- Backend must run separately on port 8000 for API functionality to work
- Gene IDs use format: `gene-XXXXX` (e.g., `gene-A4GALT`)
- Search accepts gene_id, gene_symbol, or chromosome region (NC_xxx:start-end)
- GenePage (`/gene/:geneId`) displays: gene info, transcripts, exons, CDS, proteins, GO annotations, KEGG pathways with local pathway images

## Git Management

```bash
# Initialize (already done)
git init

# Commit changes
git add .
git commit -m "description"

# View history
git log --oneline

#回退操作
git reset --soft HEAD~1    # 回退到上一个提交（保留修改）
git reset --hard HEAD~1   # 回退到上一个提交（丢弃修改）
git reset --hard <commit_id>  # 回退到指定提交

# 撤销修改
git checkout -- <file>

# 推送到远程
git push origin master
```
