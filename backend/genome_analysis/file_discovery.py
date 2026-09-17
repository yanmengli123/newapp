"""File discovery service for genome files."""

from pathlib import Path
from typing import Optional

from backend.config import GRCG6A_DB_PATH, GRCG6A_RAWDATA_ROOT


class GenomeFileDiscovery:
    """Service for discovering and validating genome files."""

    # Core genome files patterns
    GENOME_FILES = {
        # uncompressed references kept on disk (corrupt fixed.fna.gz removed 2026-09-17)
        "genomic": [
            "GCF_000002315.6_GRCg6a_genomic.chr.fna",
            "GCF_000002315.6_GRCg6a_primary_35.fna",
            "genomic.fna",
        ],
        "gff": [
            "genomic.gff", "genomic.gff.gz",
            "GRCg6a_genomic.gff.gz",
            "GCF_000002315.6_GRCg6a_genomic.gff.gz"
        ],
        "cds": [
            "cds_from_genomic.fna", "cds_from_genomic.fna.gz",
            "GRCg6a_cds_from_genomic.fna.gz",
            "GCF_000002315.6_GRCg6a_cds_from_genomic.fna.gz"
        ],
        "protein": [
            "protein.faa", "protein.faa.gz",
            "GRCg6a_protein.faa.gz",
            "GCF_000002315.6_GRCg6a_protein.faa.gz"
        ],
        "rna": [
            "rna.fna", "rna.fna.gz",
            "GRCg6a_rna.fna.gz",
            "GCF_000002315.6_GRCg6a_rna.fna.gz"
        ],
    }

    def __init__(self, data_dir: Optional[Path] = None):
        """Initialize the file discovery service."""
        if data_dir:
            self.data_dir = data_dir
        else:
            # Prefer explicit GRCG6A_RAWDATA_ROOT env var, fall back to GRCG6A_DB_PATH parent
            if GRCG6A_RAWDATA_ROOT.exists():
                self.data_dir = GRCG6A_RAWDATA_ROOT
            else:
                self.data_dir = GRCG6A_DB_PATH.parent

    def scan(self, data_dir: Optional[Path] = None) -> dict:
        """Scan for genome files in the data directory (and its parent, matching get_file)."""
        if data_dir:
            self.data_dir = data_dir

        discovered = {}
        missing = []
        search_dirs = [self.data_dir, self.data_dir.parent]

        for file_type, patterns in self.GENOME_FILES.items():
            found = False
            for search_dir in search_dirs:
                for pattern in patterns:
                    file_path = search_dir / pattern
                    if file_path.exists():
                        discovered[file_type] = {
                            "file_type": file_type,
                            "filename": file_path.name,
                            "path": str(file_path),
                            "size_bytes": file_path.stat().st_size,
                            "is_compressed": str(file_path).endswith(".gz"),
                            "exists": True,
                        }
                        found = True
                        break
                if found:
                    break

            if not found:
                missing.append(file_type)

        return {
            "success": True,
            "scan_dir": str(self.data_dir),
            "files": discovered,
            "missing_types": missing,
            "total_size": sum(f["size_bytes"] for f in discovered.values()),
        }

    def get_file(self, file_type: str) -> Optional[Path]:
        """Get the path for a specific file type. Searches data_dir then parent directories."""
        patterns = self.GENOME_FILES.get(file_type, [])
        search_dirs = [self.data_dir, self.data_dir.parent]
        for search_dir in search_dirs:
            for pattern in patterns:
                file_path = search_dir / pattern
                if file_path.exists():
                    return file_path
        return None


# Global service instance
genome_file_discovery = GenomeFileDiscovery()
