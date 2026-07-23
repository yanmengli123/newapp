# Gene Families repository API contract

`openapi-current.json` is generated from the FastAPI runtime OpenAPI document,
filtered to the 12 Gene Families routes and their complete referenced-schema
closure. It is the application repository contract for the feature-frozen
client, not a replacement for any immutable release-package asset.

Generate or refresh the contract:

```powershell
D:\soft\Python310\python.exe -m backend.gene_family_openapi_contract
```

Verify runtime and repository equality without writing files:

```powershell
D:\soft\Python310\python.exe -m backend.gene_family_openapi_contract --check
```

The RC1 file at `releases/gg-gf-2026-07-rc1/schema/openapi.json`, its manifest
and checksums remain unchanged. Its missing download routes and incomplete
response schemas are retained as documented RC1 limitations and will be
corrected only in a future immutable data release.
