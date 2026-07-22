"""CLI entry point for the ChickenData gene-family catalog release builder."""

from __future__ import annotations

import argparse
from pathlib import Path

from backend.gene_family_builder import CatalogBuilder


DEFAULT_BASE = Path(r"D:\jbrowsedata\projectdata")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_BASE / "gene family")
    parser.add_argument("--core-db", type=Path, default=DEFAULT_BASE / "grcg6a_nc.db")
    parser.add_argument("--release-root", type=Path, default=DEFAULT_BASE / "gene family" / "releases")
    parser.add_argument("--release-id", default="gg-gf-2026-07-rc1")
    parser.add_argument("--replace", action="store_true", help="Replace only a matching previously generated release")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    builder = CatalogBuilder(
        source_dir=args.source_dir,
        core_db=args.core_db,
        schema_path=repo_root / "backend" / "db" / "gene_family_schema.sql",
        release_root=args.release_root,
        release_id=args.release_id,
        repo_root=repo_root,
        replace=args.replace,
    )
    output = builder.build()
    print(output)


if __name__ == "__main__":
    main()
