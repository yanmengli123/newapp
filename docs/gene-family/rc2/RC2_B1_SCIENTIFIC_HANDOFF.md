# RC2-B.1 scientific handoff execution record

## Decision state

The scientific-handoff interfaces are implemented. The addendum is
`gg-gf-rc2b1-scientific-handoff-1.0` and remains engineering-only.

The following are still **NO-GO**: targeted rescan execution, approval of
biological rules or classifications, formal Shadow 1, accepted/candidate state
changes, RC2-C construction, API switching and frontend changes.

## Added interfaces

The machine-readable package in `contracts/gene-family/rc2b1` adds:

- a create-only, supersedable curation-batch manifest;
- a standalone evidence-admissibility policy schema;
- complete component, aggregate and run-authorization attestation types;
- targeted-rescanned and legacy-restricted scope profiles;
- an aggregate resolver that binds every approved component and attestation by
  hash;
- a formal Shadow Runner input/output interface that is orchestration-only and
  cannot write release assertions or a release database;
- explicit two-clean-directory reproducibility and rejected-record reporting
  requirements.

The package extends RC2-A/RC2-B without changing either frozen manifest.

## Scientific boundary corrections

Only `artifact_hash_algorithm` is used. The retained
`gf-canonical-json-sha256-v1` profile has deterministic test vectors and is
explicitly not RFC 8785 JCS.

`legacy_hit_observed` is the ordinary fact field
`legacy.pfam_observed_terms`. It can be queried with the already-frozen
`contains`, `exists` and `eq` operators. It is not a new operator, and it does
not imply domain presence or absence.

Legacy restricted gates represent an inapplicable metric as a structured
record with `gate_status=not_applicable`, `observed_value=null` and a required
reason. A text token is never placed in a numeric metric field.

The current CFTR exclusion reason code remains
`excluded_abc_transporter_architecture`; no competing reason code was added.

RO-Crate 1.3 is described as the current long-term specification release, not
as a W3C Recommendation. PROV-O remains the W3C provenance ontology.

## Targeted rescan preparation

The preferred future route is pinned to GRCg6a assembly
`GCF_000002315.6`. The create-only batch inventory records the observed protein
FASTA, NCBI Annotation Release 104 GFF and assembly report by logical locator,
byte size and SHA-256.

The declared isoform universe, mapping-completeness proof, Pfam release/HMM
library, HMMER version, command, threshold policy and scanned/no-hit/failed
subject lists remain missing. Consequently:

- `formal_targeted_rescan_ready=false`;
- gene-level absence is disabled;
- presence, absence, order and threshold-dependent predicates are disabled in
  the unexecuted profile;
- no scan or Shadow authorization is implied.

## Database design

The RC2 draft schema now models curation batches, immutable batch artifacts,
versioned scope profiles, approval aggregates and their component attestations.
Terminal batches and approval artifacts are append-only. A scientifically
authorized future shadow row must bind the batch, scope profile, exact input
manifest, aggregate approval and run authorization.

This remains a migration design only. RC1 was not modified and no RC2 SQLite
database was created.

## Validation

```text
python -m backend.scripts.validate_gene_family_handoff_contracts
python -m pytest backend/test_gene_family_handoff_contracts.py -q
python -m pytest backend -q
```

Passing these checks proves interface integrity only. It does not approve
scientific content or authorize execution of a formal shadow.
