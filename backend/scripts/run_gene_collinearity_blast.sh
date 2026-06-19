#!/usr/bin/env bash
set -euo pipefail

DATA_ROOT="${DATA_ROOT:-/mnt/d/jbrowsedata/projectdata}"
PAIR_ROOT="${DATA_ROOT}/comparative/pairwise/GRCg6a__GRCg7b"
GENE_ROOT="${PAIR_ROOT}/gene_collinearity"
THREADS="${THREADS:-8}"
USE_DIAMOND="${USE_DIAMOND:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --use-diamond)
      USE_DIAMOND=1
      shift
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

G6_PROTEIN="${GENE_ROOT}/GRCg6a.protein.canonical.faa"
G7_PROTEIN="${GENE_ROOT}/GRCg7b.protein.canonical.faa"
DB_ROOT="${GENE_ROOT}/blastdb"
BLAST_ROOT="${GENE_ROOT}/blast"
LOG_ROOT="${BLAST_ROOT}/logs"
PROVENANCE="${BLAST_ROOT}/provenance.json"

mkdir -p "${DB_ROOT}" "${BLAST_ROOT}" "${LOG_ROOT}"

OUTFMT="6 qseqid sseqid pident length mismatch gapopen qstart qend sstart send evalue bitscore qcovs"
ALIGNER="blastp"

if [[ "${USE_DIAMOND}" == "1" || "${USE_DIAMOND}" == "true" ]]; then
  ALIGNER="diamond"
  diamond makedb --in "${G7_PROTEIN}" --db "${DB_ROOT}/GRCg7b.protein" > "${LOG_ROOT}/diamond.makedb.GRCg7b.log"
  diamond makedb --in "${G6_PROTEIN}" --db "${DB_ROOT}/GRCg6a.protein" > "${LOG_ROOT}/diamond.makedb.GRCg6a.log"

  diamond blastp \
    --query "${G6_PROTEIN}" \
    --db "${DB_ROOT}/GRCg7b.protein" \
    --evalue 1e-5 \
    --max-target-seqs 5 \
    --threads "${THREADS}" \
    --outfmt ${OUTFMT} \
    --out "${BLAST_ROOT}/GRCg6a_vs_GRCg7b.blastp.tsv"

  diamond blastp \
    --query "${G7_PROTEIN}" \
    --db "${DB_ROOT}/GRCg6a.protein" \
    --evalue 1e-5 \
    --max-target-seqs 5 \
    --threads "${THREADS}" \
    --outfmt ${OUTFMT} \
    --out "${BLAST_ROOT}/GRCg7b_vs_GRCg6a.blastp.tsv"
else
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
fi

wc -l "${BLAST_ROOT}"/*.blastp.tsv
cat > "${PROVENANCE}" <<JSON
{
  "dataset": "GRCg6a_vs_GRCg7b_gene_collinearity_similarity",
  "aligner": "${ALIGNER}",
  "use_diamond": $([[ "${ALIGNER}" == "diamond" ]] && echo true || echo false),
  "threads": ${THREADS},
  "outfmt": "${OUTFMT}",
  "forward_hits": "${BLAST_ROOT}/GRCg6a_vs_GRCg7b.blastp.tsv",
  "reverse_hits": "${BLAST_ROOT}/GRCg7b_vs_GRCg6a.blastp.tsv",
  "generated_at": "$(date -Iseconds)"
}
JSON
echo "${ALIGNER} files are ready under ${BLAST_ROOT}"
