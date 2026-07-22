# RC2 schema migration design

Status: design only; not applied to RC1.

## Strategy

RC1 is immutable, so RC2 is built into a new transactional directory and a new
SQLite database. There is no in-place migration of
`gg-gf-2026-07-rc1/gene_family.sqlite`.

```text
releases/.build/<release-id>.<build-id>/
  -> validate, audit, build, diff, verify, sign
  -> atomic rename to releases/<release-id>/
```

Failed builds move to `.failed` and never appear as a formal release.

## Required schema delta

### Existing entities

- `gf_release`: expanded lifecycle, contract version, QC derivation and previous
  release reference.
- `gf_scheme`: stable ID, cardinality and classification axis.
- `gf_entry`: stable ID, version and lifecycle/replacement fields.
- `gf_subject`: normalized source identity, lineage ID and normalization audit.
- `gf_source_record` plus `gf_assertion_source_record`: immutable row-level
  provenance with many-to-many assertion links, so duplicate/supporting source
  records are retained rather than collapsed into one nullable field.
- `gf_assertion`: assertion/version/slot keys, decision basis, reason, release-
  specific mapping targets, rule version and evidence bundle hash.
- `gf_evidence`/`gf_domain_hit`: value/provenance status and complete Pfam/HMMER
  fields without inventing unavailable legacy values.

### New entities

- Rule expression tree and independent execution provenance:
  `gf_rule_node`, `gf_rule_predicate`, `gf_rule_evaluation`,
  `gf_rule_node_trace`, and `gf_rule_trace_evidence`. Evaluations exist even
  when no assertion is emitted.
- Metrics: `gf_metric_definition`, `gf_metric_value`.
- Curation: `gf_mapping_disposition`, append-only `gf_review_event` v2.
- Release governance: `gf_release_signoff`, `gf_limitation`.
- Reproducibility: normalized/table/root hash registry and rejected-source rows.
- Provenance: minimal PROV-O-compatible entity, activity, agent and relationship
  records; RO-Crate 1.3 is generated from these records.

## Legacy-state mapping

| RC1 value | RC2 interpretation |
|---|---|
| assertion `unresolved` | `candidate` + an explicit reason code |
| review `not_required` | `confirmed` only when decision provenance is complete; otherwise `unreviewed` |
| review `approved` | `confirmed` with migrated review provenance |
| review `in_review` | `needs_review` |
| review `rejected` | `resolved` plus `review_decision=reject` |
| review `needs_mapping` | `needs_review` plus mapping reason |

No migration rule infers a curator identity or approval. Missing reviewer
provenance remains unreviewed and may block RC2.

## Migration phases

1. Create an empty RC2 database from the new schema.
2. Import immutable source artifacts using frozen normalization contracts.
3. Generate stable subjects, entries, assertions and evidence from source—not by
   copying RC1 row IDs.
4. Load review/mapping dispositions as independent append-only inputs.
5. Compute metrics, canonical hashes and RC1-to-RC2 diff.
6. Run gates and sign-off before atomic promotion.

This approach tests reproducibility and prevents RC1 implementation artifacts
from becoming accidental RC2 scientific truth.
