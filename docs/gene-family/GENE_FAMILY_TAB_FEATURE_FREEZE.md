# Gene Families Tab v1.0 feature freeze

Freeze status: `engineering_complete / feature_frozen`

Freeze tag: `gene-family-tab-v1.0-feature-freeze`

Frozen-scope defect addendum:
[v1.0.1 defect fix](GENE_FAMILY_TAB_V1_0_1_DEFECT_FIX.md)

Validation completed: `2026-07-23T01:03:53Z`

Parent engineering baseline: `1ef982693d7958f99667982fda0fe7e44e61d40f`

## Decision

The Gene Families Tab page-development scope is complete and frozen. The
catalog, entry, evidence, member, domain-position, download/provenance and
gene-page integration workflows form the accepted v1.0 engineering surface.
The page-development epic is closed by this record.

This is an engineering freeze, not a scientific publication decision.

```text
Gene Families Tab       Engineering Complete / Feature Frozen
Current data            gg-gf-2026-07-rc1
Scientific status       Release Candidate / QC Blocked
Citation status         Not citable as a final release
RC2 data switch         Not authorized
```

## Frozen surface

- `/gene-families`
- `/gene-families/entry/:entryId`
- `/gene-families/downloads`
- the Gene Families & Domains section embedded in `/gene/:geneId`
- the `/api/v1/gene-family-catalog` read-only API
- gene family annotations and protein domain-hit API responses

No new Gene Families pages, charts, navigation branches, classification
modules or evolutionary-analysis features are admitted after this freeze.

## Permitted changes after freeze

- confirmed bug fixes;
- security, performance and accessibility fixes;
- scientific warning or wording corrections;
- compatibility changes strictly required for a future immutable RC2 release;
- the authorized RC2-C data switch and its post-switch smoke tests.

Any other change requires an explicit unfreeze decision and a new engineering
baseline. A data release does not silently unfreeze the page feature scope.

## Data and scientific boundary

The default configuration remains pinned to `gg-gf-2026-07-rc1`. A read-only
in-process API smoke test against the application returned:

```text
release_id       gg-gf-2026-07-rc1
release_status   release_candidate
qc_status        blocked
blocking_checks  5
```

The five retained RC1 blockers are:

1. `ubiquitin_classification_basis_schema`;
2. `documented_outputs_present`;
3. `source_analysis_scripts_present`;
4. `ubiquitin_domain_evidence_scope`;
5. `tool_and_proteome_versions_recorded`.

The catalog and downloads pages visibly identify the release candidate and
state that it is not a final citable release. No RC1 database, assertion,
classification or release asset was changed during this freeze.

RC2-B.2-P1 remains an engineering reproducibility result. Full targeted scan,
Formal Shadow 1, RC2-C construction and database/API/frontend data switching
remain unauthorized. Scientific completion requires:

```text
full targeted scan
-> curator sign-off
-> Formal Shadow 1
-> RC2-C
-> blocking QC = 0
-> authorized data switch and smoke test
```

## Freeze verification

All checks below passed against the freeze source tree.

| Check | Result |
| --- | --- |
| Production frontend build (`npm run build`) | PASS; Vite built 11,272 modules |
| TypeScript | PASS; included in the production build |
| Gene Families targeted ESLint | PASS |
| Frontend API contract (`npm run test:api-contract`) | PASS |
| Gene Families backend suite | PASS; 62/62 tests |
| Read-only API smoke test | PASS; release, summary, entries and Pfam entry returned HTTP 200 |
| RC1 boundary assertion | PASS; release candidate, QC blocked, five blockers |

Verification commands:

```powershell
npm run build
.\node_modules\.bin\eslint.cmd src/App.tsx src/pages/GeneFamilyCatalogPage.tsx src/pages/GeneFamilyEntryPage.tsx src/pages/GeneFamilyDownloadsPage.tsx src/components/gene_family/*.tsx src/lib/geneFamilyApi.ts
npm run test:api-contract
D:\soft\Python310\python.exe -m pytest backend/test_gene_family_catalog.py backend/test_gene_family_mapping.py backend/test_gene_family_contracts.py backend/test_gene_family_handoff_contracts.py backend/test_gene_family_rule_engine.py backend/test_gene_family_shadow_contracts.py backend/test_gene_family_shadow_framework.py backend/test_gene_family_curator_packet.py backend/test_gene_family_rc2b2.py backend/test_gene_family_p1.py -q -p no:cacheprovider
```

The Vite build reported non-fatal large-chunk warnings for existing shared
application dependencies. The Gene Families route chunks were emitted
successfully and ranged from 5,673 to 12,533 bytes.

### Verification environment

```text
Node.js      v24.14.0
npm          11.9.0
TypeScript   5.9.3
Vite         7.3.1
Python       3.10.11
```

### Frontend build fingerprint

The ignored `dist/` build contained 826 files and 1,967,947,112 bytes. The
aggregate below is SHA-256 over sorted
`relative_path<TAB>size<TAB>file_sha256` records; generated assets are not
committed.

```text
0cba8b293578669fe1e6896519761e6c79d49ac9bf3ca2c40a29714640805b65
```

Gene Families route assets:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `geneFamilyApi-CblZbalF.js` | 1,150 | `ad9168d51a4e95fcb72d2e9dae1049e74ab0423828285396f85002d2c218a719` |
| `GeneFamilyCatalogPage-GYlcQZmy.js` | 12,533 | `3c37c78eb6fe7307d724d447b0131056d8cccf372f5f8842c0fb1e8d14984500` |
| `GeneFamilyDownloadsPage-CCDhC_Qj.js` | 5,673 | `869632c7eb89e4dcfde47717c14f3fc7cf29d00224402f3ccd0a552f88f1d99b` |
| `GeneFamilyEntryPage-C-iDdgXz.js` | 12,015 | `2f7fdcc81d2d1261e4d1c67fd4b941b961fe2c3eb688df218689b36ff42e5e3e` |

## Closure rule

The feature-freeze tag identifies the immutable source baseline for the closed
Gene Families Tab engineering scope. Future scientific data work must preserve
this distinction in release notes:

```text
page engineering complete != scientific data formally published
```
