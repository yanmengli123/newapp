#!/usr/bin/env bash
set -euo pipefail

# Gold-standard GRCg6a vs GRCg7b comparative data builder.
#
# This script is intentionally conservative:
# - lightweight primary PAF remains the interactive JBrowse2 layer
# - --cs=long PAF is compressed/indexed for local block details only
# - target-space projection is indexed separately because PAF is query-first
# - MUMmer4 QC is intentionally not generated here

DATA_ROOT="${DATA_ROOT:-/mnt/d/jbrowsedata/projectdata}"
OUT_ROOT="${OUT_ROOT:-${DATA_ROOT}/comparative}"
PAIR_ROOT="${OUT_ROOT}/pairwise/GRCg6a__GRCg7b"
DNA_ROOT="${PAIR_ROOT}/dna_alignment"
TMP_ROOT="${TMP_ROOT:-${OUT_ROOT}/tmp}"

QUERY_FASTA="${QUERY_FASTA:-${DATA_ROOT}/GCF_000002315.6_GRCg6a_primary_35.fna}"
TARGET_FASTA="${TARGET_FASTA:-${DATA_ROOT}/GCF_016699485.2_GRCg7b_primary_42.fna}"
QUERY_FULL_FASTA="${QUERY_FULL_FASTA:-${DATA_ROOT}/GCF_000002315.6_GRCg6a_genomic.chr.fna}"
TARGET_EXTRA_FASTA="${TARGET_EXTRA_FASTA:-${DATA_ROOT}/GCF_016699485.2_GRCg7b_extra_7.fna}"
THREADS="${THREADS:-24}"
MINIMAP_BATCH_SIZE="${MINIMAP_BATCH_SIZE:-2G}"

CLEAN_PAF="${DNA_ROOT}/GRCg6a_to_GRCg7b.primary.asm5.clean.paf"
ALL_PAF="${DNA_ROOT}/GRCg6a_to_GRCg7b.primary.asm5.all.paf"
MICRO_PAF="${DNA_ROOT}/GRCg7b_extra_micro_to_GRCg6a_full.asm10.evidence.paf"
PRIMARY_PAF="${DNA_ROOT}/primary.asm5.paf"
CS_PAF="${DNA_ROOT}/primary.asm5.cs.paf"
CS_PAF_GZ="${CS_PAF}.gz"
TARGET_TSV="${DNA_ROOT}/primary.asm5.cs.target.tsv"
TARGET_TSV_GZ="${TARGET_TSV}.gz"
CLEAN_PIF="${DNA_ROOT}/GRCg6a_to_GRCg7b.primary.asm5.clean.pif.gz"
ALL_PIF="${DNA_ROOT}/GRCg6a_to_GRCg7b.primary.asm5.all.pif.gz"
MICRO_PIF="${DNA_ROOT}/GRCg7b_extra_micro_to_GRCg6a_full.asm10.evidence.pif.gz"
PROVENANCE="${DNA_ROOT}/provenance.json"
STATS="${DNA_ROOT}/input_fasta.seqkit_stats.tsv"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: required tool not found in PATH: $1" >&2
    exit 127
  fi
}

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.argv[1])[1:-1])' "$1"
}

tool_version() {
  local text
  text="$("$1" --version 2>&1 || true)"
  text="${text%%$'\n'*}"
  if [[ -n "${text}" && "${text}" != Error:* && "${text}" != *"unknown flag"* ]]; then
    echo "${text}"
    return 0
  fi
  text="$("$1" version 2>&1 || true)"
  text="${text%%$'\n'*}"
  echo "${text}"
}

file_sha256() {
  if [[ -s "$1" ]]; then
    sha256sum "$1" | awk '{print $1}'
  else
    echo ""
  fi
}

require_tool minimap2
require_tool seqkit
require_tool bgzip
require_tool tabix

mkdir -p "${DNA_ROOT}" "${TMP_ROOT}"
export TMPDIR="${TMP_ROOT}"

seqkit stats -T "${QUERY_FASTA}" "${TARGET_FASTA}" "${QUERY_FULL_FASTA}" "${TARGET_EXTRA_FASTA}" > "${STATS}"

if [[ ! -s "${CLEAN_PAF}" ]]; then
  minimap2 -cx asm5 --secondary=no --cs=long -K "${MINIMAP_BATCH_SIZE}" -t "${THREADS}" \
    "${TARGET_FASTA}" \
    "${QUERY_FASTA}" \
    > "${CLEAN_PAF}"
fi

cp "${CLEAN_PAF}" "${PRIMARY_PAF}"

