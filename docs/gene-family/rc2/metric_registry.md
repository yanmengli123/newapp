# Metric registry

Pages and API handlers do not define scientific counts. They request versioned,
allow-listed metrics from the registry.

Each metric defines ID/version, scheme, unit, subject level, base relation,
eligible assertion states and roles, mapping requirement, deduplication and
dimensions, an allow-listed implementation ID, and a definition hash. Arbitrary
SQL in metric metadata is prohibited.

## Numerator, denominator and exclusions

Every public metric returns:

```json
{
  "metric_id": "ubiquitin_accepted_mapped_gene_count",
  "metric_version": "1.0",
  "value": 383,
  "unit": "genes",
  "denominator": 387,
  "denominator_unit": "accepted source assertions",
  "excluded": {"ambiguous": 3, "unmapped": 1},
  "release_id": "gg-gf-2026-07-rc1"
}
```

This example is the RC1 baseline, not an RC2 target. RC2 values are computed from
RC2 assertions and reviewed through the release diff.

## Counting rules

- A source assertion count never deduplicates by mapped gene.
- A mapped-gene metric requires an explicit mapping state and deduplicates by
  internal gene ID.
- Protein and gene counts are never interchangeable.
- Domain-hit count counts evidence hits, not distinct proteins.
- Candidate records never enter accepted metrics.
- UBD/ULD supplementary assertions never enter ubiquitin-core metrics.
- A scheme with multiple entries may report per-entry and scheme-level unique
  counts separately; labels must identify which is used.

The API/materialized summary difference for every registered public metric must
be zero. Metric-definition changes require a new metric version and appear in
the release diff even if the numeric result does not change.

