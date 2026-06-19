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
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.argv[1])[1:-1])' "$1"
}

tool_version() {
  "$1" --version 2>&1 | head -n 1 || true
}

file_sha256() {
  if [[ -s "$1" ]]; then
    sha256sum "$1" | awk '{print $1}'
  else
    echo ""
  fi
}

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

MINIMAP2_VERSION="$(tool_version minimap2)"
SEQKIT_VERSION="$(tool_version seqkit)"
GIT_COMMIT="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
QUERY_SHA256="$(file_sha256 "${QUERY_FASTA}")"
TARGET_SHA256="$(file_sha256 "${TARGET_FASTA}")"
PAF_SHA256="$(file_sha256 "${PAF}")"

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
  "tool_versions": {
    "minimap2": "$(json_escape "${MINIMAP2_VERSION}")",
    "seqkit": "$(json_escape "${SEQKIT_VERSION}")"
  },
  "command_line": "minimap2 ${MINIMAP2_ARGS[*]} ${TARGET_FASTA} ${QUERY_FASTA}",
  "git_commit": "${GIT_COMMIT}",
  "query_fasta_sha256": "${QUERY_SHA256}",
  "target_fasta_sha256": "${TARGET_SHA256}",
  "output_paf_sha256": "${PAF_SHA256}",
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
