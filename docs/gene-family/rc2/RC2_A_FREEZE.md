# RC2-A engineering freeze record

Contract version: `gg-gf-contract-1.0`

Engineering tag: `gene-family-rc2a-contract-v1.0`

The annotated Git tag resolves the exact freeze commit. The SHA-256 of the
seven-file checksum manifest is
`120159d77a579ed1936f4867cb9282028ee5d721d5e183b08e9ba849bcc1c4cd`.
The immutable RC1 comparison database expected by the validator has SHA-256
`b590a0bfd9d81b41bbf044eb7daba08f241c9a959362d59f06de8142ac84ad97`.

## Frozen implementation contracts

- Stable assertion/assignment identities and scheme cardinality.
- Single-valued publication cardinality: accepted primary 0..1, published
  primary candidate 0..1, evaluated alternatives 0..N.
- Strong Kleene `true/false/unknown` rule-node semantics.
- Independent rule evaluations, node traces and evidence links; an evaluation
  does not require or imply an assertion.
- Absence may be true only when the required evidence-completeness dimensions
  are known and no passing hit exists.
- Append-only review/sign-off events and separation of manual review from
  automatic rule priority.
- Stable reason/state, metric, mapping, diff, evidence and QC contracts.
- Runtime release discovery without a workstation-specific path in frozen
  artifacts.

## Freeze verification

- Contract validator with explicit read-only RC1 baseline: 13 checks, zero
  warnings, zero errors.
- RC2-A focused tests: 8 passed.
- RC1 mapping reconciliation: 383 exact, 3 ambiguous, 1 unmapped.
- Contract/schema/docs path-portability scan: zero absolute local paths.
- The final annotated tag records the complete repository test/lint/build
  result used for the engineering freeze.

## Deliberately excluded

This is an engineering contract freeze, not scientific approval. It does not
approve ubiquitin biological rules, decide the four mapping exceptions, build
or promote an RC2 database, change RC1, publish API statistics, or authorize a
website release. Those actions require their specified curator and release
sign-offs.

The Git author records engineering authorship only and must not be interpreted
as the scientific curator or release approver.
