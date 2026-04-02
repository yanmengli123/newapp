"""
Shared gene utilities — safe to import from any module.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("grcg6a_fastapi_backend.gene_utils")


def resolve_gene_id(state: Any, gene_id: str) -> str:
    """
    Resolve a gene ID or symbol to its canonical gene_id.

    Strategy:
      1. Exact match in gene_index_by_id  → return as-is
      2. Single alias hit in gene_index_by_symbol → resolve
      3. Otherwise return the input as-is
    """
    if gene_id in state.gene_index_by_id:
        return gene_id

    hits = state.gene_index_by_symbol.get(gene_id.lower(), [])
    if len(hits) == 1:
        resolved = hits[0]["gene_id"]
        logger.info("Resolved gene alias %s -> %s", gene_id, resolved)
        return resolved

    return gene_id
