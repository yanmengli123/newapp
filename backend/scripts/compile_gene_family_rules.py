"""Compile safe rule authoring files into canonical executable JSON."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.gene_family_rule_engine import (
    compile_rule_bundle,
    load_authoring,
    write_compiled_bundle,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compile RC2-B gene-family rule authoring data")
    parser.add_argument("--vocabulary", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--contract-bundle-hash", required=True)
    parser.add_argument("--reason-registry-hash", required=True)
    parser.add_argument("--regex-registry", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)

    regex_registry = {}
    if args.regex_registry:
        loaded = load_authoring(args.regex_registry)
        if not all(isinstance(key, str) and isinstance(value, str) for key, value in loaded.items()):
            raise ValueError("regex registry must map string IDs to string patterns")
        regex_registry = loaded
    bundle = compile_rule_bundle(
        load_authoring(args.vocabulary),
        load_authoring(args.catalog),
        contract_bundle_hash=args.contract_bundle_hash,
        reason_registry_hash=args.reason_registry_hash,
        regex_registry=regex_registry,
    )
    write_compiled_bundle(bundle, args.output)
    print(json.dumps({
        "output": args.output.name,
        "compiled_content_hash": bundle["compiled_content_hash"],
        "rule_count": len(bundle["catalog"]["rules"]),
        "vocabulary_term_count": len(bundle["vocabulary"]["terms"]),
        "catalog_status": bundle["catalog"]["status"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

