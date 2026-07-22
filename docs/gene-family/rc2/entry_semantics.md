# Entry semantics

An entry is a stable node in a versioned classification scheme, not a page label.

Required identity fields are `scheme_stable_id` and `entry_stable_id`. Names,
descriptions and URLs are versioned metadata and do not determine identity.

## Stable IDs

```text
animaltfdb-tf:<source family identifier>
animaltfdb-cofactor:<source class identifier>
kinomer-group:<group identifier>
pfam:<base accession>
ubiquitin-core:<class identifier>
ubiquitin-related:<domain class identifier>
```

Case, whitespace and punctuation normalization must be specified per scheme.
Display-name edits produce `entry_name_changed`; a biological definition edit
produces `entry_definition_changed`. Neither creates a new entry unless the
classification meaning itself changes.

## Entry lifecycle

Allowed states are `active`, `deprecated`, `merged`, and `retired`.

- `merged` must point to one replacement entry.
- `deprecated` remains queryable and may point to a replacement.
- `retired` remains present for historical release resolution.
- Entry records are never physically deleted from an already promoted release.

Parent-child relationships form a directed acyclic graph within a scheme. A
parent change is reported independently from assertion changes.

## Scheme cardinality

Each scheme declares `single_per_role`, `multi_per_role`, or `ordered_multi`.
Ingest must fail when data violate a single-valued scheme; it must not choose an
arbitrary winner. Manual or deterministic conflict resolution creates an
auditable decision and retains all source assertions.

