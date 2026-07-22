# RC2-B ubiquitin rule authoring package

This directory contains schemas and authoring conventions only. It deliberately
contains no approved biological E1/E2/E3/DUB classification rule and no mapping
disposition. Scientific rules must be supplied and signed by the designated
curator before a shadow run can be considered for release.

## Authoring boundary

- Domain predicates reference stable controlled `term_id` values, never display
  labels or free-text domain names.
- A vocabulary term maps explicitly to one or more version-aware source model
  accessions.
- Rule trees use only the allow-listed node types and operators in
  `gg-gf-contract-1.0`.
- Authoring YAML is restricted to ordinary mappings, sequences and scalar
  values and must be loaded with a safe loader. JSON is a valid safe subset.
- The evaluator executes only compiler-produced canonical JSON. It never
  executes YAML, SQL, Python, JavaScript, shell fragments or embedded code.
- `approved` vocabulary/rule records require named curator and approver fields;
  an engineering Git author is not a scientific signatory.

Synthetic fixtures live under `backend/testdata/gene_family_rules` so that test
rules cannot be mistaken for production biological policy.