if [[ ! -s "${ALL_PAF}" ]]; then
  minimap2 -cx asm5 --cs=long -K "${MINIMAP_BATCH_SIZE}" -t "${THREADS}" \
    "${TARGET_FASTA}" \
    "${QUERY_FASTA}" \
    > "${ALL_PAF}"
fi

if [[ -s "${TARGET_EXTRA_FASTA}" && ! -s "${MICRO_PAF}" ]]; then
  minimap2 -cx asm10 --cs=long -K "${MINIMAP_BATCH_SIZE}" -t "${THREADS}" \
    "${QUERY_FULL_FASTA}" \
    "${TARGET_EXTRA_FASTA}" \
    > "${MICRO_PAF}"
fi

make_pif_if_possible() {
  local paf="$1"
  local pif="$2"
  if [[ ! -s "${paf}" || -s "${pif}" ]]; then
    return 0
  fi
  if command -v jbrowse >/dev/null 2>&1; then
    jbrowse make-pif "${paf}" --out "${pif}"
  else
    echo "WARN: jbrowse CLI not found; skipping PIF generation for ${paf}" >&2
  fi
}

make_pif_if_possible "${CLEAN_PAF}" "${CLEAN_PIF}"
make_pif_if_possible "${ALL_PAF}" "${ALL_PIF}"
make_pif_if_possible "${MICRO_PAF}" "${MICRO_PIF}"

REBUILD_CS=0
if [[ ! -s "${CS_PAF_GZ}" || "${CLEAN_PAF}" -nt "${CS_PAF_GZ}" ]]; then
  REBUILD_CS=1
fi

if [[ "${REBUILD_CS}" -eq 1 ]]; then
  rm -f "${CS_PAF_GZ}" "${CS_PAF_GZ}.tbi" "${TARGET_TSV_GZ}" "${TARGET_TSV_GZ}.tbi"
  cp "${CLEAN_PAF}" "${CS_PAF}"

  # PAF coordinates are 0-based half-open; tabix needs -0 for this convention.
  sort -T "${TMP_ROOT}" -k1,1 -k3,3n -k4,4n "${CS_PAF}" | bgzip -c > "${CS_PAF_GZ}"

  # Build a target-coordinate projection for fast GRCg7b-side queries.
  # Columns 1-3 are target ref/start/end; the remaining columns preserve the full PAF.
  awk 'BEGIN{OFS="\t"} !/^#/ && NF>=12 {print $6,$8,$9,$0}' "${CS_PAF}" \
    | sort -T "${TMP_ROOT}" -k1,1 -k2,2n -k3,3n \
    | bgzip -c > "${TARGET_TSV_GZ}"
fi

if [[ -s "${CS_PAF_GZ}" && ! -s "${CS_PAF_GZ}.tbi" ]]; then
  tabix -f -0 -s 1 -b 3 -e 4 "${CS_PAF_GZ}"
fi

if [[ ! -s "${TARGET_TSV_GZ}" || "${CS_PAF}" -nt "${TARGET_TSV_GZ}" ]]; then
  rm -f "${TARGET_TSV_GZ}" "${TARGET_TSV_GZ}.tbi"
  if [[ ! -s "${CS_PAF}" ]]; then
    echo "ERROR: cannot build target projection without ${CS_PAF}" >&2
    exit 1
  fi
  awk 'BEGIN{OFS="\t"} !/^#/ && NF>=12 {print $6,$8,$9,$0}' "${CS_PAF}" \
    | sort -T "${TMP_ROOT}" -k1,1 -k2,2n -k3,3n \
    | bgzip -c > "${TARGET_TSV_GZ}"
fi

if [[ -s "${TARGET_TSV_GZ}" && ! -s "${TARGET_TSV_GZ}.tbi" ]]; then
  tabix -f -0 -s 1 -b 2 -e 3 "${TARGET_TSV_GZ}"
fi

MINIMAP2_VERSION="$(tool_version minimap2)"
SEQKIT_VERSION="$(tool_version seqkit)"
BGZIP_VERSION="$(tool_version bgzip)"
TABIX_VERSION="$(tool_version tabix)"
GIT_COMMIT="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
QUERY_SHA256="$(file_sha256 "${QUERY_FASTA}")"
TARGET_SHA256="$(file_sha256 "${TARGET_FASTA}")"
PRIMARY_SHA256="$(file_sha256 "${PRIMARY_PAF}")"
CLEAN_SHA256="$(file_sha256 "${CLEAN_PAF}")"
ALL_SHA256="$(file_sha256 "${ALL_PAF}")"
MICRO_SHA256="$(file_sha256 "${MICRO_PAF}")"
CLEAN_PIF_SHA256="$(file_sha256 "${CLEAN_PIF}")"
ALL_PIF_SHA256="$(file_sha256 "${ALL_PIF}")"
MICRO_PIF_SHA256="$(file_sha256 "${MICRO_PIF}")"
CS_SHA256="$(file_sha256 "${CS_PAF_GZ}")"
TARGET_PROJECTION_SHA256="$(file_sha256 "${TARGET_TSV_GZ}")"

