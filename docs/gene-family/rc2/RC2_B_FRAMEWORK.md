# RC2-B rule and evidence-audit framework

Status: engineering framework implemented; scientific rule catalog absent.

## Controlled rule pipeline

```text
safe JSON/YAML authoring
  -> strict vocabulary and rule validation
  -> deterministic canonical JSON compilation
  -> tri-state independent evaluation
  -> evaluation/node/evidence trace
  -> separate publication decision (not implemented here)
```

The domain vocabulary assigns stable controlled term IDs to explicit,
version-aware model accessions. Display labels and synonyms are descriptive and
cannot be predicate operands. Schema files are under
`rules/gene-family/ubiquitin/v1`; all shipped rule fixtures are visibly
non-biological `SYN:*` test data under `backend/testdata`.

YAML tags, aliases, anchors, arbitrary objects and non-finite/floating authoring
values are rejected. The engine executes only canonical JSON produced by the
compiler. Output is create-only, so a prior compiled bundle is never silently
overwritten.

## Evaluation provenance

The evaluation-context hash covers exactly:

- source-artifact hashes;
- scientific-contract bundle hash;
- canonical rule hash;
- domain-vocabulary hash;
- reason-registry hash;
- engine Git commit;
- dependency-lock hash;
- engine-configuration hash.

The evidence-snapshot hash is separate. Evaluation records retain every
non-match, exclusion, conflict and insufficient/not-evaluable result and never
emit an assertion implicitly.

## Projected evidence audit

The coordinate-rich identity for `all_pfam_hits.tsv` uses canonical protein ID,
Pfam accession/version, domain index, HMM coordinates, alignment coordinates
and envelope coordinates. The legacy evidence file can only be compared at
canonical protein ID plus base Pfam accession.

The 2026-07-22 read-only audit produced:

- 118,957 rows in each source;
- 118,957 unique projected keys in each source;
- 118,957 projected one-to-one matches;
- zero projected unmatched/excess rows;
- zero duplicate full coordinate identities;
- identical before/after SHA-256 for both sources.

This is projected-key equality only. Coordinate-level equivalence remains
explicitly false because the legacy file does not carry coordinates. Any future
filtered evidence artifact must copy full rows from `all_pfam_hits.tsv`; the
legacy file may select keys but may not supply coordinates or scores.

Generated audit artifacts are analysis outputs, not release assets:

```text
gene family/analysis/rc2b-evidence-audit-20260722/
  audit-summary.json
  projected-key-comparison.tsv
  full-identity-duplicates.tsv
```

## NO-GO boundary

The framework does not contain curator-approved ubiquitin rules, decide the
four mapping exceptions, run an approved biological shadow classification,
build/promote RC2, change RC1, or publish API/site statistics. Those remain
blocked on the named scientific and release sign-offs.

