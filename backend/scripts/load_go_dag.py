"""
load_go_dag.py
==============
Parse go-basic.obo and build GO DAG closure tables in PostgreSQL.

Usage:
    python -m backend.scripts.load_go_dag --obo /path/to/go-basic.obo --dsn "postgresql://..."

Arguments:
    --obo           Path to go-basic.obo (required)
    --dsn           PostgreSQL connection DSN (required)
    --include-part-of   Include 'part_of' relations (default: True)
    --no-part-of        Exclude 'part_of' relations (only is_a)
    --replace        Truncate tables before inserting
    --dry-run        Parse OBO but do not write to DB

Example:
    python -m backend.scripts.load_go_dag \
        --obo /d/jbrowsedata/projectdata/downloads/go/go-basic.obo \
        --dsn postgresql://grcuser:grcpassword@127.0.0.1:5433/grcg6a \
        --replace
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import psycopg2


# ---------------------------------------------------------------------------
# OBO parsing
# ---------------------------------------------------------------------------

def parse_obo(path: str) -> Tuple[dict, dict, dict]:
    """
    Parse go-basic.obo and return three structures:

    terms:      {go_id: {name, namespace, is_obsolete, alt_ids, is_a, part_of}}
    alt_map:    {alt_go_id: primary_go_id}
    header:     {key: value} from OBO header
    """
    terms: dict = {}
    alt_map: dict = {}
    header: dict = {}
    all_terms_count = 0  # accurate total including obsolete

    current_term: Optional[dict] = None
    in_term = False
    current_block = ""

    with open(path, encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.rstrip()

            if line.startswith("[") and not line.startswith("[!]"):
                # Process previous term
                if current_term is not None:
                    all_terms_count += 1
                    go_id = current_term.get("id")
                    if go_id:
                        if current_term.get("is_obsolete"):
                            pass  # skip obsolete in terms dict
                        else:
                            terms[go_id] = {
                                "name": current_term.get("name", ""),
                                "namespace": current_term.get("namespace", ""),
                                "is_obsolete": False,
                                "is_a": list(current_term.get("is_a", [])),
                                "part_of": list(current_term.get("part_of", [])),
                            }
                        # register alt_ids
                        for alt_id in current_term.get("alt_id", []):
                            alt_map[alt_id] = go_id

                # Start new block
                block_type = line.strip().lstrip("[").rstrip("]")
                if block_type == "Term":
                    in_term = True
                    current_term = {
                        "id": None,
                        "name": None,
                        "namespace": None,
                        "is_obsolete": False,
                        "alt_id": [],
                        "is_a": [],
                        "part_of": [],
                    }
                else:
                    in_term = False
                    current_term = None
            elif in_term and current_term is not None:
                if not line:
                    continue
                # Key:value format
                colon_idx = line.find(":")
                if colon_idx == -1:
                    continue
                key = line[:colon_idx].strip()
                # Value starts after ": " (colon + space)
                value = line[colon_idx + 1 :].strip()

                if key == "id":
                    current_term["id"] = value
                elif key == "name":
                    current_term["name"] = value
                elif key == "namespace":
                    current_term["namespace"] = value
                elif key == "is_obsolete":
                    current_term["is_obsolete"] = value.lower() == "true"
                elif key == "alt_id":
                    current_term["alt_id"].append(value)
                elif key == "is_a":
                    # Format: GO:xxxxx ! optional name
                    m = re.match(r"(GO:\d+)", value)
                    if m:
                        current_term["is_a"].append(m.group(1))
                elif key == "relationship":
                    # Format: part_of GO:xxxxx ! optional name
                    m = re.match(r"part_of\s+(GO:\d+)", value)
                    if m:
                        current_term["part_of"].append(m.group(1))
            else:
                # Header
                if not line or line.startswith("!"):
                    continue
                colon_idx = line.find(":")
                if colon_idx == -1:
                    continue
                header_key = line[:colon_idx].strip()
                header_value = line[colon_idx + 1 :].strip()
                header[header_key] = header_value

    return terms, alt_map, header


# ---------------------------------------------------------------------------
# Closure computation
# ---------------------------------------------------------------------------

def compute_closure(
    terms: dict,
    include_part_of: bool = True,
) -> List[Tuple[str, str, int]]:
    """
    Compute transitive closure of GO DAG.

    For each (descendant, ancestor) pair, store the shortest distance.
    Includes self-rows (distance=0).

    Returns list of (descendant_go_id, ancestor_go_id, distance).
    """
    # Build adjacency: child -> list of parents
    children_to_parents: Dict[str, List[str]] = defaultdict(list)
    for go_id, info in terms.items():
        if info["is_obsolete"]:
            continue
        for parent in info["is_a"]:
            if parent in terms and not terms[parent]["is_obsolete"]:
                children_to_parents[go_id].append(parent)
        if include_part_of:
            for parent in info["part_of"]:
                if parent in terms and not terms[parent]["is_obsolete"]:
                    children_to_parents[go_id].append(parent)

    # BFS from each node to compute shortest ancestor distances
    closure: List[Tuple[str, str, int]] = []

    for start in terms:
        if terms[start]["is_obsolete"]:
            continue

        # BFS
        visited: Dict[str, int] = {start: 0}
        queue: deque = deque([start])

        while queue:
            current = queue.popleft()
            current_dist = visited[current]

            for parent in children_to_parents.get(current, []):
                if parent not in visited or visited[parent] > current_dist + 1:
                    visited[parent] = current_dist + 1
                    queue.append(parent)

        for ancestor, dist in visited.items():
            closure.append((start, ancestor, dist))

    return closure


# ---------------------------------------------------------------------------
# Database writing
# ---------------------------------------------------------------------------

def run_migration(conn) -> None:
    """Run the V004 migration to create tables if they don't exist."""
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS go_edge (
            child_go_id  TEXT NOT NULL,
            parent_go_id TEXT NOT NULL,
            relation     TEXT NOT NULL CHECK (relation IN ('is_a', 'part_of')),
            PRIMARY KEY (child_go_id, parent_go_id, relation)
        );
        CREATE TABLE IF NOT EXISTS go_closure (
            descendant_go_id TEXT NOT NULL,
            ancestor_go_id  TEXT NOT NULL,
            distance        INT NOT NULL CHECK (distance >= 0),
            PRIMARY KEY (descendant_go_id, ancestor_go_id)
        );
        CREATE TABLE IF NOT EXISTS go_alt_id (
            alt_go_id     TEXT PRIMARY KEY,
            primary_go_id TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS go_dag_metadata (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_go_edge_parent       ON go_edge(parent_go_id);
        CREATE INDEX IF NOT EXISTS idx_go_edge_relation    ON go_edge(relation);
        CREATE INDEX IF NOT EXISTS idx_go_closure_ancestor ON go_closure(ancestor_go_id);
        CREATE INDEX IF NOT EXISTS idx_go_closure_descendant ON go_closure(descendant_go_id);
        CREATE INDEX IF NOT EXISTS idx_go_alt_id_primary   ON go_alt_id(primary_go_id);
    """)
    cur.close()


def write_dag(
    conn,
    terms: dict,
    alt_map: dict,
    header: dict,
    include_part_of: bool,
    replace: bool,
    obo_path: str = "go-basic.obo",
) -> Tuple[int, int, int]:
    """
    Write DAG data to PostgreSQL.
    Returns (term_count, edge_count, closure_count).
    """
    cur = conn.cursor()

    if replace:
        print("  Truncating existing data...")
        cur.execute("TRUNCATE go_edge CASCADE")
        cur.execute("TRUNCATE go_closure CASCADE")
        cur.execute("TRUNCATE go_alt_id CASCADE")
        cur.execute("DELETE FROM go_dag_metadata WHERE key NOT IN ('loaded_at')")

    # --- Insert edges ---
    print("  Building edges...")
    edges: Set[Tuple[str, str, str]] = set()
    for go_id, info in terms.items():
        if info["is_obsolete"]:
            continue
        for parent in info["is_a"]:
            edges.add((go_id, parent, "is_a"))
        if include_part_of:
            for parent in info["part_of"]:
                edges.add((go_id, parent, "part_of"))

    edge_rows = [(c, p, r) for (c, p, r) in edges]
    print(f"  Inserting {len(edge_rows)} edges...")
    for i in range(0, len(edge_rows), 5000):
        batch = edge_rows[i : i + 5000]
        cur.executemany(
            "INSERT INTO go_edge (child_go_id, parent_go_id, relation) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
            batch,
        )

    # --- Compute and insert closure ---
    print("  Computing transitive closure (BFS)...")
    t0 = time.time()
    closure = compute_closure(terms, include_part_of)
    elapsed = time.time() - t0
    print(f"  Closure computed in {elapsed:.1f}s, {len(closure)} rows")

    print("  Inserting closure rows...")
    for i in range(0, len(closure), 5000):
        batch = closure[i : i + 5000]
        cur.executemany(
            "INSERT INTO go_closure (descendant_go_id, ancestor_go_id, distance) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
            batch,
        )

    # --- Insert alt_ids ---
    print(f"  Inserting {len(alt_map)} alt_id mappings...")
    alt_rows = [(alt, primary) for alt, primary in alt_map.items()]
    for i in range(0, len(alt_rows), 5000):
        batch = alt_rows[i : i + 5000]
        cur.executemany(
            "INSERT INTO go_alt_id (alt_go_id, primary_go_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
            batch,
        )

    # --- Insert metadata ---
    import datetime

    metadata = {
        "obo_path": obo_path,
        "format_version": header.get("format-version", "unknown"),
        "data_version": header.get("data-version", "unknown"),
        "include_part_of": "true" if include_part_of else "false",
        "loaded_at": datetime.datetime.utcnow().isoformat(),
        "term_count": str(len(terms)),
        "edge_count": str(len(edge_rows)),
        "closure_count": str(len(closure)),
    }
    for key, value in metadata.items():
        cur.execute(
            "INSERT INTO go_dag_metadata (key, value) VALUES (%s, %s) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (key, value),
        )

    cur.close()
    return len(terms), len(edge_rows), len(closure)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Load GO DAG from OBO into PostgreSQL")
    parser.add_argument(
        "--obo",
        required=True,
        help="Path to go-basic.obo file",
    )
    parser.add_argument(
        "--dsn",
        required=True,
        help="PostgreSQL DSN, e.g. postgresql://user:pass@host:5433/dbname",
    )
    parser.add_argument(
        "--include-part-of",
        action="store_true",
        default=True,
        help="Include part_of relations (default: True)",
    )
    parser.add_argument(
        "--no-part-of",
        dest="include_part_of",
        action="store_false",
        help="Exclude part_of relations (only is_a)",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Truncate tables before inserting",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse OBO but do not write to database",
    )
    args = parser.parse_args()

    obo_path = Path(args.obo)
    if not obo_path.exists():
        print(f"ERROR: OBO file not found: {obo_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Parsing OBO: {obo_path}")
    t0 = time.time()
    terms, alt_map, header = parse_obo(str(obo_path))
    elapsed = time.time() - t0

    term_count = all_terms_count
    obs_count = term_count - len(terms)
    active_count = len(terms)
    print(f"  Parsed {term_count} terms ({obs_count} obsolete, {active_count} active) in {elapsed:.1f}s")
    print(f"  alt_id mappings: {len(alt_map)}")
    print(f"  Header: format-version={header.get('format-version')}, data-version={header.get('data-version')}")

    if args.dry_run:
        print("\nDry-run complete. No data written.")
        return

    print(f"\nConnecting to PostgreSQL...")
    conn = psycopg2.connect(args.dsn)
    conn.autocommit = False

    try:
        print("Running migration (create tables)...")
        run_migration(conn)

        print(f"Writing DAG data (include_part_of={args.include_part_of})...")
        t0 = time.time()
        term_cnt, edge_cnt, closure_cnt = write_dag(
            conn,
            terms,
            alt_map,
            header,
            args.include_part_of,
            args.replace,
            obo_path=str(obo_path),
        )
        conn.commit()
        elapsed = time.time() - t0
        print(f"\nDone! Wrote {term_cnt} terms, {edge_cnt} edges, {closure_cnt} closure rows in {elapsed:.1f}s", flush=True)
        print(f"  GO DAG is ready for annotation_mode=propagated queries.", flush=True)

    except Exception as e:
        conn.rollback()
        print(f"ERROR: {e}", file=sys.stderr)
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
