"""Strict RC2-B rule compiler and tri-state evaluator.

This module provides engineering infrastructure only. It does not contain or
approve any Gallus gallus ubiquitin classification rule.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import asdict, dataclass, replace
from decimal import Decimal, InvalidOperation
from enum import Enum
from pathlib import Path
from typing import Any, Iterable, Mapping


ENGINE_ID = "gf-rule-engine-1.0"
ALLOWED_OPERATORS = {
    "exists", "not_exists", "eq", "neq", "in", "not_in", "contains",
    "regex", "gt", "gte", "lt", "lte", "count_gte", "domain_present",
    "domain_absent", "domain_order",
}
COMPLETENESS_FIELDS = (
    "scan_complete", "database_known", "model_known", "threshold_known",
    "evidence_set_complete",
)
CONTEXT_HASH_FIELDS = {
    "source_artifact_hashes", "contract_bundle_hash", "rule_hash",
    "vocabulary_hash", "reason_registry_hash", "engine_commit",
    "dependency_lock_hash", "engine_config_hash",
}
EMITTED_TRACE_DIAGNOSTIC_CODES = frozenset({
    "alignment_coordinate_not_reported",
    "child_result_unknown",
    "evidence_completeness_unknown",
    "fact_not_reported",
    "fact_value_unknown",
    "required_domain_for_order_missing",
})


class ContractError(ValueError):
    """Raised when authoring data violates the executable contract."""


class NodeResult(str, Enum):
    TRUE = "true"
    FALSE = "false"
    UNKNOWN = "unknown"


class EvaluationOutcome(str, Enum):
    MATCHED = "matched"
    NOT_MATCHED = "not_matched"
    EXCLUDED = "excluded"
    CONFLICTED = "conflicted"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"
    NOT_EVALUABLE = "not_evaluable"


@dataclass(frozen=True)
class NodeTrace:
    node_id: str
    node_result: str
    observed_value: Any
    evidence_ids: tuple[str, ...] = ()
    failure_reason_code: str | None = None


@dataclass(frozen=True)
class EvaluationRecord:
    evaluation_id: str
    rule_id: str
    rule_version: str
    source_subject_namespace: str
    source_subject_identifier: str
    evaluation_outcome: str
    reason_code: str | None
    evidence_snapshot_hash: str
    evaluation_context_hash: str
    emitted_assertion_version_id: None
    traces: tuple[NodeTrace, ...]

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def canonical_json(value: Any) -> str:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    )


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _assert_plain_data(value: Any, path: str = "$") -> None:
    if value is None or isinstance(value, (str, bool, int)):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ContractError(f"{path}: NaN and Infinity are prohibited")
        raise ContractError(f"{path}: decimal authoring values must be strings, not floats")
    if isinstance(value, list):
        for index, item in enumerate(value):
            _assert_plain_data(item, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ContractError(f"{path}: mapping keys must be strings")
            _assert_plain_data(item, f"{path}.{key}")
        return
    raise ContractError(f"{path}: unsupported YAML/JSON value type {type(value).__name__}")


def load_authoring(path: Path, max_bytes: int = 2_000_000) -> dict[str, Any]:
    """Load JSON or a deliberately restricted, safe YAML subset."""

    raw = path.read_bytes()
    if len(raw) > max_bytes:
        raise ContractError(f"authoring file exceeds {max_bytes} bytes")
    text = raw.decode("utf-8")
    if path.suffix.lower() == ".json":
        value = json.loads(text)
    else:
        if re.search(r"(^|[\s\[{,])(?:!!?|[&*])[A-Za-z_]", text, flags=re.MULTILINE):
            raise ContractError("YAML tags, anchors and aliases are prohibited")
        try:
            import yaml  # type: ignore
        except ImportError as exc:
            raise ContractError("PyYAML is required only for non-JSON authoring files") from exc
        value = yaml.safe_load(text)
    _assert_plain_data(value)
    if not isinstance(value, dict):
        raise ContractError("authoring document root must be an object")
    return value


def _require_exact_keys(
    value: Mapping[str, Any], required: set[str], optional: set[str], path: str,
) -> None:
    missing = required - set(value)
    extra = set(value) - required - optional
    if missing:
        raise ContractError(f"{path}: missing fields {sorted(missing)}")
    if extra:
        raise ContractError(f"{path}: unknown fields {sorted(extra)}")


def validate_domain_vocabulary(data: Mapping[str, Any]) -> None:
    _require_exact_keys(
        data, {"vocabulary_id", "version", "status", "terms"},
        {"curator", "approved_by", "approval_date"}, "$",
    )
    if data["status"] not in {"draft", "approved", "deprecated"}:
        raise ContractError("$.status: invalid vocabulary status")
    if data["status"] == "approved" and not all(
        isinstance(data.get(field), str) and data.get(field)
        for field in ("curator", "approved_by", "approval_date")
    ):
        raise ContractError("approved vocabulary requires curator, approver and approval date")
    terms = data["terms"]
    if not isinstance(terms, list) or not terms:
        raise ContractError("$.terms: at least one controlled term is required")
    term_ids: set[str] = set()
    mappings: set[tuple[str, str, str | None, str | None]] = set()
    for index, term in enumerate(terms):
        path = f"$.terms[{index}]"
        if not isinstance(term, dict):
            raise ContractError(f"{path}: term must be an object")
        _require_exact_keys(
            term, {"term_id", "label", "definition", "mappings", "status"},
            {"replaced_by", "synonyms"}, path,
        )
        term_id = term["term_id"]
        if not isinstance(term_id, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]*:[A-Za-z0-9._-]+", term_id):
            raise ContractError(f"{path}.term_id: invalid controlled identifier")
        if term_id in term_ids:
            raise ContractError(f"{path}.term_id: duplicate {term_id}")
        term_ids.add(term_id)
        if term["status"] not in {"active", "deprecated"}:
            raise ContractError(f"{path}.status: invalid term status")
        if not isinstance(term["mappings"], list) or not term["mappings"]:
            raise ContractError(f"{path}.mappings: at least one accession is required")
        for map_index, mapping in enumerate(term["mappings"]):
            map_path = f"{path}.mappings[{map_index}]"
            if not isinstance(mapping, dict):
                raise ContractError(f"{map_path}: mapping must be an object")
            _require_exact_keys(
                mapping, {"database", "accession"},
                {"accession_version", "model_release"}, map_path,
            )
            key = (
                str(mapping["database"]), str(mapping["accession"]),
                mapping.get("accession_version"), mapping.get("model_release"),
            )
            if key in mappings:
                raise ContractError(f"{map_path}: duplicate accession mapping")
            mappings.add(key)
    for index, term in enumerate(terms):
        replacement = term.get("replaced_by")
        if replacement is not None and replacement not in term_ids:
            raise ContractError(f"$.terms[{index}].replaced_by: unknown term {replacement}")


def _walk_node(
    node: Mapping[str, Any], term_ids: set[str], node_ids: set[str],
    regex_registry: Mapping[str, str], path: str,
) -> None:
    if not isinstance(node, dict):
        raise ContractError(f"{path}: node must be an object")
    node_type = node.get("type")
    if node_type in {"all", "any"}:
        _require_exact_keys(node, {"node_id", "type", "children"}, set(), path)
        children = node["children"]
        if not isinstance(children, list) or not children:
            raise ContractError(f"{path}.children: cannot be empty")
    elif node_type == "not":
        _require_exact_keys(node, {"node_id", "type", "child"}, set(), path)
        children = [node["child"]]
    elif node_type == "predicate":
        _require_exact_keys(
            node, {"node_id", "type", "scope", "field", "operator", "value"}, set(), path,
        )
        children = []
        if node["scope"] != "same_protein":
            raise ContractError(f"{path}.scope: RC2-B v1 implements same_protein only")
        operator = node["operator"]
        if operator not in ALLOWED_OPERATORS:
            raise ContractError(f"{path}.operator: operator is not allow-listed")
        if operator in {"domain_present", "domain_absent"}:
            values = node["value"] if isinstance(node["value"], list) else [node["value"]]
            if not values or any(value not in term_ids for value in values):
                raise ContractError(f"{path}.value: domain predicate must use controlled term IDs")
        if operator == "domain_order":
            values = node["value"]
            if not isinstance(values, list) or len(values) < 2 or any(value not in term_ids for value in values):
                raise ContractError(f"{path}.value: domain_order requires controlled term IDs")
        if operator == "regex" and node["value"] not in regex_registry:
            raise ContractError(f"{path}.value: regex must reference an allow-listed pattern ID")
    else:
        raise ContractError(f"{path}.type: invalid node type")
    node_id = node.get("node_id")
    if not isinstance(node_id, str) or not node_id:
        raise ContractError(f"{path}.node_id: non-empty string required")
    if node_id in node_ids:
        raise ContractError(f"{path}.node_id: duplicate {node_id}")
    node_ids.add(node_id)
    for index, child in enumerate(children):
        _walk_node(child, term_ids, node_ids, regex_registry, f"{path}.children[{index}]")


def validate_rule_catalog(
    data: Mapping[str, Any], vocabulary: Mapping[str, Any],
    regex_registry: Mapping[str, str] | None = None,
) -> None:
    regex_registry = regex_registry or {}
    _require_exact_keys(
        data, {"catalog_id", "version", "status", "domain_vocabulary", "rules"}, set(), "$",
    )
    reference = data["domain_vocabulary"]
    if not isinstance(reference, dict):
        raise ContractError("$.domain_vocabulary: object required")
    _require_exact_keys(reference, {"vocabulary_id", "version", "sha256"}, set(), "$.domain_vocabulary")
    expected = (vocabulary["vocabulary_id"], vocabulary["version"], content_hash(vocabulary))
    actual = (reference["vocabulary_id"], reference["version"], reference["sha256"])
    if actual != expected:
        raise ContractError("$.domain_vocabulary: reference/hash does not match vocabulary")
    if data["status"] not in {"draft", "approved", "deprecated"}:
        raise ContractError("$.status: invalid catalog status")
    rules = data["rules"]
    if not isinstance(rules, list):
        raise ContractError("$.rules: array required")
    term_ids = {term["term_id"] for term in vocabulary["terms"]}
    identities: set[tuple[str, str]] = set()
    for index, rule in enumerate(rules):
        path = f"$.rules[{index}]"
        if not isinstance(rule, dict):
            raise ContractError(f"{path}: rule must be an object")
        _require_exact_keys(
            rule,
            {"rule_id", "version", "status", "rule_kind", "scheme_id", "priority", "scope", "root", "biological_definition", "references", "fixtures"},
            {"output_entry_id", "output_assertion_state", "unknown_outcome", "curator", "approved_by", "approval_date", "reason_code"},
            path,
        )
        identity = (rule["rule_id"], rule["version"])
        if identity in identities:
            raise ContractError(f"{path}: duplicate rule version")
        identities.add(identity)
        if rule["status"] not in {"draft", "approved", "deprecated", "retired"}:
            raise ContractError(f"{path}.status: invalid rule status")
        if rule["rule_kind"] not in {"inclusion", "exclusion"}:
            raise ContractError(f"{path}.rule_kind: invalid")
        if rule["scope"] != "same_protein":
            raise ContractError(f"{path}.scope: RC2-B v1 implements same_protein only")
        if not isinstance(rule["priority"], int) or isinstance(rule["priority"], bool):
            raise ContractError(f"{path}.priority: integer required")
        fixtures = rule["fixtures"]
        required_fixtures = {"positive", "negative", "boundary", "missing_evidence", "conflicting_evidence"}
        if not isinstance(fixtures, dict) or set(fixtures) != required_fixtures:
            raise ContractError(f"{path}.fixtures: five fixture classes are required")
        if any(not isinstance(fixtures[name], list) or not fixtures[name] for name in required_fixtures):
            raise ContractError(f"{path}.fixtures: each fixture class must be non-empty")
        if rule["status"] == "approved":
            required_approval = ("curator", "approved_by", "approval_date")
            if not all(isinstance(rule.get(field), str) and rule.get(field) for field in required_approval):
                raise ContractError(f"{path}: approved rule lacks scientific sign-off")
            if not rule["biological_definition"] or not rule["references"]:
                raise ContractError(f"{path}: approved rule lacks definition/references")
        _walk_node(rule["root"], term_ids, set(), regex_registry, f"{path}.root")


def compile_rule_bundle(
    vocabulary: Mapping[str, Any], catalog: Mapping[str, Any],
    *, contract_bundle_hash: str, reason_registry_hash: str,
    regex_registry: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Validate authoring input and emit the only JSON form the evaluator accepts."""

    _assert_plain_data(vocabulary)
    _assert_plain_data(catalog)
    for label, value in {
        "contract_bundle_hash": contract_bundle_hash,
        "reason_registry_hash": reason_registry_hash,
    }.items():
        if not re.fullmatch(r"[0-9a-f]{64}", value):
            raise ContractError(f"{label} must be a lowercase SHA-256")
    validate_domain_vocabulary(vocabulary)
    validate_rule_catalog(catalog, vocabulary, regex_registry)
    sorted_terms = sorted(
        (
            {
                **term,
                "mappings": sorted(
                    term["mappings"],
                    key=lambda item: (
                        item["database"], item["accession"],
                        item.get("accession_version") or "", item.get("model_release") or "",
                    ),
                ),
                **({"synonyms": sorted(term.get("synonyms", []))} if "synonyms" in term else {}),
            }
            for term in vocabulary["terms"]
        ),
        key=lambda item: item["term_id"],
    )
    sorted_rules = sorted(catalog["rules"], key=lambda item: (item["rule_id"], item["version"]))
    accession_index: dict[str, list[str]] = {}
    for term in sorted_terms:
        for mapping in term["mappings"]:
            key = f"{mapping['database']}:{mapping['accession']}"
            accession_index.setdefault(key, []).append(term["term_id"])
    bundle = {
        "compiled_format": "gf-canonical-rule-bundle-1.0",
        "compiler_id": ENGINE_ID,
        "contract_bundle_hash": contract_bundle_hash,
        "reason_registry_hash": reason_registry_hash,
        "vocabulary": {
            "vocabulary_id": vocabulary["vocabulary_id"],
            "version": vocabulary["version"],
            "status": vocabulary["status"],
            "authoring_hash": content_hash(vocabulary),
            "terms": sorted_terms,
            "accession_index": {key: sorted(value) for key, value in sorted(accession_index.items())},
        },
        "catalog": {
            "catalog_id": catalog["catalog_id"],
            "version": catalog["version"],
            "status": catalog["status"],
            "authoring_hash": content_hash(catalog),
            "rules": sorted_rules,
        },
        "regex_registry": dict(sorted((regex_registry or {}).items())),
    }
    bundle["compiled_content_hash"] = content_hash(bundle)
    return bundle


