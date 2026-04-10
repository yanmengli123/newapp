-- V002: Add dataset_alias table for dataset code aliases
-- This table maps deprecated/alias dataset codes to their canonical forms.
-- Example: 'raw_ballgown_36' -> 'esc_srr_23'
-- Idempotent: skips if table already exists.

CREATE TABLE IF NOT EXISTS dataset_alias (
    alias_code      TEXT NOT NULL PRIMARY KEY,
    canonical_code  TEXT NOT NULL,
    description     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Index for canonical lookup
CREATE INDEX IF NOT EXISTS idx_dataset_alias_canonical ON dataset_alias(canonical_code);

-- Known aliases (add more as needed)
-- raw_ballgown_36 is a deprecated alias for esc_srr_23
INSERT INTO dataset_alias (alias_code, canonical_code, description)
VALUES ('raw_ballgown_36', 'esc_srr_23', 'Deprecated alias: raw_ballgown_36 -> esc_srr_23')
ON CONFLICT (alias_code) DO NOTHING;
