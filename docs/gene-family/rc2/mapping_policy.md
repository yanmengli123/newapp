# Mapping policy

Mapping connects immutable source identity to release-specific ChickenData
entities. It never rewrites the source identifier or assertion key.

Allowed mapping states are `exact`, `ambiguous`, `unmapped`, and
`not_applicable`. An exact mapping has exactly one target; ambiguous has at least
two candidate targets; unmapped has none; not-applicable is restricted to
subjects for which mapping is scientifically irrelevant.

## Disposition

Accepted ambiguous/unmapped assertions require an append-only disposition with:

```text
source_subject
assertion_key
mapping_state
candidate_internal_ids
scientific_impact
review_decision
reviewer
reason
reviewed_at
source_record_hash
```

Permitted outcomes include retaining the accepted source assertion outside the
mapped-gene metric, correcting the mapping, downgrading to candidate, rejecting,
or merging a duplicate source record. The hard RC2 gate is zero *unreviewed*
accepted ambiguous/unmapped assertions, not zero mapping exceptions.

## Protein-to-gene rollup

Rollup reports total catalog isoforms, evaluated isoforms, supporting isoforms,
conflicting isoforms and a representative-protein selection rule. Evaluation
states distinguish `not_evaluated`, `evaluated_no_hit`, `below_threshold`, and
`passing_hit`. Absence of evidence is never assumed to be a negative result.

Isoform conflict remains visible. A gene-level summary cannot silently discard
a protein-level assertion that disagrees with the chosen representative.

