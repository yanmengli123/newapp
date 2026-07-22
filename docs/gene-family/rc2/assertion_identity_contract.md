# Assertion identity contract

RC2 uses two deterministic identities and a release-specific version identity.

## Assertion key

`assertion_key` identifies the stable biological claim that a source subject has
a role in a specific classification entry. Its canonical payload contains only
strings:

```text
taxon_id
scheme_stable_id
source_subject_namespace
source_subject_identifier
entry_stable_id
assignment_role
```

The payload is serialized with RFC 8785 JCS and hashed with SHA-256. The key is
stored as `gfak1:<lowercase hex digest>`. The algorithm label is
`gf-assertion-key-v1`. Assertion state, mapping target, evidence, review state,
release ID and display symbol are deliberately excluded.

## Assignment slot key

`assignment_slot_key` detects a classification change within a single-valued
axis. Its payload excludes entry and adds `classification_axis`:

```text
taxon_id
scheme_stable_id
source_subject_namespace
source_subject_identifier
assignment_role
classification_axis
```

It is emitted only when `assignment_cardinality = single_per_role`. Kinomer
primary group and ubiquitin core primary class use a slot. Pfam is
`multi_per_role` and has no universal slot; its entries are compared as sets.
`ordered_multi` uses an explicit axis and position discriminator defined by the
scheme contract.

## Version identity

`assertion_version_id` is deterministic within a release:

```text
sha256("gf-assertion-version-v1" + U+001F + release_id + U+001F + assertion_key)
```

Random UUIDs are prohibited. The database uniqueness rule is:

```sql
UNIQUE (release_id, assertion_key)
```

## Cardinality registry

| Scheme | Cardinality | Classification axis |
|---|---|---|
| AnimalTFDB TF | `single_per_role` | `tf_family` |
| AnimalTFDB cofactor | `single_per_role` | `cofactor_class` |
| Kinomer | `single_per_role` | `kinomer_group` |
| Pfam | `multi_per_role` | none |
| Ubiquitin core | `single_per_role` | `ubiquitin_core_class` |
| Ubiquitin-related domain | `multi_per_role` | none |

The registry is a present-data contract. If future source data permits multiple
TF/cofactor assignments per subject and role, the scheme cardinality must be
versioned before ingest; records must never be silently collapsed.

