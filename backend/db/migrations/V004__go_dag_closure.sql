-- V004__go_dag_closure.sql
-- GO DAG closure tables for annotation_mode=propagated support
-- Build with: python -m backend.scripts.load_go_dag --replace

BEGIN;

-- 原始父子边（保留原始 DAG 结构，方便调试和未来可视化扩展）
CREATE TABLE IF NOT EXISTS go_edge (
    child_go_id  TEXT NOT NULL,
    parent_go_id TEXT NOT NULL,
    relation     TEXT NOT NULL CHECK (relation IN ('is_a', 'part_of')),
    PRIMARY KEY (child_go_id, parent_go_id, relation)
);

-- 传递闭包（SEA 真正使用的表；distance=0 包含 self-row，propagated 天然包含 direct）
CREATE TABLE IF NOT EXISTS go_closure (
    descendant_go_id TEXT NOT NULL,
    ancestor_go_id  TEXT NOT NULL,
    distance        INT NOT NULL CHECK (distance >= 0),
    PRIMARY KEY (descendant_go_id, ancestor_go_id)
);

-- GO alt_id 映射（loader 解析 alt_id 入库，gene_go 中可能出现 alt_id）
CREATE TABLE IF NOT EXISTS go_alt_id (
    alt_go_id     TEXT PRIMARY KEY,
    primary_go_id TEXT NOT NULL
);

-- OBO 文件元数据（记录版本、构建时间、参数，保证结果可复现）
CREATE TABLE IF NOT EXISTS go_dag_metadata (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 索引（加速 SEA 查询）
CREATE INDEX IF NOT EXISTS idx_go_edge_parent   ON go_edge(parent_go_id);
CREATE INDEX IF NOT EXISTS idx_go_edge_relation ON go_edge(relation);
CREATE INDEX IF NOT EXISTS idx_go_closure_ancestor     ON go_closure(ancestor_go_id);
CREATE INDEX IF NOT EXISTS idx_go_closure_descendant   ON go_closure(descendant_go_id);
CREATE INDEX IF NOT EXISTS idx_go_alt_id_primary      ON go_alt_id(primary_go_id);

COMMIT;
