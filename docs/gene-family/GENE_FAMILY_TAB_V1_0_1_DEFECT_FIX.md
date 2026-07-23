# Gene Families Tab v1.0.1 frozen-scope defect fix

Validation date: `2026-07-23`

Patch tag: `gene-family-tab-v1.0.1-defect-fix`

Parent freeze: `gene-family-tab-v1.0-feature-freeze`

Parent freeze commit: `64e325c662484d56ed59e035af6da5b11e74aa32`

## Decision

This patch closes four verified defects without reopening the Gene Families
feature scope. The accepted status after validation is:

```text
Feature scope                       Frozen
Page engineering                    PASS
Scientific visualization           PASS for the corrected display contract
Current data                        gg-gf-2026-07-rc1
RC1 scientific status               Release Candidate / QC Blocked
RC1 citation status                 Not citable as a final release
RC2 data switch                     Not authorized
```

No page, tab, chart, navigation branch, classification rule or scientific data
release was added by this patch.

## Corrected defects

### 1. Pfam domain scale

Domain tracks now use the observed protein length from `gf_subject.protein_length`.
The family-entry view and embedded gene-page section call the same validated
`DomainArchitecture` implementation.

The rendering contract is:

```text
observed protein length
  -> full-protein scale from residue 1 to protein_length

protein length not reported
  -> explicit "Protein length not reported" label
  -> local coordinate window only
  -> never presented as a complete protein scale

invalid or out-of-bounds domain coordinates
  -> validation warning
  -> track withheld instead of silently clipped
```

For Pfam `PF00069`, the release contains 1,697 evidence rows representing
1,697 proteins. Of these, 1,693 have observed lengths and all domain endpoints
are within their reported protein lengths. Four records remain explicitly
`not_reported`: `NP_990026.1`, `XP_025002218.1`, `XP_025002248.1` and
`XP_025002249.1`.

### 2. KCTD12 source-level search

Catalog search remains additive: ordinary entry, mapped-gene and protein
results are unchanged, while unresolved source-level assertions are returned
in a separate collection. Searching `KCTD12` returns exactly two source
records:

| NCBI Gene | Entry | Assertion | Mapping | Review | Internal gene |
| --- | --- | --- | --- | --- | --- |
| `107051871` | `E3_CRL_adaptor` | `accepted` | `ambiguous` | `needs_mapping` | `null` |
| `425504` | `E3_CRL_adaptor` | `accepted` | `ambiguous` | `needs_mapping` | `null` |

No temporary or inferred internal gene mapping is created.

### 3. Capability truthfulness

`available_sections` now describes only panels implemented by the current
client and supported by the current release. `domain_architecture=true` is
limited to Pfam entries. `expression_profile`, `genomic_distribution` and
`change_history` are `false` for all six schemes. No placeholder tabs were
added.

### 4. Repository OpenAPI completeness

The repository contract at
`contracts/gene-family/api/openapi-current.json` is generated from the FastAPI
runtime and contains all 12 Gene Families routes, including both download
routes, their query/path parameters, responses, content types, nullable fields,
enums and referenced schema closure. Runtime and repository contracts must be
byte-identical after deterministic normalization.

The immutable RC1 release-package OpenAPI file is intentionally unchanged; its
historical limitations remain part of RC1 provenance.

## Reproducible browser acceptance

The browser gate launches the newapp frontend on port 5174 and its read-only
Gene Families backend on port 8001, uses installed Google Chrome through
Playwright, and shuts down both processes after the run. It checks DOM geometry
against the validated residue fractions and compares four reviewed component
screenshots:

- `qa/baselines/gene-family/pf00069-observed-full-protein.png`;
- `qa/baselines/gene-family/pf00069-unknown-length-local-window.png`;
- `qa/baselines/gene-family/pf00069-long-multi-domain.png`;
- `qa/baselines/gene-family/kctd12-source-assertions.png`.

The unknown-length and long/multi-domain cases are deterministic browser
fixtures; the PF00069 known-length and KCTD12 search cases use the real RC1 API.
The gene page and family entry page are statically gated to the same shared
domain component and explicit protein-length status contract.

## Immutability evidence

The executable baseline is
`contracts/gene-family/tab-v1.0.1/immutability-baseline.json`.

| Artifact | SHA-256 |
| --- | --- |
| RC1 SQLite | `b590a0bfd9d81b41bbf044eb7daba08f241c9a959362d59f06de8142ac84ad97` |
| RC1 checksums | `e17720f5a3c7d6454d0f5891a0761d83599188db2ab0ebb5a6ed6b95270544fc` |
| RC1 source inventory | `9ffa73f36a7575a12b58b7e0daf45371093a38bb08bd432dc0681f7182ffd667` |
| P0 target manifest | `1f74a288c9fcbf3d552fcd01145bb430b615652797057eb8784ea245f636b3e6` |
| P1 pilot acceptance | `bbe542511175a6579c7e94abae586a044f051c8bdd2f3859b71cedd1b61ca3d4` |
| P1 full-scan authorization | `32839179432a6e6a3254bfc1cc7735f1b9a85d4422d65f2b27dae9557157a5b4` |

The gate rehashes the RC1 database, all 15 release-checksummed artifacts, all
20 source files listed in the release manifest, and the frozen P0/P1 inputs.
Full scan, Formal Shadow 1, RC2-C construction and API/frontend switching remain
false and unauthorized.

## Validation results

| Gate | Result |
| --- | --- |
| Feature-scope expansion | PASS; 0 new features |
| RC1 database/release/source mutation | PASS; 0 mutations |
| PF00069 known-length scale | PASS; 1,693/1,693 use observed lengths |
| PF00069 missing-length handling | PASS; 4/4 explicit |
| Family/gene rendering implementation | PASS; one shared validated component |
| KCTD12 source records | PASS; exactly 2, with source states preserved |
| Unsupported `capability=true` | PASS; 0 |
| Runtime/repository endpoint mismatch | PASS; 0 across 12 routes |
| Gene Families backend suite | PASS; 67/67 |
| Domain-scale and frontend contracts | PASS |
| Chrome DOM geometry and visual regression | PASS; 4/4 baselines |
| TypeScript / ESLint / production build | PASS / PASS / PASS |

Verification commands:

```powershell
npm run test:gene-family-domain-scale
npm run test:gene-family-contract
npm run test:gene-family-browser
npm run lint
npm run build
D:\soft\Python310\python.exe -m backend.gene_family_openapi_contract --check
$gfTests=(Get-ChildItem backend -Filter 'test_gene_family*.py' -File).FullName
& D:\soft\Python310\python.exe -m pytest @gfTests -q
```

The Vite build retains non-blocking large-chunk warnings from existing shared
application dependencies. A production-dependency audit also reports two high
and four moderate advisories in existing React Router, ECharts and transitive
dependency chains. Framework/dependency upgrades are deliberately excluded
from this scientific defect patch and require a separate security-maintenance
change with full application regression testing.

## Scientific boundary after closure

This patch makes the current page behavior and API contract internally
consistent and scientifically non-misleading. It does not repair RC1's missing
Pfam threshold provenance, source/tool versions, ubiquitin evidence scope,
classification-basis defects, licenses or workflow manifests. Those remain in
the RC2 scientific release pipeline.

Therefore:

```text
Gene Families page defect patch complete  !=  RC1 formally publishable
```
