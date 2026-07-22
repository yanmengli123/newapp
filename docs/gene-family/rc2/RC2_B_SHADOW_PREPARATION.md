# RC2-B shadow-preparation execution record

## Decision state

Engineering preparation is implemented and testable. Formal scientific shadow
runs, RC2 database construction, API switching, page-metric changes and any
accepted/candidate reclassification remain **NO-GO**.

The frozen evaluator core is tagged as
`gene-family-rc2b-evaluator-core-v1.0`. The tag denotes compiler and tri-state
evaluation infrastructure only; it does not imply biological approval or
shadow readiness.

## Read-only curator packet

The create-only packet `analysis/rc2b-curator-packet-v1.1` was generated outside
the repository from the immutable RC1 baseline by generator commit
`8cf97191e3edede4c06681ac0000331ffe46db7f`. It supersedes the engineering
templates in v1 without overwriting that packet. Its manifest and detached
checksums record:

- 20 reconciled source files;
- RC1 SQLite SHA-256
  `b590a0bfd9d81b41bbf044eb7daba08f241c9a959362d59f06de8142ac84ad97`;
- 1,294 ubiquitin-core records: 387 accepted and 907 candidate;
- four accepted mapping exceptions;
- two cross-table mapping mismatches;
- 46,611 protein subjects, of which 46,594 have recorded hits;
- 118,957 hits whose threshold-pass state is unknown;
- 8,045 Pfam model accessions/versions in the legacy inventory.

All 22 manifest-listed packet artifacts pass SHA-256 verification, and no
packet artifact contains a machine-local absolute path. The v1.1 decision area
adds schema-aligned publication-policy and evidence-admissibility templates,
the frozen artifact-hash algorithm, and all 19 registered diagnostic-code
proposals.

Machine proposals and curator decisions are separate directories. Decision
templates are empty, reference proposal and evidence hashes, and do not claim
approval. Packet generation refuses overwrite and validates all source hashes
before creating output.

## Engineering contracts

The RC2-B package defines strict JSON Schema Draft 2020-12 contracts for:

- Pfam/HMMER scan, threshold and no-hit provenance;
- evidence-source admissibility;
- trace diagnostic codes, separate from assertion reason codes;
- synthetic, biological and release regression fixtures;
- mapping consistency;
- append-only approval attestations bound to artifact hashes;
- versioned protein-to-gene rollup policy;
- versioned shadow publication policy.

`shadow-contract-manifest-v1.json` freezes the ten-file engineering contract
set by SHA-256. `shadow-qc-gates-v1.json` extends, but does not modify, the
frozen RC2-A gates. It explicitly sets `scientific_shadow_authorized=false`.

Legacy missing values are represented by `value_status` values such as
`not_reported` and `unknown_legacy`. Missing scores, thresholds, versions or
coordinates must never be replaced with zero, an empty pseudo-version or a
fabricated Boolean.

## KCTD12 mapping root cause

Read-only reconciliation showed:

| NCBI GeneID | Internal gene | Registry | RC1 subject |
| --- | --- | --- | --- |
| 107051871 | gene-KCTD12 | exact | ambiguous |
| 425504 | gene-KCTD12-2 | exact | ambiguous |

Both internal genes use the symbol `KCTD12`. The RC1 resolver took the union of
an exact NCBI GeneID match and both symbol matches, producing a false ambiguous
subject while the identifier registry correctly remained exact.

Future derived builds now resolve supplied stable NCBI/Ensembl identifiers
before symbols. A symbol is a fallback only when no stable identifier was
supplied. Conflicting stable identifiers remain ambiguous. A new build-time
blocker requires subject and effective registry mapping state/internal gene to
match. This is an engineering correction only; the immutable RC1 database was
not patched.

## Synthetic-only execution framework

The engineering framework now supports:

1. adapting versioned Pfam scan facts and both sequence/domain cutoffs;
2. preserving unknown scan, threshold and score states;
3. applying separate presence, absence and domain-order admissibility;
4. producing protein proposals without emitting assertions;
5. deterministic isoform-to-gene rollup with explicit conflict and mapping
   dispositions;
6. publication planning limited to proposed accepted, proposed candidate, no
   publication or curator review;
7. binding policy approvals to the exact canonical policy hash;
8. deterministic semantic proposal hashes for independent clean-build checks.

Candidate-only evidence cannot produce a proposed accepted assertion. Missing
or unknown admissibility yields a tri-state unknown result, not a negative
call. Every rollup and publication result remains a proposal and records
`formal_assertion_emitted=false`.

## Current blockers for formal Shadow 1

The following remain open and therefore block formal shadow execution:

- RC1 still contains two mapping cross-table mismatches; the correction exists
  only in future-build code and has not produced a release;
- threshold policy coverage is not 100%; all 118,957 legacy hit decisions are
  unknown;
- complete scan-universe/no-hit provenance is unavailable;
- evidence-admissibility, domain vocabulary, biological rules, rollup policy
  and publication policy do not yet have curator attestations authorizing a
  shadow run;
- biological and release regression fixtures are not yet curator-approved;
- two genuine mapping dispositions (BAP1 and LOC100859273) remain curator work.

## Validation commands

```text
python -m backend.scripts.validate_gene_family_contracts --require-rc1
python -m backend.scripts.validate_gene_family_shadow_contracts
python -m pytest backend -q
```

Passing these engineering checks does not override the scientific NO-GO. A
formal Shadow 1 may start only after every blocker gate reaches its declared
target and the required curator attestations bind the exact frozen artifacts.
