# Machine-readable RC2-A contracts

These seven JSON files are the machine-readable side of
`gg-gf-contract-1.0`. Validate them from the repository root with:

```powershell
D:\soft\python310\python.exe -m backend.scripts.validate_gene_family_contracts
```

The validator also opens the RC1 SQLite database with `mode=ro&immutable=1` and
checks its frozen SHA-256 and scientific baseline counts. Use `--skip-rc1` only
for environments where the release asset is not mounted; it does not waive the
RC2 promotion gate.

Contract changes require a version bump, updated test vectors/hashes, a release-
diff reason and review. Never edit a frozen contract silently.

`checksums.sha256` freezes the byte-level representation of the seven JSON
contracts in addition to their internal semantic hashes and test vectors.
