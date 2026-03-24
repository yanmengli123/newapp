"""Centralized configuration for all backend data paths.

All paths resolve to D:\\jbrowsedata\\projectdata\\ unless overridden
by environment variables. Set these env vars before running:
    GRCG6A_BASE_DIR          → project root (default: D:\\jbrowsedata\\projectdata)
    GRCG6A_DB_PATH           → grcg6a_nc.db (SQLite gene DB)
    GRCG6A_STATIC_ROOT      → static\\ (KEGG images)
    GRCG6A_RAWDATA_ROOT     → rawdata\\ (genome FASTA/GFF files)
    GRCG6A_GENOME_OUTPUT    → outputs\\jobs\\ (analysis job outputs)
    GRCG6A_SAMPLE_RESULTS   → outputs\\sample_results\\ (pre-generated results)
    GRCG6A_PUBLIC_GENOME    → public\\genome\\ (served via FastAPI static)
    GRCG6A_HMMER_DB         → hmmer_db\\Pfam-A.hmm (HMMER/Pfam domain DB)
"""

import os
from pathlib import Path

# Base directory
_BASE = Path(os.getenv("GRCG6A_BASE_DIR", r"D:\jbrowsedata\projectdata")).resolve()

# Gene database (SQLite)
GRCG6A_DB_PATH: Path = Path(os.getenv("GRCG6A_DB_PATH", str(_BASE / "grcg6a_nc.db"))).resolve()

# Static files (KEGG pathway images, etc.)
GRCG6A_STATIC_ROOT: Path = Path(os.getenv("GRCG6A_STATIC_ROOT", str(_BASE / "static"))).resolve()

# Raw genome files (FASTA, GFF, CDS, protein, RNA)
GRCG6A_RAWDATA_ROOT: Path = Path(os.getenv("GRCG6A_RAWDATA_ROOT", str(_BASE / "rawdata"))).resolve()

# Genome analysis outputs (job results)
GRCG6A_GENOME_OUTPUT: Path = Path(
    os.getenv("GRCG6A_GENOME_OUTPUT", str(_BASE / "outputs" / "jobs"))
).resolve()

# Pre-generated sample results
GRCG6A_SAMPLE_RESULTS: Path = Path(
    os.getenv("GRCG6A_SAMPLE_RESULTS", str(_BASE / "outputs" / "sample_results"))
).resolve()

# Served genome files (FASTA/GFF for JBrowse)
GRCG6A_PUBLIC_GENOME: Path = Path(
    os.getenv("GRCG6A_PUBLIC_GENOME", str(Path(__file__).parent.parent.parent / "public" / "genome"))
).resolve()

# HMMER/Pfam database (for domain search)
GRCG6A_HMMER_DB: Path = Path(
    os.getenv("GRCG6A_HMMER_DB", str(_BASE / "hmmer_db" / "Pfam-A.hmm"))
).resolve()

# KEGG pathway images (derived from static root)
KEGG_IMAGE_DIR: Path = GRCG6A_STATIC_ROOT / "kegg_pathways"


