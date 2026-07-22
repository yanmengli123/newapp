# Release diff contract

Diff compares biological meaning, not database row IDs.

## Matching order

1. Match `assertion_key`; compare state, mapping, rule, evidence bundle, review,
   metadata and source record.
2. For `single_per_role` schemes, match remaining records by
   `assignment_slot_key`; a changed entry is `classification_changed`.
3. Remaining records are `assertion_added` or `assertion_removed`.
4. For `multi_per_role` schemes, compare entry sets per source subject/role and
   report entry additions/removals without inventing a one-to-one slot.

Entry changes are reported separately: added, removed, name, definition, parent
or lifecycle state changed. Source checksum changes with unchanged normalized
content and assertions are `source_only_change`.

## Change record

Every diff row contains:

```text
change_type
assertion_key
assignment_slot_key (nullable)
old_value
new_value
reason_code
expected
issue_reference
reviewed_by
```

Accepted removal/downgrade must identify whether the cause is a source, mapping,
rule, evidence, review or metric-contract change. Silence is a blocker.

RC2 gates are zero unexpected assertion changes and zero unexplained accepted
removals/downgrades. An expected change still requires a reason and review; the
flag is not a waiver.

