# RC2 exit criteria

RC2 promotion is machine-gated and human-signed. RC2-A freezes these criteria;
it does not claim they currently pass.

## Identity

- Assertion-key coverage and uniqueness: 100%.
- Assignment-slot coverage: 100% of applicable single-valued assertions.
- Non-applicable multi-valued assertions with a universal slot: zero.
- Stable-key algorithm and test vectors validated.

## Decisions and rules

- Decision provenance coverage: 100% of accepted assertions.
- Executable trace coverage: 100% of locally rule-derived assertions.
- Unknown rule references and rule regression failures: zero.
- Ubiquitin accepted/candidate assertions have approved rule or source decision
  provenance; biological approval is signed by the curator.

## Mapping and metrics

- Unreviewed accepted ambiguous/unmapped assertions: zero.
- Silent mapping drops: zero.
- Candidate records in accepted metrics: zero.
- Supplementary records in ubiquitin-core metrics: zero.
- Public metric registry coverage: 100%.
- API/materialized metric differences: zero.

## Diff and reproducibility

- Unexpected assertion changes: zero.
- Unexplained accepted removals/downgrades: zero.
- Source checksum coverage: 100%.
- Normalized and semantic-table hash reproducibility: 100%.
- Raw source modifications: zero.
- Rejected source records reported: 100%.

Source artifacts use byte-level SHA-256. Normalized exports use UTF-8, LF, fixed
column order, stable-key sorting, fixed null representation and canonical Decimal
text without build timestamps or local paths. Database semantic hash is a Merkle-
like root over sorted table name, row count and canonical table hash. SQLite
binary SHA-256 is a transfer-integrity checksum, not the sole reproducibility
gate. Manifest JSON is canonicalized with RFC 8785 JCS before hashing.

## Integrity and sign-off

- Blocking issues, biological regression failures, SQLite integrity errors,
  foreign-key errors and OpenAPI contract failures: zero.
- Required RC2 sign-offs: builder, data-QC reviewer and scientific curator are
  approved. GA1 additionally requires release approver.

Final RC2 state:

```text
release_status = release_candidate
qc_status = passed | warning
blocking_issue_count = 0
```

Limitations are structured with impact, affected schemes/metrics/assertions,
workaround, owner and target release. A limitation is not automatically a
blocker; the machine QC policy decides from scientific impact and usage.

