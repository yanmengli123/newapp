"""Compatibility wrapper for registry-driven JBrowse comparative assets.

The former version of this script produced a GRCg7b ``main_chr`` subset and
missed chr33-39. Keep the filename for old operator habits, but delegate to
the gold-standard asset builder so future reruns generate the complete
GRCg6a primary 35, GRCg7b primary 42, and GRCg7b-only extra 7 assets.
"""

from __future__ import annotations

from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.scripts.build_comparative_registry_assets import build_comparative_assets  # noqa: E402

PROJECTDATA = Path(r"D:\jbrowsedata\projectdata")
GRCG7B_DIR = PROJECTDATA / "grcg7b"


def main() -> None:
    build_comparative_assets(
        grcg6a_report=REPO_ROOT / "GRCg6a_sequence_report.tsv",
        grcg7b_report=REPO_ROOT / "GRCg7b_sequence_report.tsv",
        grcg6a_fasta=PROJECTDATA / "GCF_000002315.6_GRCg6a_genomic.chr.fna",
        grcg7b_fasta=GRCG7B_DIR / "GCF_016699485.2_bGalGal1.mat.broiler.GRCg7b_genomic.fna.gz",
        grcg6a_gff=PROJECTDATA / "GCF_000002315.6_GRCg6a_genomic.gff",
        grcg7b_gff=GRCG7B_DIR / "GCF_016699485.2_bGalGal1.mat.broiler.GRCg7b_genomic.gff.gz",
        out_dir=PROJECTDATA,
        expected_grcg6a=35,
        expected_grcg7b=42,
    )


if __name__ == "__main__":
    main()