def write_compiled_bundle(bundle: Mapping[str, Any], path: Path) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(canonical_json(bundle) + "\n")


def strong_not(value: NodeResult) -> NodeResult:
    return {NodeResult.TRUE: NodeResult.FALSE, NodeResult.FALSE: NodeResult.TRUE}.get(value, NodeResult.UNKNOWN)


def strong_and(values: Iterable[NodeResult]) -> NodeResult:
    values = tuple(values)
    if any(value is NodeResult.FALSE for value in values):
        return NodeResult.FALSE
    if any(value is NodeResult.UNKNOWN for value in values):
        return NodeResult.UNKNOWN
    return NodeResult.TRUE


def strong_or(values: Iterable[NodeResult]) -> NodeResult:
    values = tuple(values)
    if any(value is NodeResult.TRUE for value in values):
        return NodeResult.TRUE
    if any(value is NodeResult.UNKNOWN for value in values):
        return NodeResult.UNKNOWN
    return NodeResult.FALSE


def evaluation_context_hash(context: Mapping[str, Any]) -> str:
    if set(context) != CONTEXT_HASH_FIELDS:
        raise ContractError(
            f"evaluation context fields must be exactly {sorted(CONTEXT_HASH_FIELDS)}"
        )
    hashes = context["source_artifact_hashes"]
    if not isinstance(hashes, dict) or not hashes:
        raise ContractError("evaluation context requires source artifact hashes")
    hash_fields = {
        "contract_bundle_hash", "rule_hash", "vocabulary_hash",
        "reason_registry_hash", "dependency_lock_hash", "engine_config_hash",
    }
    for key, value in context.items():
        if key == "source_artifact_hashes":
            if any(not re.fullmatch(r"[0-9a-f]{64}", item) for item in value.values()):
                raise ContractError("source artifact hashes must be lowercase SHA-256")
        elif key in hash_fields and (
            not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value)
        ):
            raise ContractError(f"evaluation context field {key} must be a lowercase SHA-256")
        elif key == "engine_commit" and (
            not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{40,64}", value)
        ):
            raise ContractError("evaluation context engine_commit must be a full Git object ID")
        elif not isinstance(value, str) or not value:
            raise ContractError(f"evaluation context field {key} must be a non-empty string")
    return content_hash(context)


