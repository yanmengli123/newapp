# ChickenData Gene Family RC2-A scientific contracts

Status: `frozen_for_implementation`  
Contract version: `gg-gf-contract-1.0`  
Baseline release: `gg-gf-2026-07-rc1`

RC2-A freezes the meaning of identifiers, assertions, evidence, rules, metrics,
mapping, release states and release differences before any RC2 catalog is built.
It does not change RC1 data and does not approve biological classification rules.

Normative documents:

1. [Release state contract](release_state_contract.md)
2. [Assertion identity contract](assertion_identity_contract.md)
3. [Subject identifier policy](subject_identifier_policy.md)
4. [Entry semantics](entry_semantics.md)
5. [Evidence model](evidence_model.md)
6. [Rule model](rule_model.md)
7. [Metric registry](metric_registry.md)
8. [Mapping policy](mapping_policy.md)
9. [Diff contract](diff_contract.md)
10. [RC2 exit criteria](rc2_exit_criteria.md)

Supporting design records:

- [RC1 read-only baseline](rc1_baseline.md)
- [RC2 schema migration design](schema_migration_design.md)

Machine-readable contracts live in `contracts/gene-family/rc2`. If prose and a
machine contract disagree, the conflict is a contract validation failure and
must be resolved before building RC2; neither representation silently wins.

The contracts follow FAIR's requirement that data-producing algorithms and
workflows remain identifiable and reusable. Provenance terms follow PROV-O.
The legacy `gf-canonical-json-sha256-v1` artifact-hash profile is deterministic
but is not labeled RFC 8785 JCS; a future JCS implementation must receive a new
algorithm identifier and conformance vectors. The release package targets the
RO-Crate 1.3 long-term specification without making crate completion an RC2-A
gate.

Engineering execution records:

- [Gene Families Tab v1.0 feature freeze](../GENE_FAMILY_TAB_FEATURE_FREEZE.md)
- [RC2-B shadow preparation](RC2_B_SHADOW_PREPARATION.md)
- [RC2-B.1 scientific handoff](RC2_B1_SCIENTIFIC_HANDOFF.md)
- [RC2-B.2 P0 readiness freeze](RC2_B2_READINESS_FREEZE.md)
- [RC2-B.2-P1 scan reproducibility record](RC2_B2_P1_SCAN_REPRODUCIBILITY.md)
