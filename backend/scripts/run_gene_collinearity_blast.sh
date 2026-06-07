#!/usr/bin/env bash
set -euo pipefail

DATA_ROOT="${DATA_ROOT:-/mnt/d/jbrowsedata/projectdata}"
PAIR_ROOT="${DATA_ROOT}/comparative/pairwise/GRCg6a__GRCg7b"
GENE_ROOT="${PAIR_ROOT}/gene_collinearity"
THREADS="${THREADS:-8}"

G6_PROTEIN="${GENE_ROOT}/GRCg6a.protein.canonical.faa"
G7_PROTEIN="${GENE_ROOT}/GRCg7b.protein.canonical.faa"
DB_ROOT="${GENE_ROOT}/blastdb"
BLAST_ROOT="${GENE_ROOT}/blast"
LOG_ROOT="${BLAST_ROOT}/logs"

mkdir -p "${DB_ROOT}" "${BLAST_ROOT}" "${LOG_ROOT}"

makeblastdb \
  -in "${G7_PROTEIN}" \
  -dbtype prot \
  -parse_seqids \
  -out "${DB_ROOT}/GRCg7b.protein" \
  > "${LOG_ROOT}/makeblastdb.GRCg7b.log"

makeblastdb \
  -in "${G6_PROTEIN}" \
  -dbtype prot \
  -parse_seqids \
  -out "${DB_ROOT}/GRCg6a.protein" \
  > "${LOG_ROOT}/makeblastdb.GRCg6a.log"

OUTFMT="6 qseqid sseqid pident length mismatch gapopen qstart qend sstart send evalue bitscore qcovs"

blastp \
  -query "${G6_PROTEIN}" \
  -db "${DB_ROOT}/GRCg7b.protein" \
  -evalue 1e-5 \
  -max_target_seqs 5 \
  -max_hsps 1 \
  -num_threads "${THREADS}" \
  -outfmt "${OUTFMT}" \
  -out "${BLAST_ROOT}/GRCg6a_vs_GRCg7b.blastp.tsv"

blastp \
  -query "${G7_PROTEIN}" \
  -db "${DB_ROOT}/GRCg6a.protein" \
  -evalue 1e-5 \
  -max_target_seqs 5 \
  -max_hsps 1 \
  -num_threads "${THREADS}" \
  -outfmt "${OUTFMT}" \
  -out "${BLAST_ROOT}/GRCg7b_vs_GRCg6a.blastp.tsv"

wc -l "${BLAST_ROOT}"/*.blastp.tsv
echo "BLASTP files are ready under ${BLAST_ROOT}"