def _complete(evidence: Mapping[str, Any], capability: str | None = None) -> bool:
    completeness = evidence.get("completeness", {})
    base_complete = all(
        completeness.get(field) is True for field in COMPLETENESS_FIELDS
    )
    return base_complete and (
        capability is None or completeness.get(capability) is True
    )


def _passing(value: Any) -> NodeResult:
    if value is True or value == "true":
        return NodeResult.TRUE
    if value is False or value == "false":
        return NodeResult.FALSE
    return NodeResult.UNKNOWN


def _capability_passing(hit: Mapping[str, Any], capability: str) -> NodeResult:
    admissible = hit.get(capability)
    if admissible is True:
        return _passing(hit.get("threshold_pass"))
    if admissible is False:
        return NodeResult.FALSE
    return NodeResult.UNKNOWN


def _domain_hits(
    term_ids: set[str], evidence: Mapping[str, Any], accession_index: Mapping[str, list[str]],
) -> list[Mapping[str, Any]]:
    hits: list[Mapping[str, Any]] = []
    for hit in evidence.get("domains", []):
        key = f"{hit.get('database')}:{hit.get('accession')}"
        if term_ids.intersection(accession_index.get(key, [])):
            hits.append(hit)
    return hits


def _as_decimal(value: Any) -> Decimal:
    if isinstance(value, bool):
        raise ContractError("boolean cannot be used as a decimal")
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ContractError(f"invalid decimal value: {value!r}") from exc
    if not result.is_finite():
        raise ContractError("NaN and Infinity are prohibited")
    return result


