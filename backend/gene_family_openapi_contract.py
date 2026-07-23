"""Deterministic repository OpenAPI contract for the Gene Families surface."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONTRACT = REPOSITORY_ROOT / "contracts" / "gene-family" / "api" / "openapi-current.json"


def is_gene_family_path(path: str) -> bool:
    return (
        path.startswith("/api/v1/gene-family-catalog")
        or (path.startswith("/api/v1/genes/") and path.endswith("/family-annotations"))
        or (path.startswith("/api/v1/proteins/") and path.endswith("/domain-hits"))
    )


def _schema_references(value: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        reference = value.get("$ref")
        prefix = "#/components/schemas/"
        if isinstance(reference, str) and reference.startswith(prefix):
            found.add(reference.removeprefix(prefix))
        for nested in value.values():
            found.update(_schema_references(nested))
    elif isinstance(value, list):
        for nested in value:
            found.update(_schema_references(nested))
    return found


def build_gene_family_openapi(runtime_openapi: dict[str, Any]) -> dict[str, Any]:
    paths = {
        path: runtime_openapi["paths"][path]
        for path in sorted(runtime_openapi.get("paths", {}))
        if is_gene_family_path(path)
    }
    runtime_schemas = runtime_openapi.get("components", {}).get("schemas", {})
    required = _schema_references(paths)
    pending = list(required)
    while pending:
        name = pending.pop()
        for dependency in _schema_references(runtime_schemas.get(name, {})) - required:
            required.add(dependency)
            pending.append(dependency)
    schemas = {name: runtime_schemas[name] for name in sorted(required)}
    return {
        "openapi": runtime_openapi.get("openapi", "3.1.0"),
        "info": {
            "title": "ChickenData Gene Family Catalog API",
            "version": "1.0.1",
            "description": (
                "Repository-authoritative read-only API contract for the feature-frozen "
                "Gene Families client. The immutable RC1 release-package OpenAPI remains unchanged."
            ),
        },
        "paths": paths,
        "components": {"schemas": schemas},
    }


def canonical_json(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def current_runtime_contract() -> dict[str, Any]:
    from backend.main import app

    return build_gene_family_openapi(app.openapi())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = canonical_json(current_runtime_contract())
    if args.check:
        if not args.output.is_file():
            print(f"missing repository OpenAPI contract: {args.output}")
            return 1
        if args.output.read_text(encoding="utf-8") != rendered:
            print(f"runtime/repository OpenAPI mismatch: {args.output}")
            return 1
        print("Gene Families runtime/repository OpenAPI contract: PASS")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8", newline="\n")
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
