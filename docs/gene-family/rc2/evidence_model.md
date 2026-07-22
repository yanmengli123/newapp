# Evidence model

Evidence is immutable, source-addressable and separable from the assertion it
supports. The same evidence can support, conflict with, map, or review multiple
assertions through explicit links.

## Evidence provenance

Every record includes source artifact ID and SHA-256, source row or record ID,
method, value provenance, and a deterministic content hash. Evidence roles are
`classification`, `supporting`, `conflicting`, `mapping`, and `review`.

`decision_basis_type` distinguishes:

- `executable_local_rule`
- `external_curated_source`
- `manual_review`
- `legacy_source_assertion`

All accepted assertions require decision provenance. Only locally evaluated
rules require an executable rule trace; AnimalTFDB classifications instead trace
to the authoritative source row and version.

## Pfam/HMMER fields

When reported, preserve sequence and domain statistics separately:

```text
sequence_evalue, sequence_score
domain_cevalue, domain_ievalue, domain_score, bias
sequence_ga, domain_ga, threshold_mode
sequence_threshold_pass, domain_threshold_pass, overall_threshold_pass
hmm_from, hmm_to, ali_from, ali_to, env_from, env_to
```

Pfam accession base, accession version, Pfam release and HMMER version are
distinct fields. Alignment and envelope coordinates are not interchangeable.

Missing values use `value_status`: `observed`, `derived`, `not_reported`,
`not_applicable`, or `unknown_legacy`. Missing source values are never encoded as
zero or false. Any derived value records its derivation implementation/version.

## Provenance completeness

Evidence provenance is `complete`, `inferred`, `partial`, or `unknown_legacy`,
with scientific impact `none`, `minor`, `major`, or `critical`. Unknown legacy
versions that directly determine an accepted call are GA blockers unless the
analysis is rerun or the call is downgraded. RC2 may retain such evidence only as
an explicit blocker/limitation according to the QC contract.

## Ubiquitin evidence scope audit

Domain evidence comparison uses two deterministic keys:

- Hit identity: subject namespace/identifier, Pfam accession, HMM, alignment and
  envelope coordinates when available.
- Hit content: identity plus normalized scores, E-values, bias and threshold
  fields.

Legacy evidence without coordinates uses a declared reduced identity key and is
never presented as exact coordinate-level equivalence. Numeric text is parsed as
Decimal, canonicalized, and rejects NaN/Infinity. The original evidence files
remain read-only; any filtered artifact records source checksum, rule version,
before/after counts and content hash.

