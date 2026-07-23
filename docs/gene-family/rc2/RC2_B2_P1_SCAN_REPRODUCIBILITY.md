# RC2-B.2-P1 Scan Environment and Pilot Reproducibility Record

## Status

RC2-B.2-P1 completed the authorized engineering scope on 2026-07-22:

```text
P1 contract package             frozen / PASS
Pfam 35.0 release identity      verified / PASS
HMMER 3.4 OCI environment       frozen / PASS
hmmpress run A/B                4/4 byte-identical indexes / PASS
Pilot fixtures                  frozen / PASS
Pilot authorization             issued for fixtures only / PASS
Pilot run A                     completed / PASS
Pilot run B                     completed / PASS
Pilot acceptance                passed 20/20 gates
Full targeted scan              explicitly not authorized
Formal Shadow 1                 not authorized
RC2-C                           not authorized
Database/API/frontend switch    not authorized
```

This record is an engineering reproducibility result. It is not a scientific
curator approval and does not emit or replace E1/E2/E3/DUB classifications.

## Frozen parent binding

All P1 packages bind the immutable RC2-B.2-P0 target-universe manifest:

```text
1f74a288c9fcbf3d552fcd01145bb430b615652797057eb8784ea245f636b3e6
```

P0 v001, RC2-B.1 batch-002, RC1, the release database, API and frontend were
not modified.

## Official Pfam 35.0 identity

The environment package archives and verifies the following release files:

- `md5_checksums`
- `relnotes.txt`
- `Pfam-A.hmm.gz`
- `Pfam-A.hmm.dat.gz`
- `Pfam-A.clans.tsv.gz`
- `Pfam-A.dead.gz`
- `Pfam-C.gz`

`Pfam-A.hmm.gz` matched the official MD5
`2cdbfbec0e3c6f0b1ecb6db1b8fc337f`, compressed size `293000230`, compressed
SHA-256 `48ec2d1123c84046b00279eae1fb3d5be1b578e6221453f329d16954c89d0d35`
and uncompressed SHA-256
`8d3e2ffa785f91ee0e24a3994d2dcfff6f382e3cf663784a47688e7d95297fee`.
The uncompressed library contains 19,632 models and 19,632 GA records.

Primary references:

- [Pfam FTP file definitions](https://pfam-docs.readthedocs.io/en/latest/ftp-site.html)
- [Pfam 35.0 official release directory](https://ftp.ebi.ac.uk/pub/databases/Pfam/releases/Pfam35.0/)
- [HMMER 3.4 release](https://github.com/EddyRivasLab/hmmer/releases/tag/hmmer-3.4)
- [hmmscan command semantics](https://github.com/EddyRivasLab/hmmer/blob/master/documentation/man/hmmscan.man.in)

## Frozen runtime

```text
OCI image    quay.io/biocontainers/hmmer:3.4--hdbdd923_0
OCI digest   sha256:85d118bad293e1a55372f80618512f72d939b14f6f62444fcd872f7c324fed0d
platform     linux/amd64
hmmscan      a8fa3e42c6539289554a778a8218b4a8b789d761ed5191a93e40158e0be41a93
hmmpress     9c081cc328be009f28ce3839b8baf090d282e219f9148dfa3c9590d0e2db7b5f
LC_ALL       C
LANG         C
TZ           UTC
cpu          1
seed         42
qformat      fasta
```

Two fresh derived directories each received a verified copy of
`Pfam-A.hmm`. Both `hmmpress` executions exited 0 and the `.h3f`, `.h3i`,
`.h3m` and `.h3p` hashes matched 4/4. The source Pfam directory modification
count was zero.

## Pilot denominators and results

The fixture package contains eight unique scan executions and expands to 26
versioned protein accessions. It covers canonical positives, multi-domain
proteins, annotation exceptions, a 19-accession shared sequence and one
authoritative no-hit/diagnostic boundary sequence.

Both Pilot runs independently observed:

```text
execution completed_with_hits     7
execution completed_no_hits       1
execution failed                  0
execution not_attempted           0

subject completed_with_hits       25
subject completed_no_hits         1
subject failed                    0
subject not_attempted             0

raw authoritative GA domains      27
reported diagnostic domains       7085
reported below-GA domains         7058
parser rejected records           0
```

The raw authoritative product remains separate from diagnostic evidence.
Clan resolution was not applied and raw hits are not called final domain
architecture.

## Reproducibility comparison

Run A and run B matched on all required derived hashes:

```text
authoritative canonical SHA-256   174478a13e5c4f4520bc11585b31c8caf704cf65fa7b8c816de73e1173e1f335
authoritative semantic SHA-256    6128547fad04418057d7268be4b214ccdf827786b0bffce271c0aed09f328ebb
diagnostic canonical SHA-256      ea1a0938b76d4764777e0db439f22951936af7d4f6a89324d74a94e371afc1f7
diagnostic semantic SHA-256       89a663c545ec27b9708106de302c0280647318d37c916c63838034dce64079f5
execution status semantic SHA-256 dd3b154a7741b80d04f1c3c3dc951c79fea9c351a64f2302568570b3b63b347e
subject status semantic SHA-256   e951c0a328eb584fdb2f3d3b86ad1326fc657cafc845cd91a34d9e22807c33de
```

Raw HMMER outputs include run dates and are preserved but are not treated as
semantic hashes. The canonical tables exclude non-scientific runtime metadata.

## Package identities

```text
Pilot fixture manifest
64fa28cd2a407463cc47d3a015d0624faa3aa3e981621dcaa7c51d1bca647f91

Scan environment manifest
6667842f6d1bb4945b8af5c63a9e6f84607e254f3e08216129a2d0a7101c7348

Pilot authorization
5196cfb658136b1f33ca31da04a3d1020ece8d29fab6c1936fa0ef478ebf2d30

Pilot run A manifest
965f3062f5b2c85c524564a58a3f4f9b1b231f2b50ec85b50caabefd090f1e33

Pilot run B manifest
ff8612bdd8b0132de95543522cd92593079c908acbde8954212e2bd787a5268d

Pilot acceptance
bbe542511175a6579c7e94abae586a044f051c8bdd2f3859b71cedd1b61ca3d4

Full-scan decision (not authorized)
32839179432a6e6a3254bfc1cc7735f1b9a85d4422d65f2b27dae9557157a5b4
```

## Next gate

No full scan may start from Pilot acceptance alone. A future full targeted
scan requires an independent project-owner authorization that binds the exact
accepted environment, P0 universe, parser implementation, policies and full
scan commands. Formal Shadow 1 remains downstream of that separate work.
