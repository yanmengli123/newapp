#!/usr/bin/env python3
"""
GRCg6a SQLite → PostgreSQL 迁移脚本

用法:
  python scripts/migrate_to_postgresql.py --dry-run          # 干跑（不写入）
  python scripts/migrate_to_postgresql.py --truncate-first  # 先清空 PG 表再迁移
  python scripts/migrate_to_postgresql.py                  # 标准迁移（幂等追加）
  python scripts/migrate_to_postgresql.py --stats           # 仅打印行数统计
  python scripts/migrate_to_postgresql.py --step 6          # 仅执行第6步（kegg_pathway_asset）
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import psycopg2
import psycopg2.extras
import sqlite3

# ─────────────────────────────────────────────
# 全局配置（从 backend/config.py 读取相同路径）
# ─────────────────────────────────────────────
SQLITE_DB = Path(os.getenv(
    "GRCG6A_DB_PATH",
    r"D:\jbrowsedata\projectdata\grcg6a_nc.db"
)).resolve()

# PostgreSQL DSN（默认连接 docker-compose 暴露的 5433 端口）
PG_DSN = os.getenv(
    "DATABASE_URL",
    "postgresql://grcuser:grcpassword@127.0.0.1:5433/grcg6a"
)

BATCH_SIZE = 2000
CHUNK_SIZE = 2000


# ─────────────────────────────────────────────
# 辅助函数
# ─────────────────────────────────────────────
def log(msg: str, /):
    print(f"  {msg}")


def step_header(n: int, name: str):
    print(f"\n{'='*60}")
    print(f"Step {n}: {name}")
    print('='*60)


def get_sqlite_row_count(sqlite_conn: sqlite3.Connection, table: str) -> int:
    cur = sqlite_conn.execute(f"SELECT COUNT(*) FROM {table}")
    return cur.fetchone()[0]


def get_pg_row_count(pg_conn, table: str) -> int:
    with pg_conn.cursor() as cur:
        cur.execute(f'SELECT COUNT(*) FROM {table}')
        return cur.fetchone()[0]


def pg_truncate(pg_conn, table: str):
    with pg_conn.cursor() as cur:
        cur.execute(f'TRUNCATE TABLE {table} CASCADE')
    pg_conn.commit()
    print(f"  Truncated: {table}")


def fetchmany_stream(sqlite_conn: sqlite3.Connection, sql: str, params=None):
    cur = sqlite_conn.execute(sql, params or ())
    while True:
        rows = cur.fetchmany(BATCH_SIZE)
        if not rows:
            break
        for row in rows:
            yield dict(row)


def execute_values_stream(pg_conn, sql: str, stream, col_names: tuple[str, ...], page_size=CHUNK_SIZE):
    buf = []
    total = 0
    for row in stream:
        buf.append(tuple(row.get(c) for c in col_names))
        if len(buf) >= page_size:
            psycopg2.extras.execute_values(pg_conn.cursor(), sql, buf, page_size=page_size)
            total += len(buf)
            pg_conn.commit()
            buf = []
    if buf:
        psycopg2.extras.execute_values(pg_conn.cursor(), sql, buf, page_size=len(buf))
        total += len(buf)
        pg_conn.commit()
    return total


# ─────────────────────────────────────────────
# 迁移步骤
# ─────────────────────────────────────────────

def migrate_chromosome(sqlite_conn, pg_conn, dry_run: bool, truncate: bool):
    step_header(1, "chromosome")
    cnt = get_sqlite_row_count(sqlite_conn, "chromosome")
    print(f"  SQLite rows: {cnt}")
    if dry_run:
        print("  [DRY-RUN] skip")
        return
    if truncate:
        pg_truncate(pg_conn, "chromosome")

    cols = ("seqid", "chr_name", "length", "description")
    sql = f"INSERT INTO chromosome ({','.join(cols)}) VALUES %s ON CONFLICT (seqid) DO NOTHING"
    total = execute_values_stream(
        pg_conn, sql,
        fetchmany_stream(sqlite_conn, "SELECT seqid, chr_name, length, description FROM chromosome"),
        cols,
    )
    print(f"  Inserted: {total}")


def migrate_gene_xref(sqlite_conn, pg_conn, dry_run: bool, truncate: bool):
    step_header(2, "gene_xref")
    cnt = get_sqlite_row_count(sqlite_conn, "gene_xref")
    print(f"  SQLite rows: {cnt}")
    if dry_run:
        print("  [DRY-RUN] skip")
        return
    if truncate:
        pg_truncate(pg_conn, "gene_xref")

    cols = ("gene_id", "gene_symbol", "ncbi_gene_id", "ensembl_gene_id",
            "ensembl_transcript_id", "seqid", "gene_start", "gene_end",
            "gene_strand", "gene_biotype")
    sql = f"INSERT INTO gene_xref ({','.join(cols)}) VALUES %s ON CONFLICT (gene_id) DO NOTHING"
    total = execute_values_stream(
        pg_conn, sql,
        fetchmany_stream(
            sqlite_conn,
            """SELECT
                gene_id, gene_symbol, ncbi_gene_id, ensembl_gene_id,
                ensembl_transcript_id,
                NULL AS seqid, NULL AS gene_start, NULL AS gene_end,
                NULL AS gene_strand, NULL AS gene_biotype
               FROM gene_xref"""
        ),
        cols,
    )
    print(f"  Inserted: {total}")


def migrate_go_term(sqlite_conn, pg_conn, dry_run: bool, truncate: bool):
    step_header(3, "go_term (from gene_go)")
    cnt = get_sqlite_row_count(sqlite_conn, "gene_go")
    print(f"  gene_go rows: {cnt}")
    if dry_run:
        print("  [DRY-RUN] skip")
        return
    if truncate:
        pg_truncate(pg_conn, "go_term")

    cols = ("go_id", "go_name", "go_namespace", "go_definition")
    sql = f"INSERT INTO go_term ({','.join(cols)}) VALUES %s ON CONFLICT (go_id) DO NOTHING"
    unique_go_sql = """SELECT DISTINCT
            gg.go_id, gg.go_name, gg.go_namespace,
            COALESCE(MAX(gg.go_definition) OVER (PARTITION BY gg.go_id), '') AS go_def
        FROM gene_go gg"""
    total = execute_values_stream(
        pg_conn, sql,
        fetchmany_stream(sqlite_conn, unique_go_sql),
        cols,
    )
    print(f"  Inserted (unique go_ids): {total}")


def migrate_gene_go(sqlite_conn, pg_conn, dry_run: bool, truncate: bool):
    step_header(4, "gene_go")
    go_term_cnt = get_pg_row_count(pg_conn, "go_term")
    print(f"  go_term rows in PG: {go_term_cnt}")
    if go_term_cnt == 0:
        print("  [WARN] go_term is empty! Run step 3 first.")
        return

    cnt = get_sqlite_row_count(sqlite_conn, "gene_go")
    print(f"  SQLite rows: {cnt}")
    if dry_run:
        print("  [DRY-RUN] skip")
        return
    if truncate:
        pg_truncate(pg_conn, "gene_go")

    cols = ("gene_id", "go_id", "evidence_code", "source")
    sql = f"""INSERT INTO gene_go (gene_id, go_id, evidence_code, source)
        VALUES %s ON CONFLICT (gene_id, go_id, evidence_code) DO NOTHING"""
    dedup_sql = """SELECT DISTINCT
            gene_id, go_id,
            NULLIF(TRIM(evidence_code), '') AS evidence_code,
            NULLIF(TRIM(source), '') AS source
        FROM gene_go WHERE go_id IS NOT NULL AND go_id != ''"""
    total = execute_values_stream(pg_conn, sql, fetchmany_stream(sqlite_conn, dedup_sql), cols)
    print(f"  Inserted (deduped): {total}")


def migrate_gene_kegg(sqlite_conn, pg_conn, dry_run: bool, truncate: bool):
    step_header(5, "gene_kegg")
    cnt = get_sqlite_row_count(sqlite_conn, "gene_kegg")
    print(f"  SQLite rows: {cnt}")
    if dry_run:
        print("  [DRY-RUN] skip")
        return
    if truncate:
        pg_truncate(pg_conn, "gene_kegg")

    cols = ("gene_id", "gene_symbol", "ncbi_gene_id", "kegg_gene_id")
    sql = f"INSERT INTO gene_kegg ({','.join(cols)}) VALUES %s ON CONFLICT (gene_id) DO NOTHING"
    total = execute_values_stream(
        pg_conn, sql,
        fetchmany_stream(sqlite_conn, "SELECT gene_id, gene_symbol, ncbi_gene_id, kegg_gene_id FROM gene_kegg"),
        cols,
    )
    print(f"  Inserted: {total}")


def migrate_kegg_pathway_asset(sqlite_conn, pg_conn, dry_run: bool, truncate: bool):
    step_header(6, "kegg_pathway_asset")
    cnt = get_sqlite_row_count(sqlite_conn, "kegg_pathway_asset")
    print(f"  SQLite rows: {cnt}")
    if dry_run:
        print("  [DRY-RUN] skip")
        return
    if truncate:
        pg_truncate(pg_conn, "kegg_pathway_asset")

    cols = ("pathway_id", "pathway_name", "pathway_class",
            "png_filename", "png_relpath", "png_url",
            "png_file_size", "png_width", "png_height",
            "kgml_filename", "kgml_relpath", "kgml_file_size",
            "node_count", "gene_count")
    sql = f"INSERT INTO kegg_pathway_asset ({','.join(cols)}) VALUES %s ON CONFLICT (pathway_id) DO NOTHING"
    total = execute_values_stream(
        pg_conn, sql,
        fetchmany_stream(
            sqlite_conn,
            """SELECT pathway_id, pathway_name, pathway_class,
                      png_filename, png_relpath, png_url,
                      png_file_size, png_width, png_height,
                      kgml_filename, kgml_relpath, kgml_file_size,
                      node_count, gene_count
               FROM kegg_pathway_asset"""
        ),
        cols,
    )
    print(f"  Inserted: {total}")


def migrate_gene_kegg_pathway(sqlite_conn, pg_conn, dry_run: bool, truncate: bool):
    step_header(7, "gene_kegg_pathway")
    cnt = get_sqlite_row_count(sqlite_conn, "gene_kegg_pathway")
    print(f"  SQLite rows: {cnt}")
    if dry_run:
        print("  [DRY-RUN] skip")
        return
    if truncate:
        pg_truncate(pg_conn, "gene_kegg_pathway")

    cols = ("gene_id", "pathway_id")
    sql = f"INSERT INTO gene_kegg_pathway ({','.join(cols)}) VALUES %s ON CONFLICT (gene_id, pathway_id) DO NOTHING"
    total = execute_values_stream(
        pg_conn, sql,
        fetchmany_stream(
            sqlite_conn,
            "SELECT DISTINCT gene_id, pathway_id FROM gene_kegg_pathway WHERE gene_id IS NOT NULL AND pathway_id IS NOT NULL"
        ),
        cols,
    )
    print(f"  Inserted (deduped): {total}")


def migrate_kegg_pathway_node(sqlite_conn, pg_conn, dry_run: bool, truncate: bool):
    step_header(8, "kegg_pathway_node (保留原整数 ID)")
    cnt = get_sqlite_row_count(sqlite_conn, "kegg_pathway_node")
    print(f"  SQLite rows: {cnt}")
    if dry_run:
        print("  [DRY-RUN] skip")
        return
    if truncate:
        pg_truncate(pg_conn, "kegg_pathway_node")

    cols = ("id", "pathway_id", "entry_id", "entry_type", "entry_name",
            "graphics_type", "x", "y", "width", "height",
            "left_x", "top_y", "right_x", "bottom_y",
            "raw_names", "link_url")
    sql = f"INSERT INTO kegg_pathway_node ({','.join(cols)}) VALUES %s ON CONFLICT (pathway_id, entry_id) DO NOTHING"
    total = execute_values_stream(
        pg_conn, sql,
        fetchmany_stream(
            sqlite_conn,
            """SELECT id, pathway_id, entry_id, entry_type, entry_name,
                      graphics_type, x, y, width, height,
                      left_x, top_y, right_x, bottom_y,
                      raw_names, link_url
               FROM kegg_pathway_node"""
        ),
        cols,
    )
    print(f"  Inserted: {total}")

    if total > 0:
        max_id = sqlite_conn.execute("SELECT MAX(id) FROM kegg_pathway_node").fetchone()[0]
        with pg_conn.cursor() as cur:
            cur.execute(f"SELECT setval(pg_get_serial_sequence('kegg_pathway_node', 'id'), {max_id}, true)")
        pg_conn.commit()
        print(f"  Reset identity sequence to {max_id}")


def migrate_kegg_pathway_node_gene(sqlite_conn, pg_conn, dry_run: bool, truncate: bool):
    step_header(9, "kegg_pathway_node_gene")
    cnt = get_sqlite_row_count(sqlite_conn, "kegg_pathway_node_gene")
    print(f"  SQLite rows: {cnt}")
    if dry_run:
        print("  [DRY-RUN] skip")
        return
    if truncate:
        pg_truncate(pg_conn, "kegg_pathway_node_gene")

    cols = ("pathway_id", "node_id", "kegg_gene_id", "gene_symbol")
    sql = f"INSERT INTO kegg_pathway_node_gene ({','.join(cols)}) VALUES %s ON CONFLICT (node_id, kegg_gene_id) DO NOTHING"
    total = execute_values_stream(
        pg_conn, sql,
        fetchmany_stream(
            sqlite_conn,
            "SELECT pathway_id, node_id, kegg_gene_id, gene_symbol FROM kegg_pathway_node_gene"
        ),
        cols,
    )
    print(f"  Inserted: {total}")


def migrate_transcript_seq(sqlite_conn, pg_conn, dry_run: bool, truncate: bool):
    step_header(10, "transcript_seq")
    cnt = get_sqlite_row_count(sqlite_conn, "transcript_seq")
    print(f"  SQLite rows: {cnt}")
    if dry_run:
        print("  [DRY-RUN] skip")
        return
    if truncate:
        pg_truncate(pg_conn, "transcript_seq")

    cols = ("transcript_acc", "transcript_id", "gene_id", "seqid", "length", "description", "seq")
    sql = f"INSERT INTO transcript_seq ({','.join(cols)}) VALUES %s ON CONFLICT (transcript_acc) DO NOTHING"
    query = """SELECT t.transcript_acc, t.transcript_id, t.gene_id,
                      t.seqid, t.length, t.description, t.seq
               FROM transcript_seq t
               INNER JOIN gene_xref x ON t.gene_id = x.gene_id"""
    total = execute_values_stream(
        pg_conn, sql,
        fetchmany_stream(sqlite_conn, query),
        cols,
    )
    print(f"  Inserted: {total}")


def migrate_cds_seq(sqlite_conn, pg_conn, dry_run: bool, truncate: bool):
    step_header(11, "cds_seq")
    cnt = get_sqlite_row_count(sqlite_conn, "cds_seq")
    print(f"  SQLite rows: {cnt}")
    if dry_run:
        print("  [DRY-RUN] skip")
        return
    if truncate:
        pg_truncate(pg_conn, "cds_seq")

    cols = ("protein_id", "gene_symbol", "seqid", "length", "description", "seq")
    sql = f"INSERT INTO cds_seq ({','.join(cols)}) VALUES %s ON CONFLICT (protein_id) DO NOTHING"
    total = execute_values_stream(
        pg_conn, sql,
        fetchmany_stream(sqlite_conn, "SELECT protein_id, gene_symbol, seqid, length, description, seq FROM cds_seq"),
        cols,
    )
    print(f"  Inserted: {total}")


def migrate_protein_seq(sqlite_conn, pg_conn, dry_run: bool, truncate: bool):
    step_header(12, "protein_seq")
    cnt = get_sqlite_row_count(sqlite_conn, "protein_seq")
    print(f"  SQLite rows: {cnt}")
    if dry_run:
        print("  [DRY-RUN] skip")
        return
    if truncate:
        pg_truncate(pg_conn, "protein_seq")

    cols = ("protein_id", "length", "description", "seq")
    sql = f"INSERT INTO protein_seq ({','.join(cols)}) VALUES %s ON CONFLICT (protein_id) DO NOTHING"
    total = execute_values_stream(
        pg_conn, sql,
        fetchmany_stream(sqlite_conn, "SELECT protein_id, length, description, seq FROM protein_seq"),
        cols,
    )
    print(f"  Inserted: {total}")


def migrate_expression_sample(sqlite_conn, pg_conn, dry_run: bool, truncate: bool):
    step_header(13, "expression_sample (保留原 ID)")
    cnt = get_sqlite_row_count(sqlite_conn, "expression_sample")
    print(f"  SQLite rows: {cnt}")
    if dry_run:
        print("  [DRY-RUN] skip")
        return
    if truncate:
        pg_truncate(pg_conn, "expression_sample")

    cols = ("id", "sample_name", "stage", "stage_label", "stage_order", "sex", "replicate")
    sql = f"INSERT INTO expression_sample ({','.join(cols)}) VALUES %s ON CONFLICT (id) DO NOTHING"
    total = execute_values_stream(
        pg_conn, sql,
        fetchmany_stream(
            sqlite_conn,
            "SELECT id, sample_name, stage, stage_label, stage_order, sex, replicate FROM expression_sample ORDER BY stage_order, sex, replicate"
        ),
        cols,
    )
    print(f"  Inserted: {total}")

    if total > 0:
        max_id = sqlite_conn.execute("SELECT MAX(id) FROM expression_sample").fetchone()[0]
        with pg_conn.cursor() as cur:
            cur.execute(f"SELECT setval(pg_get_serial_sequence('expression_sample', 'id'), {max_id}, true)")
        pg_conn.commit()
        print(f"  Reset identity sequence to {max_id}")


def migrate_gene_expression(sqlite_conn, pg_conn, dry_run: bool, truncate: bool):
    step_header(14, "gene_expression (宽表，72 表达值列)")
    cnt = get_sqlite_row_count(sqlite_conn, "gene_expression")
    print(f"  SQLite rows: {cnt}")
    if dry_run:
        print("  [DRY-RUN] skip")
        return
    if truncate:
        pg_truncate(pg_conn, "gene_expression")

    fpkm_cols = [f"e{s}_{sx}{r}_fpkm"
                 for s, s_key in [("0","e0"),("35","e35"),("45","e45"),("55","e55"),("65","e65"),("185","e185")]
                 for sx in ("f", "m") for r in (1, 2, 3)]
    tpm_cols = [f"e{s}_{sx}{r}_tpm"
                for s, s_key in [("0","e0"),("35","e35"),("45","e45"),("55","e55"),("65","e65"),("185","e185")]
                for sx in ("f", "m") for r in (1, 2, 3)]
    all_cols = ("gene_id",) + tuple(fpkm_cols) + tuple(tpm_cols)

    sql = f"INSERT INTO gene_expression ({','.join(all_cols)}) VALUES %s ON CONFLICT (gene_id) DO NOTHING"
    total = execute_values_stream(
        pg_conn, sql,
        fetchmany_stream(
            sqlite_conn,
            f"SELECT gene_id, {','.join(fpkm_cols + tpm_cols)} FROM gene_expression"
        ),
        all_cols,
    )
    print(f"  Inserted: {total}")


# ─────────────────────────────────────────────
# 统计 & 验证
# ─────────────────────────────────────────────

def print_stats(sqlite_conn, pg_conn):
    tables = [
        "chromosome", "gene_xref", "go_term", "gene_go",
        "gene_kegg", "kegg_pathway_asset", "gene_kegg_pathway",
        "kegg_pathway_node", "kegg_pathway_node_gene",
        "transcript_seq", "cds_seq", "protein_seq",
        "expression_sample", "gene_expression",
    ]
    print("\n" + "=" * 60)
    print("Row count comparison: SQLite vs PostgreSQL")
    print("=" * 60)
    print(f"{'Table':<35} {'SQLite':>10} {'PostgreSQL':>10} {'Match':>8}")
    print("-" * 65)
    for t in tables:
        try:
            s_cnt = get_sqlite_row_count(sqlite_conn, t)
        except Exception:
            s_cnt = 0
        try:
            p_cnt = get_pg_row_count(pg_conn, t)
        except Exception:
            p_cnt = 0
        match = "OK" if s_cnt == p_cnt else "DIFF"
        print(f"{t:<35} {s_cnt:>10,} {p_cnt:>10,} {match:>8}")
    print("-" * 65)


# ─────────────────────────────────────────────
# 主入口
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="GRCg6a: SQLite → PostgreSQL migration")
    parser.add_argument("--dry-run", action="store_true", help="Dry run (no writes)")
    parser.add_argument("--truncate-first", action="store_true", help="Truncate PG tables before migrating")
    parser.add_argument("--stats", action="store_true", help="Print row-count comparison and exit")
    parser.add_argument("--step", type=int, choices=range(1, 15), metavar="1-14",
                        help="Run a single step by number")
    args = parser.parse_args()

    if not SQLITE_DB.exists():
        print(f"[ERROR] SQLite DB not found: {SQLITE_DB}")
        sys.exit(1)

    sqlite_conn = sqlite3.connect(str(SQLITE_DB))
    sqlite_conn.row_factory = sqlite3.Row
    print(f"SQLite connected: {SQLITE_DB}")

    try:
        pg_conn = psycopg2.connect(PG_DSN)
        pg_conn.autocommit = False
        print(f"PostgreSQL connected: {PG_DSN[:50]}...")
    except psycopg2.OperationalError as e:
        print(f"[ERROR] Cannot connect to PostgreSQL: {e}")
        print(f"  Hint: Run 'docker-compose up -d postgres' first, or check PG_DSN.")
        sqlite_conn.close()
        sys.exit(1)

    try:
        if args.stats:
            print_stats(sqlite_conn, pg_conn)
            return

        if args.step is not None:
            steps = [
                (1,  "chromosome",               migrate_chromosome),
                (2,  "gene_xref",                migrate_gene_xref),
                (3,  "go_term",                  migrate_go_term),
                (4,  "gene_go",                 migrate_gene_go),
                (5,  "gene_kegg",               migrate_gene_kegg),
                (6,  "kegg_pathway_asset",      migrate_kegg_pathway_asset),
                (7,  "gene_kegg_pathway",        migrate_gene_kegg_pathway),
                (8,  "kegg_pathway_node",        migrate_kegg_pathway_node),
                (9,  "kegg_pathway_node_gene",  migrate_kegg_pathway_node_gene),
                (10, "transcript_seq",           migrate_transcript_seq),
                (11, "cds_seq",                 migrate_cds_seq),
                (12, "protein_seq",             migrate_protein_seq),
                (13, "expression_sample",        migrate_expression_sample),
                (14, "gene_expression",          migrate_gene_expression),
            ]
            n, name, fn = next((x for x in steps if x[0] == args.step), (None, None, None))
            if fn:
                fn(sqlite_conn, pg_conn, args.dry_run, args.truncate_first)
                print_stats(sqlite_conn, pg_conn)
            return

        # 全量迁移
        start = time.time()
        print("\n" + "=" * 60)
        print("FULL MIGRATION: SQLite → PostgreSQL")
        print("=" * 60)

        steps = [
            ("chromosome",               migrate_chromosome),
            ("gene_xref",               migrate_gene_xref),
            ("go_term",                 migrate_go_term),
            ("gene_go",                 migrate_gene_go),
            ("gene_kegg",               migrate_gene_kegg),
            ("kegg_pathway_asset",     migrate_kegg_pathway_asset),
            ("gene_kegg_pathway",       migrate_gene_kegg_pathway),
            ("kegg_pathway_node",       migrate_kegg_pathway_node),
            ("kegg_pathway_node_gene",  migrate_kegg_pathway_node_gene),
            ("transcript_seq",          migrate_transcript_seq),
            ("cds_seq",                migrate_cds_seq),
            ("protein_seq",            migrate_protein_seq),
            ("expression_sample",       migrate_expression_sample),
            ("gene_expression",         migrate_gene_expression),
        ]

        for i, (name, fn) in enumerate(steps, 1):
            fn(sqlite_conn, pg_conn, args.dry_run, args.truncate_first)

        elapsed = time.time() - start
        print("\n" + "=" * 60)
        print(f"Migration complete in {elapsed:.1f}s")
        print("=" * 60)
        print_stats(sqlite_conn, pg_conn)

    finally:
        sqlite_conn.close()
        pg_conn.close()
        print("\nConnections closed.")


if __name__ == "__main__":
    main()
