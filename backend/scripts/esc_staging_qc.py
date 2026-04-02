"""
Step 1: ESC Staging 数据质量检查
分析 stg_esc_master 和 stg_day_deseq2，输出：
  - 总行数、有效基因行数
  - . / LOC / clean symbol 分类
  - 新增基因估算（不在 gene_xref 中的）
  - 样本列完整性检查
"""
import sys
import psycopg2

PG = dict(host="127.0.0.1", port=5433, database="grcg6a",
          user="grcuser", password="grcpassword")


def pg_connect():
    return psycopg2.connect(**PG)


def q(conn, sql):
    with conn.cursor() as cur:
        cur.execute(sql)
        return cur.fetchall()


def main():
    print("[===] Step 1: ESC Staging QC [===]\n")
    conn = pg_connect()

    try:
        # ── 1. stg_esc_master 总览 [==][==][==][==][==][==][==][==][==][==][==][==][==][==][==]──
        total = q(conn, "SELECT COUNT(*) FROM stg_esc_master")[0][0]
        dot   = q(conn, "SELECT COUNT(*) FROM stg_esc_master WHERE gene_id = '.'")[0][0]
        loc   = q(conn, "SELECT COUNT(*) FROM stg_esc_master WHERE gene_id ~ '^LOC'")[0][0]
        clean = q(conn, "SELECT COUNT(*) FROM stg_esc_master WHERE gene_id != '.' AND gene_id !~ '^LOC'")[0][0]

        print(f"[==] stg_esc_master ({total:,} 行) [==]")
        print(f"  .   (tRNA/miRNA等): {dot:,}")
        print(f"  LOC (非编码RNA基因): {loc:,}")
        print(f"  clean symbol: {clean:,}")

        # gene_id != gene_name 的 variant 行
        variant = q(conn,
            "SELECT COUNT(*) FROM stg_esc_master "
            "WHERE gene_id != gene_name AND gene_id != '.'")[0][0]
        print(f"  variant (gene_id≠gene_name): {variant:,}")

        # gene_name = 0 的异常行
        gn_zero = q(conn,
            "SELECT COUNT(*) FROM stg_esc_master WHERE gene_name = '0'")[0][0]
        print(f"  gene_name='0' 异常: {gn_zero}")

        # ── 2. stg_day_deseq2 总览 [==][==][==][==][==][==][==][==][==][==][==][==][==][==][==]──
        day_total = q(conn, "SELECT COUNT(*) FROM stg_day_deseq2")[0][0]
        day_cols  = q(conn,
            """SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema='public' AND table_name='stg_day_deseq2'
                 AND column_name NOT IN ('gene_id','updated_at')""")[0][0]
        print(f"\n[==] stg_day_deseq2 ({day_total:,} 行 × {day_cols} 样本列) [==]")

        # 样本列名匹配检查
        day_col_names = q(conn,
            """SELECT column_name FROM information_schema.columns
               WHERE table_schema='public' AND table_name='stg_day_deseq2'
                 AND column_name NOT IN ('gene_id','updated_at')
               ORDER BY column_name""")
        day_names = [r[0] for r in day_col_names]
        expr_names = q(conn,
            """SELECT sample_name FROM expression_sample
               WHERE sample_name LIKE 'E%' ORDER BY stage_order, sex, replicate""")
        expr_names_list = [r[0] for r in expr_names]

        # 检查命名一致性（TSV 用下划线，expression_sample 用点）
        mismatch = [(d, e) for d, e in zip(day_names, expr_names_list)
                    if d != e]
        if mismatch:
            print(f"  [!] TSV 列名与 expression_sample.sample_name 不匹配:")
            for d, e in mismatch[:5]:
                print(f"     TSV='{d}' vs sample='{e}'")
        else:
            print(f"  [OK] TSV 列名与 expression_sample.sample_name 完全匹配 ({len(day_names)} 列)")

        # ── 3. 新增基因估算 [==][==][==][==][==][==][==][==][==][==][==][==][==][==][==][==][==][==]──
        new_from_master = q(conn,
            """SELECT COUNT(DISTINCT
                   CASE WHEN gene_id ~ '^LOC'  THEN 'gene-' || gene_id
                        WHEN gene_id = '.'      THEN NULL
                        ELSE 'gene-' || gene_id END)
               FROM stg_esc_master
               WHERE gene_id NOT IN ('.')
                 AND ('gene-' || gene_id) NOT IN (SELECT gene_id FROM gene_xref)
                 AND gene_id !~ '^LOC'""")[0][0]

        print(f"\n[==] 新增基因估算 [==]")
        print(f"  来自 stg_esc_master (clean symbol → gene-xref格式): ~{new_from_master:,} 行")
        print(f"  gene_xref 现有总数: {q(conn,'SELECT COUNT(*) FROM gene_xref')[0][0]:,}")

        # ── 4. expression_sample 对照 [==][==][==][==][==][==][==][==][==][==][==][==][==][==][==]
        print(f"\n[==] expression_sample ({q(conn,'SELECT COUNT(*) FROM expression_sample')[0][0]} 行) [==]")
        stages = q(conn,
            """SELECT stage, COUNT(*) FROM expression_sample
               GROUP BY stage ORDER BY MIN(stage_order)""")
        for stage, cnt in stages:
            print(f"  {stage}: {cnt} 样本")

        print("\n" + "=" * 40)
        print("[OK] Staging QC 完成")

    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
