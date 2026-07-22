# Machine-readable RC2-A contracts

These seven JSON files are the machine-readable side of
`gg-gf-contract-1.0`. Validate them from the repository root with:

```powershell
python -m backend.scripts.validate_gene_family_contracts
```

The validator resolves the RC1 SQLite database from `--rc1-db`, from
`--release-root`, or from a JSON `--release-registry`, in that order. Equivalent
runtime configuration can be supplied through
`GRCG6A_GENE_FAMILY_RELEASE_ROOT` or
`GRCG6A_GENE_FAMILY_RELEASE_REGISTRY`. No workstation-specific path is part of
the contract. A resolved database is opened with `mode=ro&immutable=1` and its
frozen SHA-256 and scientific baseline counts are checked. Use `--require-rc1`
for a promotion gate. `--skip-rc1` is only for environments where the release
asset is not mounted and does not waive that gate.

Contract changes require a version bump, updated test vectors/hashes, a release-
diff reason and review. Never edit a frozen contract silently.

`checksums.sha256` freezes the byte-level representation of the seven JSON
contracts in addition to their internal semantic hashes and test vectors.