cat > "${PROVENANCE}" <<JSON
{
  "dataset": "GRCg6a_vs_GRCg7b_gold_standard_dna_alignment",
  "assembly_1": "GRCg6a",
  "assembly_2": "GRCg7b",
  "query_fasta": "${QUERY_FASTA}",
  "target_fasta": "${TARGET_FASTA}",
  "query_full_fasta": "${QUERY_FULL_FASTA}",
  "target_extra_fasta": "${TARGET_EXTRA_FASTA}",
  "primary_paf": "${PRIMARY_PAF}",
  "clean_primary_paf": "${CLEAN_PAF}",
  "all_primary_paf": "${ALL_PAF}",
  "microchromosome_evidence_paf": "${MICRO_PAF}",
  "clean_primary_pif_gz": "${CLEAN_PIF}",
  "all_primary_pif_gz": "${ALL_PIF}",
  "microchromosome_evidence_pif_gz": "${MICRO_PIF}",
  "base_level_cs_paf_gz": "${CS_PAF_GZ}",
  "target_projection_gz": "${TARGET_TSV_GZ}",
  "tool": "minimap2",
  "preset": "asm5",
  "minimap_batch_size": "${MINIMAP_BATCH_SIZE}",
  "tool_versions": {
    "minimap2": "$(json_escape "${MINIMAP2_VERSION}")",
    "seqkit": "$(json_escape "${SEQKIT_VERSION}")",
    "bgzip": "$(json_escape "${BGZIP_VERSION}")",
    "tabix": "$(json_escape "${TABIX_VERSION}")"
  },
  "clean_primary_command_line": "minimap2 -cx asm5 --secondary=no --cs=long -K ${MINIMAP_BATCH_SIZE} -t ${THREADS} ${TARGET_FASTA} ${QUERY_FASTA}",
  "all_primary_command_line": "minimap2 -cx asm5 --cs=long -K ${MINIMAP_BATCH_SIZE} -t ${THREADS} ${TARGET_FASTA} ${QUERY_FASTA}",
  "microchromosome_evidence_command_line": "minimap2 -cx asm10 --cs=long -K ${MINIMAP_BATCH_SIZE} -t ${THREADS} ${QUERY_FULL_FASTA} ${TARGET_EXTRA_FASTA}",
  "base_level_command_line": "derived from clean_primary_paf and indexed by query and target projections",
  "git_commit": "${GIT_COMMIT}",
  "query_fasta_sha256": "${QUERY_SHA256}",
  "target_fasta_sha256": "${TARGET_SHA256}",
  "primary_paf_sha256": "${PRIMARY_SHA256}",
  "clean_primary_paf_sha256": "${CLEAN_SHA256}",
  "all_primary_paf_sha256": "${ALL_SHA256}",
  "microchromosome_evidence_paf_sha256": "${MICRO_SHA256}",
  "clean_primary_pif_gz_sha256": "${CLEAN_PIF_SHA256}",
  "all_primary_pif_gz_sha256": "${ALL_PIF_SHA256}",
  "microchromosome_evidence_pif_gz_sha256": "${MICRO_PIF_SHA256}",
  "base_level_cs_paf_gz_sha256": "${CS_SHA256}",
  "target_projection_gz_sha256": "${TARGET_PROJECTION_SHA256}",
  "secondary_alignments": {
    "clean_primary": "disabled",
    "all_primary": "enabled",
    "microchromosome_evidence": "enabled"
  },
  "base_level": "cs:long",
  "mummer4_qc": "not_generated",
  "coordinate_system": "PAF 0-based half-open; tabix indexes use -0",
  "temporary_directory": "${TMP_ROOT}",
  "storage_policy": "All large outputs and sort temporary files are under DATA_ROOT/OUT_ROOT, not the app source tree.",
  "intended_use": "Clean primary PAF/PIF for default ribbons and dotplot; all-primary PAF/PIF for review; micro evidence PAF/PIF for GRCg7b-only molecules; cs/indexed PAF for clicked-block details only",
  "generated_at": "$(date -Iseconds)"
}
JSON

echo "Gold-standard DNA alignment files are ready under ${DNA_ROOT}"
