-- V004: Add provenance fields to gene_go table
-- Supports multi-source GO annotations (NCBI gene2go, Ensembl BioMart, GAF)

ALTER TABLE gene_go ADD COLUMN IF NOT EXISTS qualifier TEXT;
ALTER TABLE gene_go ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE gene_go ADD COLUMN IF NOT EXISTS pubmed_ids TEXT;
ALTER TABLE gene_go ADD COLUMN IF NOT EXISTS assigned_by TEXT;
ALTER TABLE gene_go ADD COLUMN IF NOT EXISTS aspect TEXT;
ALTER TABLE gene_go ADD COLUMN IF NOT EXISTS source_gene_id TEXT;

-- Add index for provenance queries
CREATE INDEX IF NOT EXISTS idx_gene_go_source ON gene_go(source);
CREATE INDEX IF NOT EXISTS idx_gene_go_evidence ON gene_go(evidence_code);

-- Add comment
COMMENT ON COLUMN gene_go.qualifier IS 'Qualifier: enables/involved_in/located_in';
COMMENT ON COLUMN gene_go.reference IS 'Reference source (e.g., PMID:12345)';
COMMENT ON COLUMN gene_go.pubmed_ids IS 'PubMed IDs (comma-separated)';
COMMENT ON COLUMN gene_go.assigned_by IS 'Annotation source (e.g., RefSeq, Ensembl)';
COMMENT ON COLUMN gene_go.aspect IS 'GO aspect: F (function), P (process), C (component)';
COMMENT ON COLUMN gene_go.source_gene_id IS 'Original gene ID from source (e.g., NCBI GeneID)';
