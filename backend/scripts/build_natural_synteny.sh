#!/usr/bin/env bash
set -euo pipefail

DATA_ROOT="${GRCG6A_BASE_DIR_WSL:-/mnt/d/jbrowsedata/projectdata}"
THREADS="${SYNTENY_THREADS:-24}"
BASE_LEVEL_CIGAR="${SYNTENY_BASE_LEVEL_CIGAR:-0}"

QUERY_FASTA="${DATA_ROOT}/synteny/grcg6a_chromosomes.fna"
TARGET_FASTA="${DATA_ROOT}/synteny/grcg7b_chromosomes.fna"
OUT_DIR="${DATA_ROOT}/synteny/natural"
PAF="${OUT_DIR}/grcg6a_vs_grcg7b.natural.asm5.paf"
TMP_PAF="${PAF}.tmp"
LOG="${OUT_DIR}/grcg6a_vs_grcg7b.natural.asm5.minimap2.log"
TMP_LOG="${LOG}.tmp"
PROVENANCE="${OUT_DIR}/grcg6a_vs_grcg7b.natural.asm5.provenance.json"
TMP_PROVENANCE="${PROVENANCE}.tmp"
STATS="${OUT_DIR}/input_fasta.seqkit_stats.tsv"

mkdir -p "${OUT_DIR}"
rm -f "${TMP_PAF}"

seqkit stats -T "${QUERY_FASTA}" "${TARGET_FASTA}" > "${STATS}"

MINIMAP2_ARGS=(-x asm5 --secondary=no -t "${THREADS}")
if [[ "${BASE_LEVEL_CIGAR}" == "1" || "${BASE_LEVEL_CIGAR}" == "true" ]]; then
  MINIMAP2_ARGS=(-x asm5 -c --secondary=no -t "${THREADS}")
fi

{
  echo "Command: minimap2 ${MINIMAP2_ARGS[*]} ${TARGET_FASTA} ${QUERY_FASTA}"
  echo "Started: $(date -Iseconds)"
} > "${TMP_LOG}"

/usr/bin/time -v minimap2 "${MINIMAP2_ARGS[@]}" "${TARGET_FASTA}" "${QUERY_FASTA}" > "${TMP_PAF}" 2>> "${TMP_LOG}"
mv "${TMP_PAF}" "${PAF}"

{
  echo "Finished: $(date -Iseconds)"
  printf "PAF lines: "
  wc -l < "${PAF}"
} >> "${TMP_LOG}"

cat > "${TMP_PROVENANCE}" <<JSON
{
  "dataset": "GRCg6a_vs_GRCg7b_natural_synteny",
  "assembly_1": "GRCg6a",
  "assembly_2": "GRCg7b",
  "query_fasta": "${QUERY_FASTA}",
  "target_fasta": "${TARGET_FASTA}",
  "output_paf": "${PAF}",
  "input_stats": "${STATS}",
  "log": "${LOG}",
  "tool": "minimap2",
  "preset": "asm5",
  "base_level_cigar": $([[ "${BASE_LEVEL_CIGAR}" == "1" || "${BASE_LEVEL_CIGAR}" == "true" ]] && echo true || echo false),
  "secondary_alignments": "disabled",
  "threads": ${THREADS},
  "default_display_filters": {
    "mapping_quality_min": 30,
    "identity_min_percent": 85,
    "alignment_length_min_bp": 50000
  },
  "coordinate_system": "PAF 0-based half-open coordinates; UI displays 1-based inclusive labels where stated",
  "generated_at": "$(date -Iseconds)",
  "intended_use": "Primary natural-breakpoint whole-genome synteny for /comparative and JBrowse2 LinearSyntenyView"
}
JSON

mv "${TMP_LOG}" "${LOG}"
mv "${TMP_PROVENANCE}" "${PROVENANCE}"

ls -lh "${PAF}" "${PROVENANCE}" "${LOG}" "${STATS}"
