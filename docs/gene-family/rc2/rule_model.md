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

Rule evaluation is independent of assertion publication. `gf_rule_evaluation`
is created for every attempted rule/subject pair, including failures and cases
where no assertion is emitted. It records one of `matched`, `not_matched`,
`excluded`, `conflicted`, `insufficient_evidence`, or `not_evaluable`, together
with evidence-snapshot and complete evaluation-context hashes. Its nullable
`emitted_assertion_version_id` links an evaluation to a published claim only
when a claim was actually produced.

`gf_rule_node_trace` records `true`, `false`, or `unknown` for every evaluated
node. `gf_rule_trace_evidence` links trace nodes to immutable evidence rows.
Rejected assertions are not fabricated merely to retain a negative trace.

Boolean composition uses Strong Kleene logic: `false AND unknown = false`,
`true AND unknown = unknown`, `true OR unknown = true`, `false OR unknown =
unknown`, and `NOT unknown = unknown`.

`domain_absent = true` requires a complete scan, known database/model/threshold,
a complete evidence set and no passing hit. If no passing hit is visible but
any completeness condition is unknown, the predicate is `unknown`, not `true`.

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
