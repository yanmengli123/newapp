"""Configuration for genome analysis module."""

from pathlib import Path

from config import GRCG6A_DB_PATH, GRCG6A_GENOME_OUTPUT


class Settings:
    """Application settings for genome analysis."""

    # Directory paths — all resolved from centralized config
    data_dir: Path = GRCG6A_DB_PATH.parent
    genome_output_dir: Path = GRCG6A_GENOME_OUTPUT

    def __init__(self):
        """Ensure output directory exists."""
        self.genome_output_dir.mkdir(parents=True, exist_ok=True)


# Global settings instance
settings = Settings()
