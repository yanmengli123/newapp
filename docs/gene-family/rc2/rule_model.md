# Rule model

Local classification rules are versioned expression trees. Arbitrary SQL or
Python expressions are prohibited in rule data.

## Structure

`gf_rule` stores stable/version IDs, scheme, output entry/state, priority,
description, references, curator/approval metadata and effective releases.

`gf_rule_node` forms a tree using `all`, `any`, `not`, and `predicate` nodes.
Sibling order is explicit and the graph must be acyclic with exactly one root.
`gf_rule_predicate` uses only allow-listed operators from the machine contract.

Evidence scopes are:

```text
same_hit
same_protein
same_gene
any_isoform
all_isoforms
representative_isoform
```

Scope is mandatory. For example, `(RING OR U-box) AND NOT ABC_transporter`
must state whether all conditions apply to the same protein. The evaluator may
not merge domains from different isoforms unless the rule explicitly uses a
gene/isoform scope.

## Rule trace

Each local evaluation stores rule/node versions, evaluation result, canonical
observed value, matched evidence IDs and failure reason. It must answer why an
assertion was accepted, retained as candidate, or rejected.

External curated sources receive decision provenance, not a fabricated local
expression tree.

## Precedence and review

Automatic precedence is frozen per scheme, including exclusions, specificity,
mutual exclusivity, stop-on-match and conflict behavior. Manual review is not an
automatic rule priority. It is an append-only decision layer that may supersede
an algorithmic conclusion in a later assertion version while retaining the
original trace.

## Ubiquitin curation

The damaged classification-basis TSV is reference material, not an executable
authority. Rules require biological definition, positive/negative/candidate
conditions, scope, priority, reason codes, references, curator and approver.
Each rule needs positive, negative, boundary, missing-evidence and conflicting-
evidence fixtures.

CFTR is a fixed negative regression for accepted E3_RBR. Tests must verify its
expected candidate/rejected state, exclusion reason, matching exclusion rule,
absence from accepted metrics, and continued traceability of original Pfam
evidence.

