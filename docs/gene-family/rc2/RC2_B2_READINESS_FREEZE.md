# RC2-B.2 P0 readiness-freeze execution record

## Decision state

RC2-B.2 engineering and curation preparation is **conditionally GO**. The
targeted GRCg6a subject universe is frozen as engineering evidence. The scan
environment remains `draft_missing_inputs`.

The following remain **NO-GO**: Pilot execution, full targeted scan, formal
Shadow 1, RC2-C construction, formal assertion/database writes and API or
frontend switching.

## Append-only submission

The create-only package is:

`analysis/rc2b2-curation-submission-v001`

Submission identity:
`gg-gf-ubiquitin-curation-rc2b2-submission-v001`.

It is an engineering-prepared, unapproved package. It contains no curator
decision. All eight expected curator artifacts are recorded as missing with
null hashes. Curator content or corrections must be emitted as `v002` or a
later superseding version; `v001` must not be edited.

Frozen hashes:

- decision submission manifest:
  `d56d462f0e6ccad378100811e729aadd2a0751fac8085f8623058a88cd319a36`;
- target-universe manifest:
  `1f74a288c9fcbf3d552fcd01145bb430b615652797057eb8784ea245f636b3e6`;
- detached submission checksum manifest:
  `ffca41634b542ef8b9a39d3f951b3a60f1a07c1ff78a7a2404bdf9fe36dfdae9`.

## Target universe

The exact targeted denominators are:

| Metric | Frozen count |
| --- | ---: |
| Stable NCBI Gene subjects | 1,294 |
| Transcripts | 4,777 |
| Versioned protein subjects | 4,571 |
| No-protein transcript exclusions | 206 |
| Unique sequence scan executions | 3,525 |
| Shared-sequence groups | 460 |
| Protein subjects in shared groups | 1,506 |
| Reused scan executions | 1,046 |
| Multi-placement stable genes | 4 |
| Annotation-exception proteins | 209 |

Every one of the 206 no-protein transcripts is retained with
`included_in_protein_scan=false`, `exclusion_reason=no_protein_product` and
scan status `not_applicable`. None is counted as missing, failed, not attempted
or gene-scan incomplete.

The scientific subject key is the versioned protein accession. Sequence
SHA-256 is only the scan-execution reuse key. Results for a reused execution
must be re-expanded to all accessions before rule evaluation.

Quality facts:

- missing target protein FASTA records: 0;
- protein subjects mapped to multiple stable genes: 0;
- unexplained transcript exclusions: 0;
- transcript status coverage: 100%;
- protein sequence-hash coverage: 100%;
- raw source modifications: 0.

## Placement and mapping evidence

BAP1 is represented as stable `NCBIGene:415944` with two GRCg6a placements:
chromosome 12 and chromosome 26. Placement count does not increase the stable
gene denominator. The historical-split interpretation remains an engineering
proposal and requires curator review.

LOC100859273 is preserved as a source-level record with protein
`XP_025002047.1` on unplaced scaffold `NW_020110163.1`. Its proposed status is
`source_resolved_internal_unmapped`, reason
`internal_scaffold_coverage_gap`. No curator or formal assertion was emitted.

The assembly report contains a non-tabular trailing text line (`解释`, line
502). The source was not modified. The line is recorded in
`mapping-evidence/source-format-anomalies.tsv` with its own SHA-256 and an
explicit parse disposition. Unexplained source-format anomaly count is zero.

## Scan-environment state

The authoritative and diagnostic commands are frozen as separate roles. The
authoritative route includes `--cut_ga`; the diagnostic route is
`diagnostic_only` and cannot support an accepted assertion.

Pilot execution is blocked because the declared input set does not yet contain
the complete Pfam 35.0 HMM/metadata/clan/dead-family/pressed-index bundle,
HMMER 3.4 has not been observed, and an immutable container image digest has
not been recorded. Missing values remain null with `value_status=not_reported`;
no zero or false evidence value was fabricated.

## Reproducibility and immutability

Generator commit:
`9e9ae90024e5333055e00feef76415e5a65e9d6b`.

Evaluator commit:
`098ccb74ea0b515764e8dfc825ce2478c755774c`.

Two independent builds using the same locked inputs produced byte-identical
checksum manifests. Repeat-build match: 100%.

The parent batch remained unchanged:

- batch-002 manifest:
  `d7754cd31d3231e5521acb878d17403bfc2b2f0a6b376a5b819d0113abce4a01`;
- batch-002 checksums:
  `bfffdd3b5e1fa664114314bcb17d6930b6120bd042adb069f421bba6a3be0dcb`.

Passing these checks freezes engineering evidence only. It does not authorize
a Pilot, scientific classification change or formal Shadow run.

## Validation commands

```text
python -m backend.scripts.validate_gene_family_rc2b2_contracts
python -m backend.scripts.validate_gene_family_target_universe ...
python -m pytest backend/test_gene_family_rc2b2.py -q
python -m pytest backend -q
```

The repository regression result was 104 passed. Three pre-existing Windows
GBK decode warnings were emitted by comparative PAF subprocess-reader tests;
there were no test failures.
