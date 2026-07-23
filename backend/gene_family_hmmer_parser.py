"""Strict HMMER 3.4 hmmscan table parsers and semantic hashing.

Every non-comment record is either parsed or raises ``HmmerParseError``.
There is no permissive/silent-skip mode. Numeric fields use ``Decimal`` so
semantic hashes do not depend on binary floating-point formatting.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


MODEL_ACCESSION_RE = re.compile(r"^PF[0-9]{5}\.[0-9]+$")
QUERY_NAME_RE = re.compile(r"^sha256_[0-9a-f]{64}$")
HMM_ACCESSION_RE = re.compile(r"^ACC\s+(PF[0-9]{5}\.[0-9]+)\s*$")
HMM_GA_RE = re.compile(
    r"^GA\s+([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+))\s+"
    r"([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+));\s*$"
)

TBLOUT_FIELDS = (
    "target_name",
    "target_accession",
    "query_name",
    "query_accession",
    "full_evalue",
    "full_score",
    "full_bias",
    "best_domain_evalue",
    "best_domain_score",
    "best_domain_bias",
    "expected_domains",
    "regions",
    "clusters",
    "overlaps",
    "envelopes",
    "domains",
    "reported_domains",
    "included_domains",
)
DOMTBLOUT_FIELDS = (
    "target_name",
    "target_accession",
    "target_length",
    "query_name",
    "query_accession",
    "query_length",
    "full_evalue",
    "full_score",
    "full_bias",
    "domain_index",
    "domain_total",
    "conditional_evalue",
    "independent_evalue",
    "domain_score",
    "domain_bias",
    "hmm_from",
    "hmm_to",
    "alignment_from",
    "alignment_to",
    "envelope_from",
    "envelope_to",
    "accuracy",
)
TBLOUT_DECIMALS = {
    "full_evalue",
    "full_score",
    "full_bias",
    "best_domain_evalue",
    "best_domain_score",
    "best_domain_bias",
    "expected_domains",
}
TBLOUT_INTEGERS = {
    "regions",
    "clusters",
    "overlaps",
    "envelopes",
    "domains",
    "reported_domains",
    "included_domains",
}
DOMTBLOUT_DECIMALS = {
    "full_evalue",
    "full_score",
    "full_bias",
    "conditional_evalue",
    "independent_evalue",
    "domain_score",
    "domain_bias",
    "accuracy",
}
DOMTBLOUT_INTEGERS = {
    "target_length",
    "query_length",
    "domain_index",
    "domain_total",
    "hmm_from",
    "hmm_to",
    "alignment_from",
    "alignment_to",
    "envelope_from",
    "envelope_to",
}


class HmmerParseError(ValueError):
    """A blocking parser rejection with a stable reason code."""

    def __init__(
        self,
        *,
        path: Path,
        line_number: int,
        reason_code: str,
        message: str,
        raw_line: str = "",
    ) -> None:
        super().__init__(f"{path.name}:{line_number}: {reason_code}: {message}")
        self.path = path
        self.line_number = line_number
        self.reason_code = reason_code
        self.message = message
        self.raw_line = raw_line

    def as_record(self) -> dict[str, Any]:
        return {
            "source_path": self.path.name,
            "line_number": self.line_number,
            "reason_code": self.reason_code,
            "message": self.message,
            "raw_line": self.raw_line,
        }


@dataclass(frozen=True)
class ParsedHmmerTable:
    format_name: str
    records: tuple[dict[str, Any], ...]
    comment_lines: tuple[str, ...]
    program: str
    version: str


def canonical_decimal(value: Decimal) -> str:
    if not value.is_finite():
        raise ValueError("non-finite Decimal cannot be canonicalized")
    if value == 0:
        return "0"
    text = format(value.normalize(), "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def canonical_json_sha256(value: Any) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def command_sha256(argv: Sequence[str]) -> str:
    return canonical_json_sha256(list(argv))


def _decimal(
    token: str, path: Path, line_number: int, field: str, raw_line: str
) -> Decimal:
    try:
        value = Decimal(token)
    except InvalidOperation as exc:
        raise HmmerParseError(
            path=path,
            line_number=line_number,
            reason_code="malformed_numeric_field",
            message=f"{field} is not a Decimal: {token!r}",
            raw_line=raw_line,
        ) from exc
    if not value.is_finite():
        raise HmmerParseError(
            path=path,
            line_number=line_number,
            reason_code="malformed_numeric_field",
            message=f"{field} must be finite",
            raw_line=raw_line,
        )
    return value


def _integer(
    token: str, path: Path, line_number: int, field: str, raw_line: str
) -> int:
    if not re.fullmatch(r"[0-9]+", token):
        raise HmmerParseError(
            path=path,
            line_number=line_number,
            reason_code="malformed_numeric_field",
            message=f"{field} is not a non-negative integer: {token!r}",
            raw_line=raw_line,
        )
    return int(token)


def _normalize_description(value: str) -> str:
    return unicodedata.normalize("NFC", " ".join(value.split()))


def _header_value(comments: Iterable[str], label: str) -> str | None:
    prefix = f"# {label}:"
    for line in comments:
        if line.startswith(prefix):
            return line[len(prefix) :].strip()
    return None


def _validate_accessions(
    record: Mapping[str, Any],
    *,
    model_accessions: set[str],
    query_names: set[str],
    path: Path,
    line_number: int,
    raw_line: str,
) -> None:
    model = record["target_accession"]
    query = record["query_name"]
    if not isinstance(model, str) or not MODEL_ACCESSION_RE.fullmatch(model):
        raise HmmerParseError(
            path=path,
            line_number=line_number,
            reason_code="unknown_model_accession",
            message=f"invalid versioned Pfam accession: {model!r}",
            raw_line=raw_line,
        )
    if model not in model_accessions:
        raise HmmerParseError(
            path=path,
            line_number=line_number,
            reason_code="unknown_model_accession",
            message=f"Pfam accession is absent from the frozen model set: {model}",
            raw_line=raw_line,
        )
    if not isinstance(query, str) or not QUERY_NAME_RE.fullmatch(query):
        raise HmmerParseError(
            path=path,
            line_number=line_number,
            reason_code="unknown_query_name",
            message=f"invalid scan execution query name: {query!r}",
            raw_line=raw_line,
        )
    if query not in query_names:
        raise HmmerParseError(
            path=path,
            line_number=line_number,
            reason_code="unknown_query_name",
            message=f"query is absent from the frozen Pilot FASTA: {query}",
            raw_line=raw_line,
        )


def _validate_dom_coordinates(
    record: Mapping[str, Any], path: Path, line_number: int, raw_line: str
) -> None:
    target_length = record["target_length"]
    query_length = record["query_length"]
    domain_index = record["domain_index"]
    domain_total = record["domain_total"]
    valid = (
        target_length > 0
        and query_length > 0
        and 1 <= domain_index <= domain_total
        and 1 <= record["hmm_from"] <= record["hmm_to"] <= target_length
        and 1
        <= record["envelope_from"]
        <= record["alignment_from"]
        <= record["alignment_to"]
        <= record["envelope_to"]
        <= query_length
        and Decimal("0") <= record["accuracy"] <= Decimal("1")
    )
    if not valid:
        raise HmmerParseError(
            path=path,
            line_number=line_number,
            reason_code="invalid_coordinates",
            message="domain coordinates, ordinal, lengths or accuracy are inconsistent",
            raw_line=raw_line,
        )


def parse_hmmer_table(
    path: Path,
    *,
    format_name: str,
    model_accessions: set[str],
    query_names: set[str],
) -> ParsedHmmerTable:
    if format_name not in {"tblout", "domtblout"}:
        raise ValueError(f"unsupported format_name: {format_name}")
    fields = TBLOUT_FIELDS if format_name == "tblout" else DOMTBLOUT_FIELDS
    decimal_fields = TBLOUT_DECIMALS if format_name == "tblout" else DOMTBLOUT_DECIMALS
    integer_fields = TBLOUT_INTEGERS if format_name == "tblout" else DOMTBLOUT_INTEGERS
    comments: list[str] = []
    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    try:
        handle = path.open("r", encoding="utf-8", newline="")
    except (OSError, UnicodeError) as exc:
        raise HmmerParseError(
            path=path,
            line_number=0,
            reason_code="unrecognized_hmmer_format",
            message=str(exc),
        ) from exc
    with handle:
        for line_number, raw in enumerate(handle, 1):
            raw_line = raw.rstrip("\r\n")
            if not raw_line:
                continue
            if raw_line.startswith("#"):
                comments.append(raw_line)
                continue
            parts = raw_line.split(maxsplit=len(fields))
            if len(parts) < len(fields):
                raise HmmerParseError(
                    path=path,
                    line_number=line_number,
                    reason_code="unrecognized_hmmer_format",
                    message=(
                        f"expected {len(fields)} structured columns, observed {len(parts)}"
                    ),
                    raw_line=raw_line,
                )
            structured = parts[: len(fields)]
            description = parts[len(fields)] if len(parts) > len(fields) else ""
            record: dict[str, Any] = dict(zip(fields, structured))
            record["query_accession"] = (
                None if record["query_accession"] == "-" else record["query_accession"]
            )
            for field in decimal_fields:
                record[field] = _decimal(
                    record[field], path, line_number, field, raw_line
                )
            for field in integer_fields:
                record[field] = _integer(
                    record[field], path, line_number, field, raw_line
                )
            record["description"] = _normalize_description(description)
            _validate_accessions(
                record,
                model_accessions=model_accessions,
                query_names=query_names,
                path=path,
                line_number=line_number,
                raw_line=raw_line,
            )
            if format_name == "domtblout":
                _validate_dom_coordinates(record, path, line_number, raw_line)
            fingerprint = canonical_json_sha256(canonical_record(record))
            if fingerprint in seen:
                raise HmmerParseError(
                    path=path,
                    line_number=line_number,
                    reason_code="duplicate_record",
                    message="exact or semantic duplicate HMMER row",
                    raw_line=raw_line,
                )
            seen.add(fingerprint)
            records.append(record)
    program = _header_value(comments, "Program")
    version_raw = _header_value(comments, "Version")
    version = version_raw.split()[0] if version_raw else None
    if program != "hmmscan" or version != "3.4":
        raise HmmerParseError(
            path=path,
            line_number=0,
            reason_code="unrecognized_hmmer_format",
            message=f"required Program=hmmscan and Version=3.4; got {program!r}/{version!r}",
        )
    return ParsedHmmerTable(
        format_name=format_name,
        records=tuple(records),
        comment_lines=tuple(comments),
        program=program,
        version=version,
    )


def canonical_record(record: Mapping[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key in sorted(record):
        value = record[key]
        if isinstance(value, Decimal):
            result[key] = canonical_decimal(value)
        elif isinstance(value, str):
            result[key] = unicodedata.normalize("NFC", value)
        else:
            result[key] = value
    return result


def canonical_records(records: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    normalized = [canonical_record(record) for record in records]
    return sorted(
        normalized,
        key=lambda row: (
            str(row.get("query_name", "")),
            str(row.get("target_accession", "")),
            int(row.get("domain_index", 0)),
            int(row.get("alignment_from", 0)),
            int(row.get("alignment_to", 0)),
            str(row.get("independent_evalue", "")),
            str(row.get("domain_score", "")),
            canonical_json_sha256(row),
        ),
    )


def semantic_sha256(records: Iterable[Mapping[str, Any]]) -> str:
    return canonical_json_sha256(canonical_records(records))


def write_canonical_tsv(
    path: Path, records: Iterable[Mapping[str, Any]], fieldnames: Sequence[str]
) -> None:
    normalized = canonical_records(records)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=list(fieldnames),
            delimiter="\t",
            lineterminator="\n",
            extrasaction="raise",
        )
        writer.writeheader()
        writer.writerows(normalized)


def read_pfam_ga_thresholds(path: Path) -> dict[str, tuple[Decimal, Decimal]]:
    thresholds: dict[str, tuple[Decimal, Decimal]] = {}
    accession: str | None = None
    ga: tuple[Decimal, Decimal] | None = None
    with path.open("r", encoding="ascii", newline="") as handle:
        for line_number, raw in enumerate(handle, 1):
            line = raw.rstrip("\r\n")
            acc_match = HMM_ACCESSION_RE.match(line)
            if acc_match:
                if accession is not None:
                    raise ValueError(f"nested HMM ACC at line {line_number}")
                accession = acc_match.group(1)
                continue
            ga_match = HMM_GA_RE.match(line)
            if ga_match:
                if ga is not None:
                    raise ValueError(f"duplicate HMM GA at line {line_number}")
                ga = (Decimal(ga_match.group(1)), Decimal(ga_match.group(2)))
                continue
            if line == "//":
                if accession is None or ga is None:
                    raise ValueError(f"HMM model ending at line {line_number} lacks ACC or GA")
                if accession in thresholds:
                    raise ValueError(f"duplicate HMM accession: {accession}")
                thresholds[accession] = ga
                accession = None
                ga = None
    if accession is not None or ga is not None:
        raise ValueError("truncated final HMM record")
    if not thresholds:
        raise ValueError("no HMM GA thresholds found")
    return thresholds


def enrich_domain_records_with_ga(
    records: Iterable[Mapping[str, Any]],
    thresholds: Mapping[str, tuple[Decimal, Decimal]],
    *,
    scan_role: str,
) -> list[dict[str, Any]]:
    if scan_role not in {"authoritative", "diagnostic"}:
        raise ValueError(f"invalid scan_role: {scan_role}")
    enriched: list[dict[str, Any]] = []
    for source in records:
        record = dict(source)
        accession = record["target_accession"]
        if accession not in thresholds:
            raise ValueError(f"missing GA thresholds for {accession}")
        sequence_ga, domain_ga = thresholds[accession]
        sequence_pass = record["full_score"] >= sequence_ga
        domain_pass = record["domain_score"] >= domain_ga
        if scan_role == "authoritative" and not (sequence_pass and domain_pass):
            raise ValueError(
                f"authoritative --cut_ga row failed GA checks: {accession}/"
                f"{record['query_name']}"
            )
        record.update(
            {
                "scan_role": scan_role,
                "sequence_ga_threshold": sequence_ga,
                "domain_ga_threshold": domain_ga,
                "sequence_ga_pass": sequence_pass,
                "domain_ga_pass": domain_pass,
            }
        )
        enriched.append(record)
    return enriched
