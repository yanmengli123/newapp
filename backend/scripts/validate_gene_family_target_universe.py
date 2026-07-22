"""Validate a generated RC2-B.2 target-universe submission."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.gene_family_target_universe import validate_target_universe_submission


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate an RC2-B.2 target-universe submission"
    )
    parser.add_argument("--submission-root", type=Path, required=True)
    parser.add_argument("--parent-batch-root", type=Path, required=True)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    report = validate_target_universe_submission(
        args.submission_root, args.parent_batch_root
    )
    if args.as_json:
        print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2))
    else:
        print(f"RC2-B.2 target universe: {'PASS' if report.ok else 'FAIL'}")
        print(f"checks={len(report.checks)} errors={len(report.errors)}")
        for error in report.errors:
            print(f"ERROR: {error}")
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
