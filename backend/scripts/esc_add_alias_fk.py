"""
Step 11: 添加 gene_alias → gene_xref FK 约束
在 gene_alias.canonical_id 上添加 FK，确保引用完整性。
幂等操作：若约束已存在则跳过。
"""
import sys
import psycopg2

PG = dict(host="127.0.0.1", port=5433, database="grcg6a",
          user="grcuser", password="grcpassword")


def pg_connect():
    return psycopg2.connect(**PG)


def main():
    print("[===] Step 11: gene_alias FK 约束 [===]\n")
    conn = pg_connect()

    FK_NAME = "gene_alias_canonical_id_fkey"
    TABLE   = "gene_alias"
    COL     = "canonical_id"
    REF     = "gene_xref"
    REF_COL = "gene_id"

    try:
        # 检查是否已存在
        with conn.cursor() as cur:
            cur.execute(
                """SELECT 1 FROM pg_constraint WHERE conname = %s""",
                (FK_NAME,)
            )
            exists = cur.fetchone() is not None

        if exists:
            print(f"  [SKIP] 约束 {FK_NAME} 已存在，跳过。")
        else:
            # 检查是否有孤立行（canonical_id 不在 gene_xref 中）
            with conn.cursor() as cur:
                cur.execute(
                    f"""SELECT COUNT(*) FROM {TABLE}
                        WHERE {COL} NOT IN (SELECT {REF_COL} FROM {REF})""")
                orphan = cur.fetchone()[0]
            if orphan > 0:
                print(f"  [WARN] {orphan} 行 canonical_id 无对应 gene_xref，先清理")
                with conn.cursor() as cur:
                    cur.execute(
                        f"""DELETE FROM {TABLE}
                            WHERE {COL} NOT IN (SELECT {REF_COL} FROM {REF})""")
                    conn.commit()
                    print(f"  已删除 {orphan} 孤立别名行。")

            # 添加 FK（DEFERRABLE INITIALLY DEFERRED 避免导入顺序问题）
            with conn.cursor() as cur:
                cur.execute(
                    f"""ALTER TABLE {TABLE}
                        ADD CONSTRAINT {FK_NAME}
                        FOREIGN KEY ({COL})
                        REFERENCES {REF}({REF_COL})
                        ON DELETE CASCADE
                        DEFERRABLE INITIALLY DEFERRED""")
                conn.commit()
            print(f"  [OK]   约束 {FK_NAME} 添加成功。")

        # 验证
        with conn.cursor() as cur:
            cur.execute(
                """SELECT conname, conrelid::regclass, confrelid::regclass
                   FROM pg_constraint WHERE conname = %s""", (FK_NAME,))
            row = cur.fetchone()
        print(f"\n  当前约束: {row[0]} ({row[1]} → {row[2]})")

        # 同时确认 expression_fact FK
        with conn.cursor() as cur:
            cur.execute(
                """SELECT conname, conrelid::regclass, confrelid::regclass
                   FROM pg_constraint
                   WHERE contype = 'f'
                     AND conrelid::regclass::text IN ('expression_fact','dataset_sample')""")
            fks = cur.fetchall()
        print(f"\n[==] 全部 FK 约束 ({len(fks)} 个) [==]")
        for name, tbl, ref in sorted(fks, key=lambda x: x[1]):
            print(f"  {tbl} → {ref} ({name})")

    finally:
        conn.close()
    print("\n[OK] Step 11 完成")


if __name__ == "__main__":
    sys.exit(main())
