-- V010: Keep GO enrichment annotations BioMart-only for the GRCg6a project.
--
-- The GRCg7b RefSeq GAF import was useful as a supplemental experiment, but
-- /go-enrichment now intentionally uses only the GRCg6a-aligned BioMart source
-- to avoid mixing assembly-derived annotation sources.

DELETE FROM gene_go
WHERE source = 'ncbi_gaf_gcf_016699485.2';
