# Subject identifier policy

Source identity is kept separate from ChickenData mapping.

## Namespace rules

| Namespace | Stable-key rule |
|---|---|
| `ncbi_gene` | ASCII decimal GeneID; remove surrounding whitespace only |
| `ensembl_gene` | uppercase stable ID; store an optional version separately |
| `refseq_protein` | uppercase accession and retain sequence version |
| `refseq_transcript` | uppercase accession and retain sequence version |
| `pfam` | uppercase base accession; store model version separately |
| `chickendata_gene` | mapping target only; never a source assertion key |
| `gene_symbol` | alias/search field only; never a stable key |

RefSeq protein versions are identity-bearing because different versions may
represent different sequences. The accession without version is stored as a
`subject_lineage_id` for cross-version association, not replacement.

## Normalization requirements

- Apply Unicode NFC before namespace-specific processing.
- Reject control characters, embedded tabs/newlines and empty identifiers.
- Do not infer a namespace from a symbol-like value.
- Preserve the original value and a normalization audit record.
- Never convert an invalid value into a plausible identifier.
- Namespace aliases are versioned in the machine contract.

Mapping fields (`internal_gene_id`, candidates, method, state) are mutable release
attributes and never enter the source identity key. This allows a corrected
mapping to appear as `mapping_changed` rather than assertion removal/addition.

