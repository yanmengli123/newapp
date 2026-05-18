-- V002: Add dataset_alias table for dataset code aliases
-- This table maps deprecated/alias dataset codes to their canonical forms.
-- Currently empty after 2026-05-18 expression data update.
-- Idempotent: skips if table already exists.

CREATE TABLE IF NOT EXISTS dataset_alias (
    alias_code      TEXT NOT NULL PRIMARY KEY,
    canonical_code  TEXT NOT NULL,
    description     TEXT,
    is_deprecated   BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Index for canonical lookup
CREATE INDEX IF NOT EXISTS idx_dataset_alias_canonical ON dataset_alias(canonical_code);

-- No aliases currently active (2026-05-18 update removed stale aliases)
