# Release state contract

Release lifecycle and QC are independent dimensions.

## Release lifecycle

Allowed states are:

```text
internal_review -> release_candidate -> published -> deprecated
internal_review | release_candidate | published | deprecated -> withdrawn
```

Historical releases are immutable. A published release never moves back to
`release_candidate`; corrections produce a new release. `withdrawn` is reserved
for a serious defect and must include a reason and replacement when available.

## QC state

Allowed states are `pending`, `passed`, `warning`, and `blocked`.

- Any open blocker derives `blocked`.
- With no blocker but at least one open warning, QC derives `warning`.
- With no open blocker or warning and all required checks executed, QC derives
  `passed`.
- Missing required check results derive `pending`.

The stored QC state is checked against this derivation; it is not accepted as an
unverified label.

## Assertion and review state

Assertion states are `accepted`, `candidate`, `rejected`, `deprecated`, and
`withdrawn`. Mapping uncertainty is not an assertion state. For example:

```text
assertion_state = candidate
reason_code = mapping_unresolved
```

Review workflow states are `unreviewed`, `confirmed`, `needs_review`, and
`resolved`. Decisions are `approve`, `reject`, `retain_candidate`, `remap`, and
`insufficient_evidence`. Workflow state and decision are stored separately.

Review events are append-only. They never erase the algorithmic result or rule
trace. An approved review affects a new assertion version in a later release.

## RC2 target

```text
release_status = release_candidate
qc_status = passed | warning
blocking_issue_count = 0
```

RC2 is not `published`; publication is reserved for GA1 sign-off and deployment.

