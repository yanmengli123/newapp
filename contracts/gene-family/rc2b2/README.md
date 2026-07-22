# RC2-B.2 readiness and curation-submission contracts

Contract identifier: `gg-gf-rc2b2-readiness-1.0`.

This append-only package extends, but does not modify, the frozen RC2-B.1
scientific-handoff contract. It defines the engineering boundary for building
the targeted GRCg6a protein universe and preparing curator submissions.

It does **not** approve a biological rule, authorize a Pilot or formal Shadow
run, write an assertion, build an RC2 database, or switch an API/frontend.

## Identity and denominator policy

- scientific subject: versioned RefSeq protein accession;
- scan-execution reuse key: SHA-256 of the normalized protein sequence;
- exact targeted denominators: 1,294 genes, 4,777 transcripts, 4,571 protein
  subjects and 206 transcripts with no protein product;
- equal sequences may be scanned once but must be re-expanded to every protein
  accession before rule evaluation;
- stable NCBI Gene identity is distinct from assembly placement.

## Append-only submission policy

An engineering-prepared `v001` submission may contain generated evidence and
missing curator-artifact inventory entries. It is never edited in place.
Scientific decisions produce a new, complete submission version (`v002`,
`v003`, and so on) linked with `supersedes_submission_id`.

## Scan boundary

The authoritative and diagnostic scans are separate evidence roles. A
diagnostic hit can never support an accepted assertion. A Pilot requires a
fully frozen Pfam/HMMER environment and a separate authorization artifact.
Full targeted scanning additionally requires successful Pilot acceptance.