def _eval_predicate(
    node: Mapping[str, Any], evidence: Mapping[str, Any],
    accession_index: Mapping[str, list[str]], regex_registry: Mapping[str, str],
) -> tuple[NodeResult, Any, tuple[str, ...], str | None]:
    operator = node["operator"]
    target = node["value"]
    if operator in {"domain_present", "domain_absent", "domain_order"}:
        term_values = target if isinstance(target, list) else [target]
        hits = _domain_hits(set(term_values), evidence, accession_index)
        evidence_ids = tuple(sorted({str(hit["evidence_id"]) for hit in hits if hit.get("evidence_id")}))
        observed = {
            "controlled_terms": term_values,
            "matching_hit_count": len(hits),
            "completeness": evidence.get("completeness", {}),
        }
        passing = [
            _capability_passing(hit, "admissible_for_presence") for hit in hits
        ]
        if operator == "domain_present":
            if NodeResult.TRUE in passing:
                return NodeResult.TRUE, observed, evidence_ids, None
            if NodeResult.UNKNOWN in passing or not _complete(
                evidence, "presence_admissibility_known"
            ):
                return NodeResult.UNKNOWN, observed, evidence_ids, "evidence_completeness_unknown"
            return NodeResult.FALSE, observed, evidence_ids, None
        if operator == "domain_absent":
            if NodeResult.TRUE in passing:
                return NodeResult.FALSE, observed, evidence_ids, None
            if NodeResult.UNKNOWN in passing or not _complete(
                evidence, "absence_admissibility_known"
            ):
                return NodeResult.UNKNOWN, observed, evidence_ids, "evidence_completeness_unknown"
            return NodeResult.TRUE, observed, evidence_ids, None
        ordered_hits: list[tuple[str, int, str]] = []
        for term_id in term_values:
            term_hits = _domain_hits({term_id}, evidence, accession_index)
            candidates = [
                hit for hit in term_hits
                if _capability_passing(hit, "admissible_for_domain_order") is NodeResult.TRUE
            ]
            if not candidates:
                result = NodeResult.FALSE if _complete(
                    evidence, "domain_order_admissibility_known"
                ) else NodeResult.UNKNOWN
                return result, observed, evidence_ids, "required_domain_for_order_missing"
            if any(hit.get("ali_from") is None for hit in candidates):
                return NodeResult.UNKNOWN, observed, evidence_ids, "alignment_coordinate_not_reported"
            first = min(candidates, key=lambda hit: int(hit["ali_from"]))
            ordered_hits.append((term_id, int(first["ali_from"]), str(first.get("evidence_id", ""))))
        observed["selected_order"] = ordered_hits
        result = NodeResult.TRUE if [item[1] for item in ordered_hits] == sorted(item[1] for item in ordered_hits) else NodeResult.FALSE
        return result, observed, tuple(item[2] for item in ordered_hits if item[2]), None

    fact = evidence.get("facts", {}).get(node["field"])
    if not isinstance(fact, dict):
        return NodeResult.UNKNOWN, {"value_status": "not_reported"}, (), "fact_not_reported"
    status = fact.get("value_status")
    observed_value = fact.get("value")
    evidence_ids = tuple(sorted(str(item) for item in fact.get("evidence_ids", [])))
    if status not in {"observed", "derived"}:
        if operator == "exists" and status == "not_applicable":
            return NodeResult.FALSE, fact, evidence_ids, None
        if operator == "not_exists" and status == "not_applicable":
            return NodeResult.TRUE, fact, evidence_ids, None
        return NodeResult.UNKNOWN, fact, evidence_ids, "fact_value_unknown"
    if operator == "exists":
        result = True
    elif operator == "not_exists":
        result = False
    elif operator == "eq":
        result = observed_value == target
    elif operator == "neq":
        result = observed_value != target
    elif operator == "in":
        result = observed_value in target
    elif operator == "not_in":
        result = observed_value not in target
    elif operator == "contains":
        result = target in observed_value
    elif operator == "regex":
        result = re.fullmatch(regex_registry[target], str(observed_value)) is not None
    elif operator in {"gt", "gte", "lt", "lte"}:
        left, right = _as_decimal(observed_value), _as_decimal(target)
        result = {"gt": left > right, "gte": left >= right, "lt": left < right, "lte": left <= right}[operator]
    elif operator == "count_gte":
        result = len(observed_value) >= int(target)
    else:
        raise ContractError(f"operator {operator} is not implemented for ordinary facts")
    return (NodeResult.TRUE if result else NodeResult.FALSE), fact, evidence_ids, None


