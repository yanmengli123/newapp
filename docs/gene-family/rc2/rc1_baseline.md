# RC1 read-only baseline

The RC2 work must treat this release as immutable.

| Property | Baseline value |
|---|---|
| Release | `gg-gf-2026-07-rc1` |
| Release status | `release_candidate` |
| QC status | `blocked` |
| SQLite SHA-256 | `b590a0bfd9d81b41bbf044eb7daba08f241c9a959362d59f06de8142ac84ad97` |
| Manifest record count | 125,109 assertions |
| Pfam domain hits | 118,957 |
| Ubiquitin accepted source assertions | 387 |
| Ubiquitin exact mapped accepted assertions | 383 |
| Ubiquitin ambiguous accepted assertions | 3 |
| Ubiquitin unmapped accepted assertions | 1 |

The four accepted ubiquitin mapping exceptions are:

| Source subject | Symbol | RC1 mapping state |
|---|---|---|
| NCBI Gene `107051871` | KCTD12 | ambiguous |
| NCBI Gene `415944` | BAP1 | ambiguous |
| NCBI Gene `425504` | KCTD12 | ambiguous |
| NCBI Gene `100859273` | LOC100859273 | unmapped |

Before and after every RC2-A validation run, the SQLite checksum above must be
unchanged. Contract tests may open RC1 read-only, but must not attach a writable
database, issue DDL/DML, or replace any release asset.

RC1 is a technical baseline, not a scientifically approved gold set. A diff
against RC1 describes change; it does not make RC1 classifications authoritative.

