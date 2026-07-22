# RC2-B.1 scientific handoff addendum

This package defines the governance interfaces between the RC2-B engineering
packet, scientific curators and a future formal Shadow Runner. It does not
contain an approved ubiquitin classification rule, a curator decision, a scan
result or an RC2 release database.

Contract identifier: `gg-gf-rc2b1-scientific-handoff-1.0`.

The frozen RC2-A package and RC2-B evaluator package are referenced, not
modified. Hashes use the existing `gf-canonical-json-sha256-v1` profile. That
profile is deterministic JSON serialization with UTF-8, sorted object keys,
compact separators and rejected NaN/Infinity; it is **not** RFC 8785 JCS.

`legacy_hit_observed` is an evidence fact, represented by the field
`legacy.pfam_observed_terms`. It is queried only with the already frozen
`contains`, `exists` and `eq` operators. It is not a rule-language operator and
does not establish `domain_present` or `domain_absent`.

The two scope profiles are intentionally different:

- `shadow-scope-targeted-rescanned-v1` is the preferred future scientific
  route, but requires a frozen GRCg6a protein/isoform universe and a complete,
  versioned rescan before absence or order claims can be enabled.
- `shadow-scope-legacy-restricted-v1` is a diagnostic reassessment profile.
  It cannot support absence, order, accepted emission, discovery, catalog
  completeness or proteome-wide recall claims.

Run `python -m backend.scripts.validate_gene_family_handoff_contracts` to
verify the package and its manifest.
