# RC2-B.2-P1 scan reproducibility contracts

This package freezes the engineering contracts for Pfam 35.0 scan identity,
HMMER 3.4 execution, strict output parsing, Pilot fixtures, Pilot authorization,
independent Pilot runs and Pilot acceptance.

It is append-only relative to the frozen RC2-B.2-P0 target universe. Every P1
engineering package MUST bind the P0 target-universe manifest SHA-256:

`1f74a288c9fcbf3d552fcd01145bb430b615652797057eb8784ea245f636b3e6`

The following state systems are independent and MUST NOT be collapsed:

- `scan_environment_state`: `draft_missing_inputs` or `frozen`
- `pilot_run_state`: `draft`, `authorized`, `running`, `completed` or `failed`
- `pilot_acceptance_state`: `pending`, `passed` or `failed`
- `full_scan_authorized`: boolean

An environment freeze does not authorize a Pilot. Pilot acceptance does not
authorize a full scan. No contract in this package authorizes a 4,571-subject
scan, Formal Shadow 1, RC2-C, a database rebuild, or an API/frontend switch.

Raw authoritative GA hits and clan-resolved architecture are distinct data
products. P1 produces raw GA evidence only; clan resolution remains
`policy_pending`.

The contract package is validated by
`python -m backend.scripts.validate_gene_family_p1_contracts`.
