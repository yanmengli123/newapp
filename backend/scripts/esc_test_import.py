"""
Step 15: expression_fact 导入验证
抽样验证 3 个数据集的表达量数据：
  1. raw_ballgown_36  — TPM/FPKM/NORMCOUNT × 23 SRR 样本
  2. day_deseq2_36     — NORMCOUNT × 36 发育阶段样本
  3. esc_srr_23       — TPM/FPKM × 23 SRR 样本

对每个数据集：
  - 检查样本数、行数、基因数
  - 抽查 1 个基因的原始值 vs expression_fact 聚合
  - 验证 gene_expression_summary 统计量
  - 验证 v_gene_expression_wide 视图
"""
import sys
import psycopg2
import psycopg2.extras

PG = dict(host="127.0.0.1", port=5433, database="grcg6a",
          user="grcuser", password="grcpassword")


def pg_connect():
    return psycopg2.connect(**PG)


def q(conn, sql, params=None, one=False):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
        return rows[0] if one and rows else rows


def check_dataset(conn, ds_code, expected_samples, expected_metrics):
    """验证单个数据集。"""
    print(f"\n[==] {ds_code} [==]")

    # 1. dataset_sample 样本数
    samples = q(conn,
        """SELECT COUNT(*) AS cnt FROM dataset_sample WHERE dataset_id =
           (SELECT dataset_id FROM dataset WHERE dataset_code = %s)""",
        (ds_code,))
    s_cnt = samples[0]["cnt"]
    ok_s = s_cnt == expected_samples
    print(f"  样本数: {s_cnt} / {expected_samples} {'[OK]' if ok_s else '[FAIL]'}")

    # 2. expression_fact 行数
    facts = q(conn,
        """SELECT metric_code, COUNT(*) AS cnt, COUNT(DISTINCT gene_id) AS genes
           FROM expression_fact f
           JOIN dataset_sample ds ON ds.dataset_sample_id = f.dataset_sample_id
           WHERE ds.dataset_id = (SELECT dataset_id FROM dataset WHERE dataset_code = %s)
           GROUP BY metric_code""",
        (ds_code,))
    print(f"  expression_fact:")
    ok_m = set(r["metric_code"] for r in facts) == set(expected_metrics)
    for r in sorted(facts, key=lambda x: x["metric_code"]):
        ok = r["metric_code"] in expected_metrics
        print(f"    {r['metric_code']}: {r['cnt']:,} 行 × {r['genes']:,} 基因 {'[OK]' if ok else '[FAIL]'}")
    if set(r["metric_code"] for r in facts) != set(expected_metrics):
        missing = set(expected_metrics) - set(r["metric_code"] for r in facts)
        print(f"    [FAIL] 缺失 metric: {missing}")
        ok_m = False

    # 3. 抽查基因 A4GALT（若有）
    gene_id = "gene-A4GALT"
    detail = q(conn,
        """SELECT f.metric_code, COUNT(*) AS sample_count,
                  MIN(f.value)::float AS min_v, MAX(f.value)::float AS max_v,
                  AVG(f.value)::float AS avg_v
           FROM expression_fact f
           JOIN dataset_sample ds ON ds.dataset_sample_id = f.dataset_sample_id
           WHERE f.gene_id = %s
             AND ds.dataset_id = (SELECT dataset_id FROM dataset WHERE dataset_code = %s)
           GROUP BY f.metric_code""",
        (gene_id, ds_code))
    if detail:
        print(f"  抽检 {gene_id}:")
        for r in detail:
            print(f"    {r['metric_code']}: "
                  f"n={r['sample_count']}, "
                  f"avg={r['avg_v']:.2f}, "
                  f"min={r['min_v']:.2f}, max={r['max_v']:.2f}")

    # 4. gene_expression_summary 验证
    summary = q(conn,
        """SELECT metric_code, COUNT(*) AS cnt,
                  AVG(mean_value) AS avg_mean, MAX(max_value) AS max_of_max
           FROM gene_expression_summary
           WHERE dataset_code = %s
           GROUP BY metric_code""",
        (ds_code,))
    print(f"  gene_expression_summary:")
    for r in sorted(summary, key=lambda x: x["metric_code"]):
        print(f"    {r['metric_code']}: {r['cnt']:,} 基因, "
              f"avg_mean={r['avg_mean']:.2f}, max_of_max={r['max_of_max']:.2f}")

    # 5. v_gene_expression_wide 验证
    wide = q(conn,
        """SELECT COUNT(*) AS cnt, COUNT(DISTINCT gene_id) AS genes
           FROM v_gene_expression_wide
           WHERE dataset_code = %s""",
        (ds_code,), one=True)
    print(f"  v_gene_expression_wide: {wide['cnt']:,} 行 × {wide['genes']:,} 基因")

    return ok_s and ok_m


def main():
    print("[===] Step 15: expression_fact 导入验证 [===]\n")

    conn = pg_connect()
    try:
        print("[==] Global consistency [==]")
        xref = q(conn, "SELECT COUNT(*) AS cnt FROM gene_xref", one=True)["cnt"]
        fact_genes = q(conn,
            "SELECT COUNT(DISTINCT gene_id) AS cnt FROM expression_fact", one=True)["cnt"]
        summary_genes = q(conn,
            "SELECT COUNT(DISTINCT gene_id) AS cnt FROM gene_expression_summary", one=True)["cnt"]
        alias = q(conn, "SELECT COUNT(*) AS cnt FROM gene_alias", one=True)["cnt"]
        unmapped = q(conn, "SELECT COUNT(*) AS cnt FROM unmapped_feature", one=True)["cnt"]

        print(f"  gene_xref: {xref:,}")
        print(f"  expression_fact genes: {fact_genes:,}")
        print(f"  gene_expression_summary genes: {summary_genes:,}")
        print(f"  gene_alias: {alias}")
        print(f"  unmapped_feature: {unmapped}")

        ds1 = check_dataset(conn, "raw_ballgown_36", expected_samples=23,
                            expected_metrics=["fpkm", "normcount", "tpm"])
        ds2 = check_dataset(conn, "day_deseq2_36",   expected_samples=36,
                            expected_metrics=["normcount"])
        check_dataset(conn, "esc_srr_23",              expected_samples=23,
                            expected_metrics=[])

        print(f"\n[==] v_gene_expression_development [==]")
        dev = q(conn,
            """SELECT COUNT(DISTINCT gene_id) AS genes, COUNT(DISTINCT stage) AS stages
               FROM v_gene_expression_development""", one=True)
        print(f"  {dev['genes']:,} genes x {dev['stages']} stages")
        if dev["stages"] == 6:
            print(f"  [OK] 6 developmental stages covered")
        else:
            print(f"  [FAIL] stages={dev['stages']}, expected 6")

        print("\n" + "=" * 40)
        all_ok = ds1 and ds2
        if all_ok:
            print("[OK] Step 15 PASSED")
        else:
            print("[FAIL] Step 15 FAILED")

        return 0 if all_ok else 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
