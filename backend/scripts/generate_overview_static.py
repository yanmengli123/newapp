"""
Generate static overview JSON for the ESC Atlas homepage.

Usage:
    python -m scripts.generate_overview_static

Outputs: backend/static/overview/summary.json

Run this after database updates or schema changes to refresh the static cache.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Ensure backend/ is on the path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg2
from config import GRCG6A_PG_DSN
from overview_service import (
    SampleCompositionService,
    SexBiasedGenesService,
    FemaleMaleScatterService,
    StageDEGCountService,
    Top50HeatmapService,
    PCAService,
    ExpressionDistributionService,
    TrajectoryClustersService,
)


def pg_connection():
    """Create a PostgreSQL connection using the app config."""
    return psycopg2.connect(GRCG6A_PG_DSN)


def generate() -> dict:
    """Run all overview services and merge results into one dict."""
    conn = pg_connection()
    try:
        services = {
            "sample_composition":       SampleCompositionService(conn).load,
            "sex_biased_genes":         SexBiasedGenesService(conn).load,
            "female_male_scatter":      lambda: FemaleMaleScatterService(conn).load(),
            "stage_deg_count":           StageDEGCountService(conn).load,
            "expression_distribution":  ExpressionDistributionService(conn).load,
            "pca":                      lambda: PCAService(conn).load(),
            "top50_heatmap":            Top50HeatmapService(conn).load,
            "trajectory_clusters":       TrajectoryClustersService(conn).load,
        }
        result = {"status": "ok"}
        for key, loader in services.items():
            try:
                result[key] = loader()
            except Exception as e:
                result[key] = {"error": str(e)}
        return result
    finally:
        conn.close()


def main():
    script_dir = Path(__file__).resolve().parent.parent
    static_dir = script_dir / "static" / "overview"
    static_dir.mkdir(parents=True, exist_ok=True)
    output_path = static_dir / "summary.json"

    print("Generating ESC Atlas overview static JSON...")
    data = generate()
    error_count = sum(1 for v in data.values() if isinstance(v, dict) and "error" in v)
    if error_count:
        print(f"WARNING: {error_count} services returned errors")

    output_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    size_kb = output_path.stat().st_size / 1024
    print(f"Written: {output_path} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
