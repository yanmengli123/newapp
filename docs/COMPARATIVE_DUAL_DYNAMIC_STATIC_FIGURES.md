# Comparative Synteny: Dual Dynamic + Four Static Figures

This document records the implemented `/comparative` and `/jbrowse?mode=comparative`
design for GRCg6a vs GRCg7b.

## Dynamic Layers

1. JBrowse2 Natural DNA Synteny
   - Source: `/comparative/paf/file?mode=natural&min_quality=30&min_identity=85&min_alignment_length=50000`
   - Adapter path: PAF-derived synteny features in the embedded `LinearSyntenyView`.
   - Scientific role: DNA-level whole-genome alignment.

2. JBrowse2 Gene Collinearity Anchors
   - Embedded source: `/comparative/gene-collinearity?limit=20000`
   - Embedded adapter path: JBrowse2 `FromConfigAdapter` with gene-anchor features.
   - MCScan-compatible source anchors: `/comparative/gene-collinearity/file?name=grcg6a_grcg7b.anchors`
   - MCScan-compatible BED 1: `/comparative/gene-collinearity/file?name=GRCg6a.bed`
   - MCScan-compatible BED 2: `/comparative/gene-collinearity/file?name=GRCg7b.bed`
   - Scientific role: gene-order conservation, explicitly distinct from DNA PAF.
   - Note: the installed embedded React plugin exposes MCScan import-form metadata but does not register
     `MCScanAnchorsAdapter` in the track adapter schema, so the stable embedded view uses `FromConfigAdapter`.

## Static Figures

`GET /comparative/static-figures` returns the figure manifest. The four publication-style SVG figures are:

1. `/comparative/static-figures/dna-dotplot.svg`
   - DNA whole-genome dotplot from natural-breakpoint PAF.

2. `/comparative/static-figures/gene-collinearity-dotplot.svg`
   - Gene anchor dotplot from `gene_pairs.tsv` and anchors.

3. `/comparative/static-figures/karyotype-ribbons.svg`
   - Chromosome-scale collinearity ribbon overview from `blocks.tsv`.

4. `/comparative/static-figures/micro-synteny.svg?block_id=GENEBLOCK_00001`
   - Local gene-arrow micro-synteny view for a selected collinearity block.

## Data Governance

- The 1 Mb window QC dataset remains excluded from the gold-standard synteny display.
- Static figures are generated from audited local evidence files under `D:\jbrowsedata\projectdata`.
- The current gene collinearity file is MCScan-compatible but method-labeled as `BLASTP_RBH_CHAINING`.
  The UI must not claim it is native JCVI/MCScanX output until native anchors are generated.
