-- KEGG Pathway 增强表：资产元数据 + 节点坐标 + 节点-基因映射
-- 用法: sqlite3 grcg6a_nc.db < scripts/kegg_schema.sql

-- ================================================================
-- 表1: 通路资产表
-- 存储 PNG/KGML 文件元数据、宽高、统计信息
-- ================================================================
CREATE TABLE IF NOT EXISTS kegg_pathway_asset (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    pathway_id      TEXT    NOT NULL UNIQUE,
    pathway_name    TEXT,
    pathway_class   TEXT,
    -- PNG 资产
    png_filename    TEXT,
    png_relpath     TEXT,
    png_url         TEXT,
    png_file_size   INTEGER DEFAULT 0,
    png_width       INTEGER DEFAULT 0,
    png_height      INTEGER DEFAULT 0,
    -- KGML 资产
    kgml_filename   TEXT,
    kgml_relpath    TEXT,
    kgml_file_size  INTEGER DEFAULT 0,
    -- KGML 解析统计
    node_count      INTEGER DEFAULT 0,
    gene_count      INTEGER DEFAULT 0,
    -- 时间戳
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_asset_pathway_id ON kegg_pathway_asset(pathway_id);

-- ================================================================
-- 表2: 通路节点表
-- 存储 KGML 解析后的所有可点击矩形框
-- ================================================================
CREATE TABLE IF NOT EXISTS kegg_pathway_node (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    pathway_id      TEXT    NOT NULL,
    entry_id        TEXT    NOT NULL,
    entry_type      TEXT,                -- 'gene' / 'compound' 等
    entry_name      TEXT,                -- graphics/@name 原始值
    graphics_type   TEXT,                -- 'rectangle' / 'line' / 'circle' 等
    -- KGML 中心点坐标
    x               INTEGER,
    y               INTEGER,
    width           INTEGER DEFAULT 0,
    height          INTEGER DEFAULT 0,
    -- 前端可直接用的坐标
    left_x          INTEGER,
    top_y           INTEGER,
    right_x         INTEGER,
    bottom_y        INTEGER,
    -- 原始 names（逗号分隔）
    raw_names       TEXT,
    -- 点击链接
    link_url        TEXT,
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(pathway_id, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_node_pathway ON kegg_pathway_node(pathway_id);
CREATE INDEX IF NOT EXISTS idx_node_entry_id ON kegg_pathway_node(entry_id);
CREATE INDEX IF NOT EXISTS idx_node_graphics ON kegg_pathway_node(graphics_type);

-- ================================================================
-- 表3: 通路节点-基因映射表
-- 一个节点可能包含多个 KEGG gene id
-- ================================================================
CREATE TABLE IF NOT EXISTS kegg_pathway_node_gene (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    pathway_id      TEXT    NOT NULL,
    node_id         INTEGER NOT NULL,
    kegg_gene_id    TEXT    NOT NULL,   -- 格式: gga:418223
    gene_symbol     TEXT,               -- 可选，从 gene_xref 反查
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(node_id, kegg_gene_id)
);

CREATE INDEX IF NOT EXISTS idx_node_gene_node ON kegg_pathway_node_gene(node_id);
CREATE INDEX IF NOT EXISTS idx_node_gene_kegg ON kegg_pathway_node_gene(kegg_gene_id);
CREATE INDEX IF NOT EXISTS idx_node_gene_pathway ON kegg_pathway_node_gene(pathway_id);
