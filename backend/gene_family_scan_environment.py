"""Build and validate the immutable RC2-B.2-P1 Pfam/HMMER environment.

The builder never runs ``hmmscan``. It verifies official Pfam 35.0 assets,
freezes an immutable HMMER 3.4 OCI runtime, and performs two independent
``hmmpress`` runs in fresh derived directories.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

from backend.gene_family_handoff_contracts import sha256_file
from backend.gene_family_hmmer_parser import command_sha256, read_pfam_ga_thresholds
from backend.gene_family_p1_contracts import (
    P0_TARGET_MANIFEST_SHA256,
    validate_p1_contracts,
)
from backend.gene_family_pilot_fixtures import validate_pilot_fixture_package


PACKAGE_ID = "rc2b2-p1-scan-environment-v001"
ENVIRONMENT_ID = "gg-gf-pfam35-hmmer34-pilot-environment-v1"
INDEX_SUFFIXES = (".h3f", ".h3i", ".h3m", ".h3p")
EXPECTED_UNCOMPRESSED_HMM_SHA256 = (
    "8d3e2ffa785f91ee0e24a3994d2dcfff6f382e3cf663784a47688e7d95297fee"
)
EXPECTED_UNCOMPRESSED_HMM_SIZE = 1572192814
MD5_LINE_RE = re.compile(r"^([0-9a-f]{32})  (\S+)$")


class ScanEnvironmentError(ValueError):
    pass


@dataclass
class ScanEnvironmentReport:
    checks: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def check(self, name: str) -> None:
        self.checks.append(name)

    def error(self, message: str) -> None:
        self.errors.append(message)

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "check_count": len(self.checks),
            "error_count": len(self.errors),
            "checks": self.checks,
            "errors": self.errors,
        }


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def _md5_file(path: Path) -> str:
    digest = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _gzip_uncompressed_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with gzip.open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
            allow_nan=False,
        )
        + "\n",
        encoding="utf-8",
    )


def _write_checksums(root: Path) -> None:
    paths = sorted(
        (path for path in root.rglob("*") if path.is_file() and path.name != "checksums.sha256"),
        key=lambda path: path.relative_to(root).as_posix(),
    )
    with (root / "checksums.sha256").open("w", encoding="utf-8", newline="\n") as handle:
        for path in paths:
            handle.write(
                f"{sha256_file(path)}  {path.relative_to(root).as_posix()}\n"
            )


def _verify_checksum_manifest(root: Path) -> None:
    path = root / "checksums.sha256"
    if not path.is_file():
        raise ScanEnvironmentError("environment checksum manifest is missing")
    count = 0
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw:
            continue
        try:
            expected, relative = raw.split("  ", 1)
        except ValueError as exc:
            raise ScanEnvironmentError(
                f"invalid checksum line {line_number}: {raw!r}"
            ) from exc
        relative_path = Path(relative)
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise ScanEnvironmentError(f"unsafe checksum path: {relative}")
        target = root / relative_path
        if not target.is_file() or sha256_file(target) != expected:
            raise ScanEnvironmentError(f"checksum mismatch: {relative}")
        count += 1
    if count == 0:
        raise ScanEnvironmentError("environment checksum manifest is empty")


def _directory_inventory(root: Path) -> list[dict[str, Any]]:
    return [
        {
            "relative_path": path.relative_to(root).as_posix(),
            "byte_size": path.stat().st_size,
            "sha256": sha256_file(path),
        }
        for path in sorted(
            (path for path in root.rglob("*") if path.is_file()),
            key=lambda path: path.relative_to(root).as_posix(),
        )
    ]


def _run(
    argv: Sequence[str], *, cwd: Path | None = None
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            list(argv),
            cwd=cwd,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="strict",
        )
    except (OSError, UnicodeError) as exc:
        raise ScanEnvironmentError(f"command failed to start: {argv[0]}: {exc}") from exc


def _docker_runtime(policy: dict[str, Any]) -> dict[str, Any]:
    container = policy["container"]
    image_reference = container["image_reference"]
    expected_digest = container["manifest_digest"]
    inspect = _run(
        [
            "docker",
            "image",
            "inspect",
            image_reference,
            "--format",
            "{{json .RepoDigests}}|{{.Os}}/{{.Architecture}}",
        ]
    )
    if inspect.returncode != 0:
        raise ScanEnvironmentError(f"docker image inspect failed: {inspect.stderr}")
    try:
        repo_json, platform = inspect.stdout.strip().split("|", 1)
        repo_digests = json.loads(repo_json)
    except (ValueError, json.JSONDecodeError) as exc:
        raise ScanEnvironmentError("cannot parse docker image identity") from exc
    if not any(item.endswith("@" + expected_digest) for item in repo_digests):
        raise ScanEnvironmentError("local OCI image does not carry the frozen manifest digest")
    if platform != container["platform"]:
        raise ScanEnvironmentError(f"OCI platform drift: {platform}")
    version = _run(["docker", "version", "--format", "{{.Client.Version}}"])
    if version.returncode != 0 or not version.stdout.strip():
        raise ScanEnvironmentError("cannot determine Docker client version")
    immutable = container["immutable_reference"]
    probe = _run(
        [
            "docker",
            "run",
            "--rm",
            "--platform",
            container["platform"],
            "-e",
            "LC_ALL=C",
            "-e",
            "LANG=C",
            "-e",
            "TZ=UTC",
            "--entrypoint",
            "/bin/sh",
            immutable,
            "-c",
            "hmmscan -h | head -n 2; sha256sum /usr/local/bin/hmmscan /usr/local/bin/hmmpress",
        ]
    )
    if probe.returncode != 0:
        raise ScanEnvironmentError(f"HMMER runtime probe failed: {probe.stderr}")
    output = probe.stdout
    if "HMMER 3.4" not in output:
        raise ScanEnvironmentError("HMMER runtime version is not 3.4")
    binaries = policy["binaries"]
    if binaries["hmmscan_sha256"] not in output or binaries["hmmpress_sha256"] not in output:
        raise ScanEnvironmentError("HMMER runtime binary hash drift")
    return {
        "container_runtime": "docker",
        "container_runtime_version": version.stdout.strip(),
        "image_reference": image_reference,
        "image_manifest_digest": expected_digest,
        "immutable_image_reference": immutable,
        "oci_platform": platform,
        "hmmer_version": policy["hmmer_version"],
        "hmmscan_binary_sha256": binaries["hmmscan_sha256"],
        "hmmpress_binary_sha256": binaries["hmmpress_sha256"],
        "environment": policy["environment"],
    }


def _download(url: str, target: Path) -> str:
    retrieved = _utc_now()
    request = urllib.request.Request(url, headers={"User-Agent": "ChickenData-RC2B2-P1/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response, target.open(
            "wb"
        ) as handle:
            if getattr(response, "status", 200) != 200:
                raise ScanEnvironmentError(f"official asset returned HTTP {response.status}: {url}")
            shutil.copyfileobj(response, handle, length=1024 * 1024)
    except (OSError, urllib.error.URLError) as exc:
        raise ScanEnvironmentError(f"cannot download official asset {url}: {exc}") from exc
    return retrieved


def _parse_official_md5(path: Path) -> dict[str, str]:
    records: dict[str, str] = {}
    for line_number, raw in enumerate(path.read_text(encoding="ascii").splitlines(), 1):
        match = MD5_LINE_RE.fullmatch(raw)
        if not match:
            raise ScanEnvironmentError(f"invalid official MD5 line {line_number}")
        digest, name = match.groups()
        if name in records:
            raise ScanEnvironmentError(f"duplicate official MD5 entry: {name}")
        records[name] = digest
    if not records:
        raise ScanEnvironmentError("official MD5 manifest is empty")
    return records


def _asset_inventory(
    *,
    raw_dir: Path,
    local_hmm_gz: Path,
    policy: dict[str, Any],
) -> list[dict[str, Any]]:
    base_url = policy["release_directory"]
    required = policy["required_assets"]
    retrieved: dict[str, str] = {}
    for item in required:
        name = item["artifact_name"]
        destination = raw_dir / name
        if name == "Pfam-A.hmm.gz":
            shutil.copyfile(local_hmm_gz, destination)
            retrieved[name] = _utc_now()
        else:
            retrieved[name] = _download(f"{base_url}/{name}", destination)
    official = _parse_official_md5(raw_dir / "md5_checksums")
    inventory: list[dict[str, Any]] = []
    for item in required:
        name = item["artifact_name"]
        path = raw_dir / name
        observed_size = path.stat().st_size
        if observed_size != item["official_byte_size"]:
            raise ScanEnvironmentError(
                f"official byte-size mismatch for {name}: {observed_size}"
            )
        observed_md5 = _md5_file(path)
        expected_md5 = item["official_md5"]
        if name != "md5_checksums":
            if official.get(name) != expected_md5:
                raise ScanEnvironmentError(f"asset policy and official MD5 disagree: {name}")
            if observed_md5 != expected_md5:
                raise ScanEnvironmentError(f"official MD5 mismatch: {name}")
            verification = "official_md5_verified"
        else:
            verification = "release_identity_anchor"
        compressed_sha = sha256_file(path)
        if name.endswith(".gz"):
            uncompressed_sha = _gzip_uncompressed_sha256(path)
        else:
            uncompressed_sha = compressed_sha
        if name == "Pfam-A.hmm.gz" and uncompressed_sha != EXPECTED_UNCOMPRESSED_HMM_SHA256:
            raise ScanEnvironmentError("compressed Pfam-A.hmm expands to an unexpected HMM")
        inventory.append(
            {
                "artifact_name": name,
                "official_url": f"{base_url}/{name}",
                "release_id": "Pfam 35.0",
                "retrieved_at_utc": retrieved[name],
                "byte_size": observed_size,
                "official_md5": expected_md5,
                "observed_md5": observed_md5,
                "compressed_sha256": compressed_sha,
                "uncompressed_sha256": uncompressed_sha,
                "verification_status": verification,
            }
        )
    relnotes = (raw_dir / "relnotes.txt").read_text(encoding="utf-8")
    for required_text in policy["release_note_required_text"]:
        if required_text not in relnotes:
            raise ScanEnvironmentError(
                f"Pfam release notes lack required identity text: {required_text!r}"
            )
    return inventory


def _press_run(
    *,
    run_id: str,
    run_dir: Path,
    source_hmm: Path,
    runtime_policy: dict[str, Any],
) -> dict[str, Any]:
    run_dir.mkdir(parents=True, exist_ok=False)
    derived_hmm = run_dir / "Pfam-A.hmm"
    shutil.copyfile(source_hmm, derived_hmm)
    if derived_hmm.stat().st_size != EXPECTED_UNCOMPRESSED_HMM_SIZE:
        raise ScanEnvironmentError(f"{run_id} HMM copy byte-size mismatch")
    if sha256_file(derived_hmm) != EXPECTED_UNCOMPRESSED_HMM_SHA256:
        raise ScanEnvironmentError(f"{run_id} HMM copy hash mismatch")
    container = runtime_policy["container"]
    mount = f"type=bind,source={run_dir.resolve()},target=/db"
    argv = [
        "docker",
        "run",
        "--rm",
        "--platform",
        container["platform"],
        "-e",
        "LC_ALL=C",
        "-e",
        "LANG=C",
        "-e",
        "TZ=UTC",
        "--mount",
        mount,
        container["immutable_reference"],
        "hmmpress",
        "/db/Pfam-A.hmm",
    ]
    started = _utc_now()
    completed = _run(argv)
    finished = _utc_now()
    stdout_path = run_dir / "hmmpress.stdout.txt"
    stderr_path = run_dir / "hmmpress.stderr.txt"
    stdout_path.write_text(completed.stdout, encoding="utf-8", newline="\n")
    stderr_path.write_text(completed.stderr, encoding="utf-8", newline="\n")
    if completed.returncode != 0:
        raise ScanEnvironmentError(
            f"{run_id} hmmpress failed with {completed.returncode}: {completed.stderr}"
        )
    missing = [suffix for suffix in INDEX_SUFFIXES if not Path(str(derived_hmm) + suffix).is_file()]
    if missing:
        raise ScanEnvironmentError(f"{run_id} missing pressed indexes: {missing}")
    return {
        "run_id": run_id,
        "command_argv": argv,
        "command_text": shlex.join(argv),
        "command_canonical_sha256": command_sha256(argv),
        "stdout_sha256": sha256_file(stdout_path),
        "stderr_sha256": sha256_file(stderr_path),
        "exit_code": completed.returncode,
        "started_at_utc": started,
        "completed_at_utc": finished,
    }


def _scan_command_record(argv: list[str]) -> dict[str, Any]:
    return {
        "command_argv": argv,
        "command_text": shlex.join(argv),
        "command_canonical_sha256": command_sha256(argv),
        "execution_authorized": False,
    }


def build_scan_environment_package(
    *,
    output: Path,
    p0_root: Path,
    fixture_root: Path,
    source_pfam_dir: Path,
    contracts_root: Path,
    created_at_utc: str,
) -> Path:
    if output.exists():
        raise FileExistsError(f"create-only scan environment already exists: {output}")
    contract_report = validate_p1_contracts(contracts_root)
    if not contract_report.ok:
        raise ScanEnvironmentError(f"P1 contracts failed: {contract_report.errors}")
    fixture_report = validate_pilot_fixture_package(fixture_root)
    if not fixture_report.ok:
        raise ScanEnvironmentError(f"Pilot fixtures failed: {fixture_report.errors}")
    p0_manifest = p0_root / "target-universe" / "target-universe-manifest.json"
    fixture_manifest = fixture_root / "pilot-fixture-manifest.json"
    source_hmm = source_pfam_dir / "Pfam-A.hmm"
    source_hmm_gz = source_pfam_dir / "Pfam-A.hmm.gz"
    for path in (p0_manifest, fixture_manifest, source_hmm, source_hmm_gz):
        if not path.is_file():
            raise ScanEnvironmentError(f"required environment input is missing: {path}")
    if sha256_file(p0_manifest) != P0_TARGET_MANIFEST_SHA256:
        raise ScanEnvironmentError("P0 target manifest hash drift")
    if source_hmm.stat().st_size != EXPECTED_UNCOMPRESSED_HMM_SIZE:
        raise ScanEnvironmentError("source Pfam-A.hmm byte-size drift")
    if sha256_file(source_hmm) != EXPECTED_UNCOMPRESSED_HMM_SHA256:
        raise ScanEnvironmentError("source Pfam-A.hmm hash drift")
    source_before = _directory_inventory(source_pfam_dir)
    pfam_policy = json.loads(
        (contracts_root / "pfam-35-asset-policy-v1.json").read_text(encoding="utf-8")
    )
    runtime_policy = json.loads(
        (contracts_root / "hmmer-runtime-policy-v1.json").read_text(encoding="utf-8")
    )
    command_policy = json.loads(
        (contracts_root / "scan-command-policy-v1.json").read_text(encoding="utf-8")
    )
    runtime = _docker_runtime(runtime_policy)
    thresholds = read_pfam_ga_thresholds(source_hmm)
    if len(thresholds) != 19632:
        raise ScanEnvironmentError(f"Pfam model count drift: {len(thresholds)}")

    output.parent.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix=f".{output.name}.tmp-", dir=output.parent))
    try:
        raw_dir = temp / "official-assets"
        raw_dir.mkdir()
        asset_inventory = _asset_inventory(
            raw_dir=raw_dir,
            local_hmm_gz=source_hmm_gz,
            policy=pfam_policy,
        )
        run_a = _press_run(
            run_id="press-run-a",
            run_dir=temp / "derived" / "press-run-a",
            source_hmm=source_hmm,
            runtime_policy=runtime_policy,
        )
        run_b = _press_run(
            run_id="press-run-b",
            run_dir=temp / "derived" / "press-run-b",
            source_hmm=source_hmm,
            runtime_policy=runtime_policy,
        )
        comparisons: list[dict[str, Any]] = []
        for suffix in INDEX_SUFFIXES:
            a = temp / "derived" / "press-run-a" / f"Pfam-A.hmm{suffix}"
            b = temp / "derived" / "press-run-b" / f"Pfam-A.hmm{suffix}"
            digest_a = sha256_file(a)
            digest_b = sha256_file(b)
            if digest_a != digest_b:
                raise ScanEnvironmentError(f"hmmpress A/B index mismatch: {suffix}")
            comparisons.append(
                {
                    "suffix": suffix,
                    "run_a_sha256": digest_a,
                    "run_b_sha256": digest_b,
                    "hashes_equal": True,
                }
            )
        source_after = _directory_inventory(source_pfam_dir)
        source_modified = source_before != source_after
        if source_modified:
            raise ScanEnvironmentError("source Pfam directory changed during environment build")
        _write_json(temp / "source-pfam-inventory-before.json", source_before)
        _write_json(temp / "source-pfam-inventory-after.json", source_after)
        with (temp / "asset-inventory.tsv").open(
            "w", encoding="utf-8", newline=""
        ) as handle:
            fields = [
                "artifact_name",
                "official_url",
                "release_id",
                "retrieved_at_utc",
                "byte_size",
                "official_md5",
                "observed_md5",
                "compressed_sha256",
                "uncompressed_sha256",
                "verification_status",
            ]
            import csv

            writer = csv.DictWriter(
                handle,
                fieldnames=fields,
                delimiter="\t",
                lineterminator="\n",
                extrasaction="raise",
            )
            writer.writeheader()
            writer.writerows(asset_inventory)
        authoritative_argv = command_policy["authoritative"]["command_argv"]
        diagnostic_argv = command_policy["pilot_diagnostic"]["command_argv"]
        manifest = {
            "schema_version": "1.0",
            "environment_id": ENVIRONMENT_ID,
            "package_id": PACKAGE_ID,
            "scan_environment_state": "frozen",
            "created_at_utc": created_at_utc,
            "p0_target_manifest_sha256": P0_TARGET_MANIFEST_SHA256,
            "pilot_fixture_manifest_sha256": sha256_file(fixture_manifest),
            "pfam_release": "35.0",
            "official_checksum_manifest_sha256": sha256_file(
                raw_dir / "md5_checksums"
            ),
            "official_assets": asset_inventory,
            "pfam_model_count_total": len(thresholds),
            "pfam_model_count_with_ga": len(thresholds),
            "runtime": runtime,
            "scan_commands": {
                "authoritative": _scan_command_record(authoritative_argv),
                "diagnostic": _scan_command_record(diagnostic_argv),
            },
            "press_runs": [run_a, run_b],
            "pressed_index_reproducibility": comparisons,
            "source_pfam_directory_modified": False,
            "source_modification_count": 0,
            "clan_resolution_state": "policy_pending",
            "pilot_scan_authorized": False,
            "full_scan_authorized": False,
            "formal_shadow_authorized": False,
            "rc2c_build_authorized": False,
            "api_frontend_switch_authorized": False,
        }
        _write_json(temp / "scan-environment-manifest.json", manifest)
        (temp / "README.md").write_text(
            "# RC2-B.2-P1 frozen scan environment v001\n\n"
            "Official Pfam 35.0 assets were verified against the archived EBI MD5 "
            "manifest. HMMER 3.4 was pinned by OCI manifest digest and binary hashes. "
            "Two fresh hmmpress runs produced four byte-identical indexes. This package "
            "does not authorize or contain an hmmscan run.\n",
            encoding="utf-8",
        )
        _write_checksums(temp)
        os.replace(temp, output)
    except Exception:
        if temp.exists():
            shutil.rmtree(temp)
        raise
    return output


def validate_scan_environment_package(root: Path) -> ScanEnvironmentReport:
    report = ScanEnvironmentReport()
    try:
        _verify_checksum_manifest(root)
    except (OSError, UnicodeError, ScanEnvironmentError) as exc:
        report.error(str(exc))
        return report
    report.check("scan_environment_checksums_verified")
    try:
        manifest = json.loads(
            (root / "scan-environment-manifest.json").read_text(encoding="utf-8")
        )
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        report.error(f"cannot load environment manifest: {exc}")
        return report
    if (
        manifest.get("package_id") != PACKAGE_ID
        or manifest.get("environment_id") != ENVIRONMENT_ID
        or manifest.get("scan_environment_state") != "frozen"
        or manifest.get("p0_target_manifest_sha256") != P0_TARGET_MANIFEST_SHA256
    ):
        report.error("scan environment identity or P0 binding drift")
    assets = manifest.get("official_assets")
    if (
        not isinstance(assets, list)
        or len(assets) != 7
        or any(
            item.get("verification_status")
            not in {"official_md5_verified", "release_identity_anchor"}
            for item in assets
            if isinstance(item, dict)
        )
    ):
        report.error("official Pfam asset verification coverage drift")
    comparisons = manifest.get("pressed_index_reproducibility")
    if (
        not isinstance(comparisons, list)
        or len(comparisons) != 4
        or any(item.get("hashes_equal") is not True for item in comparisons)
    ):
        report.error("pressed-index reproducibility gate failed")
    if (
        manifest.get("source_pfam_directory_modified") is not False
        or manifest.get("source_modification_count") != 0
    ):
        report.error("source Pfam mutation detected")
    for field in (
        "pilot_scan_authorized",
        "full_scan_authorized",
        "formal_shadow_authorized",
        "rc2c_build_authorized",
        "api_frontend_switch_authorized",
    ):
        if manifest.get(field) is not False:
            report.error(f"environment package crosses authorization boundary: {field}")
    if not report.errors:
        report.check("pfam_identity_runtime_and_indexes_verified")
        report.check("scan_environment_authorization_boundary_verified")
    return report


def project_paths() -> tuple[Path, Path, Path, Path]:
    project_root = Path(__file__).resolve().parent.parent
    data_root = Path(r"D:\jbrowsedata\projectdata")
    analysis = data_root / "gene family" / "analysis"
    return (
        analysis / "rc2b2-curation-submission-v001",
        analysis / "rc2b2-p1-pilot-fixtures-v001",
        data_root / "hmmer_db",
        project_root / "contracts" / "gene-family" / "rc2b2-p1",
    )


def main(argv: list[str] | None = None) -> int:
    default_p0, default_fixture, default_pfam, default_contracts = project_paths()
    parser = argparse.ArgumentParser(description="Build or validate P1 scan environment")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--p0-root", type=Path, default=default_p0)
    parser.add_argument("--fixture-root", type=Path, default=default_fixture)
    parser.add_argument("--source-pfam-dir", type=Path, default=default_pfam)
    parser.add_argument("--contracts", type=Path, default=default_contracts)
    parser.add_argument("--created-at-utc")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args(argv)
    if args.validate_only:
        report = validate_scan_environment_package(args.output)
        print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2))
        return 0 if report.ok else 1
    if not args.created_at_utc:
        parser.error("--created-at-utc is required for a build")
    build_scan_environment_package(
        output=args.output,
        p0_root=args.p0_root,
        fixture_root=args.fixture_root,
        source_pfam_dir=args.source_pfam_dir,
        contracts_root=args.contracts,
        created_at_utc=args.created_at_utc,
    )
    report = validate_scan_environment_package(args.output)
    print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2))
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