def _eval_node(
    node: Mapping[str, Any], evidence: Mapping[str, Any],
    accession_index: Mapping[str, list[str]], regex_registry: Mapping[str, str],
    traces: list[NodeTrace],
) -> NodeResult:
    node_type = node["type"]
    if node_type == "predicate":
        result, observed, evidence_ids, failure = _eval_predicate(node, evidence, accession_index, regex_registry)
    else:
        children = node["children"] if node_type in {"all", "any"} else [node["child"]]
        child_results = [
            _eval_node(child, evidence, accession_index, regex_registry, traces)
            for child in children
        ]
        if node_type == "all":
            result = strong_and(child_results)
        elif node_type == "any":
            result = strong_or(child_results)
        else:
            result = strong_not(child_results[0])
        observed = {"child_results": [item.value for item in child_results]}
        evidence_ids = ()
        failure = "child_result_unknown" if result is NodeResult.UNKNOWN else None
    traces.append(NodeTrace(node["node_id"], result.value, observed, evidence_ids, failure))
    return result


def evaluate_rule(
    rule: Mapping[str, Any], compiled_bundle: Mapping[str, Any],
    evidence: Mapping[str, Any], context: Mapping[str, Any],
) -> EvaluationRecord:
    """Evaluate one compiler-validated rule without emitting an assertion."""

    if compiled_bundle.get("compiled_format") != "gf-canonical-rule-bundle-1.0":
        raise ContractError("evaluator accepts canonical compiled bundles only")
    expected_hash = compiled_bundle.get("compiled_content_hash")
    unhashed = {key: value for key, value in compiled_bundle.items() if key != "compiled_content_hash"}
    if expected_hash != content_hash(unhashed):
        raise ContractError("compiled rule bundle hash mismatch")
    if rule not in compiled_bundle.get("catalog", {}).get("rules", []):
        raise ContractError("rule is not a member of the compiled bundle")
    rule_hash = content_hash(rule)
    if context.get("rule_hash") != rule_hash:
        raise ContractError("evaluation context rule_hash does not match rule")
    if context.get("vocabulary_hash") != compiled_bundle["vocabulary"]["authoring_hash"]:
        raise ContractError("evaluation context vocabulary_hash does not match bundle")
    if context.get("contract_bundle_hash") != compiled_bundle["contract_bundle_hash"]:
        raise ContractError("evaluation context contract_bundle_hash does not match bundle")
    if context.get("reason_registry_hash") != compiled_bundle["reason_registry_hash"]:
        raise ContractError("evaluation context reason_registry_hash does not match bundle")
    context_hash = evaluation_context_hash(context)
    evidence_hash = content_hash(evidence)
    subject = evidence.get("subject", {})
    namespace = subject.get("namespace")
    identifier = subject.get("identifier")
    if not isinstance(namespace, str) or not isinstance(identifier, str):
        raise ContractError("evidence subject namespace and identifier are required")
    traces: list[NodeTrace] = []
    result = _eval_node(
        rule["root"], evidence, compiled_bundle["vocabulary"]["accession_index"],
        compiled_bundle.get("regex_registry", {}), traces,
    )
    if result is NodeResult.TRUE:
        outcome = EvaluationOutcome.EXCLUDED if rule["rule_kind"] == "exclusion" else EvaluationOutcome.MATCHED
    elif result is NodeResult.FALSE:
        outcome = EvaluationOutcome.NOT_MATCHED
    else:
        outcome = EvaluationOutcome(rule.get("unknown_outcome", "insufficient_evidence"))
    evaluation_id = "gfre1:" + content_hash({
        "rule_id": rule["rule_id"], "rule_version": rule["version"],
        "source_subject_namespace": namespace, "source_subject_identifier": identifier,
        "evidence_snapshot_hash": evidence_hash, "evaluation_context_hash": context_hash,
    })
    return EvaluationRecord(
        evaluation_id=evaluation_id,
        rule_id=rule["rule_id"], rule_version=rule["version"],
        source_subject_namespace=namespace, source_subject_identifier=identifier,
        evaluation_outcome=outcome.value, reason_code=rule.get("reason_code"),
        evidence_snapshot_hash=evidence_hash, evaluation_context_hash=context_hash,
        emitted_assertion_version_id=None, traces=tuple(traces),
    )


def evaluate_catalog(
    compiled_bundle: Mapping[str, Any], evidence: Mapping[str, Any],
    context_base: Mapping[str, Any],
) -> tuple[EvaluationRecord, ...]:
    """Evaluate every rule independently, then mark equal-priority output conflicts."""

    rules = compiled_bundle["catalog"]["rules"]
    records: list[EvaluationRecord] = []
    for rule in rules:
        context = dict(context_base)
        context["rule_hash"] = content_hash(rule)
        records.append(evaluate_rule(rule, compiled_bundle, evidence, context))
    matched = [
        (index, rule) for index, (record, rule) in enumerate(zip(records, rules))
        if record.evaluation_outcome == EvaluationOutcome.MATCHED.value
    ]
    if matched:
        highest = max(rule["priority"] for _, rule in matched)
        top = [(index, rule) for index, rule in matched if rule["priority"] == highest]
        outputs = {rule.get("output_entry_id") for _, rule in top}
        if len(outputs) > 1:
            for index, _ in top:
                records[index] = replace(records[index], evaluation_outcome=EvaluationOutcome.CONFLICTED.value)
    return tuple(records)
