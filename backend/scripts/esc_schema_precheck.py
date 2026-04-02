"""
Step 0: ESC Schema 预检查
验证 PostgreSQL 中已创建所有依赖列，ESC TSV 文件格式正确。
"""
import sys, os
import psycopg2
import pandas as pd

PG = dict(host="127.0.0.1", port=5433, database="grcg6a",
          user="grcuser", password="grcpassword")
ESC_TSV = "D:/jbrowsedata/projectdata/escdata"


def pg_connect():
    return psycopg2.connect(**PG)


def check_pg_columns(conn):
    """验证 PostgreSQL 表结构和关键列存在。"""
    required = {
        "gene_xref":       ["gene_id"],
        "stg_esc_master":  ["gene_id", "gene_name"],
        "stg_day_deseq2":  ["gene_id"],
        "dataset_sample":  ["dataset_sample_id", "dataset_id", "sample_name",
                            "srr_run_id", "stage", "sex", "tpm_col", "fpkm_col", "nc_col"],
        "expression_sample": ["id", "sample_name", "stage", "sex", "replicate"],
        "expr_metric":     ["metric_code"],
        "expression_fact": ["gene_id", "dataset_sample_id", "metric_code", "value"],
        "gene_expression_summary": ["gene_id", "dataset_code", "metric_code",
                                      "mean_value", "max_value", "min_value"],
    }
    ok = True
    with conn.cursor() as cur:
        for tbl, cols in required.items():
            cur.execute(
                """SELECT column_name FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = %s""",
                (tbl,)
            )
            existing = {r[0] for r in cur.fetchall()}
            for col in cols:
                if col not in existing:
                    print(f"  [FAIL] {tbl}.{col} — 列不存在")
                    ok = False
            if all(c in existing for c in cols):
                print(f"  [OK]   {tbl}: 全部 {len(cols)} 列存在")
    return ok


def check_tsv_files():
    """验证 ESC TSV 文件存在且格式正确。"""
    files = {
        "master": "esc_ballgown_subset_master_expression_table.tsv",
        "tpm":    "esc_ballgown_subset_gene_TPM_matrix.tsv",
        "fpkm":   "esc_ballgown_subset_gene_FPKM_matrix.tsv",
        "counts": "esc_ballgown_subset_gene_count_matrix.tsv",
        "day":    "day_DESeq2_normalized_counts.tsv",
    }
    ok = True
    for key, fname in files.items():
        path = os.path.join(ESC_TSV, fname)
        if not os.path.exists(path):
            print(f"  [FAIL] {fname} — 文件不存在")
            ok = False
            continue
        df = pd.read_csv(path, sep="\t", dtype=str, nrows=2)
        print(f"  [OK]   {fname}: {df.shape[1]} 列 × ~{sum(1 for _ in open(path))} 行")
    return ok


def main():
    print("[===] Step 0: ESC Schema 预检查 [===]\n")

    # PostgreSQL 列检查
    print("[==] PostgreSQL 表结构 [==]")
    conn = pg_connect()
    try:
        pg_ok = check_pg_columns(conn)
    finally:
        conn.close()

    # TSV 文件检查
    print("\n[==] ESC TSV 文件 [==]")
    tsv_ok = check_tsv_files()

    # 结论
    print("\n" + "=" * 40)
    if pg_ok and tsv_ok:
        print("[OK] [PASS] — 可进入 Step 1")
        return 0
    else:
        print("[FAIL] [FAIL] — 请修复后再试")
        return 1


if __name__ == "__main__":
    sys.exit(main())
