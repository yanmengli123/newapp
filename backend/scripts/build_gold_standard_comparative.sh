#!/usr/bin/env bash
set -euo pipefail

# Gold-standard GRCg6a vs GRCg7b comparative data builder.
#
# This script is intentionally conservative:
# - lightweight primary PAF remains the interactive JBrowse2 layer
# - --cs=long PAF is compressed/indexed for local block details only
# - target-space projection is indexed separately because PAF is query-first

DATA_ROOT="${DATA_ROOT:-/mnt/d/jbrowsedata/projectdata}"
OUT_ROOT="${OUT_ROOT:-${DATA_ROOT}/comparative}"
PAIR_ROOT="${OUT_ROOT}/pairwise/GRCg6a__GRCg7b"
DNA_ROOT="${PAIR_ROOT}/dna_alignment"
TMP_ROOT="${TMP_ROOT:-${OUT_ROOT}/tmp}"

QUERY_FASTA="${QUERY_FASTA:-${DATA_ROOT}/GCF_000002315.6_GRCg6a_genomic.chr.fna}"
TARGET_FASTA="${TARGET_FASTA:-${DATA_ROOT}/GCF_016699485.2_GRCg7b_main_chr.fna}"
THREADS="${THREADS:-24}"

PRIMARY_PAF="${DNA_ROOT}/primary.asm5.paf"
CS_PAF="${DNA_ROOT}/primary.asm5.cs.paf"
CS_PAF_GZ="${CS_PAF}.gz"
TARGET_TSV="${DNA_ROOT}/primary.asm5.cs.target.tsv"
TARGET_TSV_GZ="${TARGET_TSV}.gz"
PROVENANCE="${DNA_ROOT}/provenance.json"
STATS="${DNA_ROOT}/input_fasta.seqkit_stats.tsv"

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: required tool not found in PATH: $1" >&2
    exit 127
  fi
}

require_tool minimap2
require_tool seqkit
require_tool bgzip
require_tool tabix

mkdir -p "${DNA_ROOT}" "${TMP_ROOT}"
export TMPDIR="${TMP_ROOT}"

seqkit stats -T "${QUERY_FASTA}" "${TARGET_FASTA}" > "${STATS}"

if [[ ! -s "${PRIMARY_PAF}" ]]; then
  minimap2 -x asm5 --secondary=no -t "${THREADS}" \
    "${TARGET_FASTA}" \
    "${QUERY_FASTA}" \
    > "${PRIMARY_PAF}"
fi

if [[ ! -s "${CS_PAF_GZ}" ]]; then
  minimap2 -x asm5 --cs=long --secondary=no -t "${THREADS}" \
    "${TARGET_FASTA}" \
    "${QUERY_FASTA}" \
    > "${CS_PAF}"

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

if [[ ! -s "${TARGET_TSV_GZ}" ]]; then
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

cat > "${PROVENANCE}" <<JSON
{
  "dataset": "GRCg6a_vs_GRCg7b_gold_standard_dna_alignment",
  "assembly_1": "GRCg6a",
  "assembly_2": "GRCg7b",
  "query_fasta": "${QUERY_FASTA}",
  "target_fasta": "${TARGET_FASTA}",
  "primary_paf": "${PRIMARY_PAF}",
  "base_level_cs_paf_gz": "${CS_PAF_GZ}",
  "target_projection_gz": "${TARGET_TSV_GZ}",
  "tool": "minimap2",
  "preset": "asm5",
  "secondary_alignments": "disabled",
  "base_level": "cs:long",
  "coordinate_system": "PAF 0-based half-open; tabix indexes use -0",
  "temporary_directory": "${TMP_ROOT}",
  "storage_policy": "All large outputs and sort temporary files are under DATA_ROOT/OUT_ROOT, not the app source tree.",
  "intended_use": "Primary PAF for ribbons; cs PAF for clicked-block details only"
}
JSON

echo "Gold-standard DNA alignment files are ready under ${DNA_ROOT}"
