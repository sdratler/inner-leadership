#!/usr/bin/env python3
"""Trusted-base PR source gate and explicitly reviewed protected bootstrap.

Ordinary pull_request_target executes only this trusted-base implementation.
Proposed files are fetched as bytes, hashed, and discarded. Only bounded JSON
policy/receipt data is interpreted after independent control-plane approval.
No proposed Python, JavaScript, shell, workflow or dependency is ever executed.
The bootstrap exception is a separately reviewed exact-head environment job.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
from datetime import datetime, timezone
import urllib.parse
from typing import Any
import audit

POLICY_PATH = "tools/source-audit/expected.json"
RECEIPT_PATH = "tools/source-audit/policy-receipt.json"
MAX_JSON = 256 * 1024
MAX_FILE = 4 * 1024 * 1024
MAX_FILES = 300
MARKER = re.compile(r"<!--\s*LIFE_SKILLS_WORK_REQUEST\s+(\{.{1,8192}?\})\s*-->", re.S)
GUARDED = ("tools/source-audit/", ".github/workflows/", "AGENTS.md", "railway.json",
           "apps/life-skills/docs/current-sources.json", "apps/life-skills/docs/historical/")


class GateError(Exception):
    """Only fixed neutral messages are exposed by the command line."""


def require(test: bool, code: str) -> None:
    if not test: raise GateError(code)


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def bounded_json(data: bytes) -> Any:
    require(isinstance(data, bytes) and 0 < len(data) <= MAX_JSON, "JSON_SIZE")
    def unique_pairs(pairs: list[tuple[str, Any]]) -> dict:
        result = {}
        for key, value in pairs:
            require(key not in result, "JSON_DUPLICATE_KEY")
            result[key] = value
        return result
    def reject_constant(value: str) -> None:
        raise GateError("JSON_NONFINITE")
    try:
        result = json.loads(data.decode("utf-8"), object_pairs_hook=unique_pairs, parse_constant=reject_constant)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise GateError("JSON_INVALID") from error
    def inspect(item: Any, depth: int = 0) -> None:
        require(depth <= 12, "JSON_DEPTH")
        if isinstance(item, dict):
            require(len(item) <= 1000, "JSON_OBJECT_SIZE")
            for key, value in item.items():
                require(isinstance(key, str) and len(key) <= 512, "JSON_KEY")
                inspect(value, depth + 1)
        elif isinstance(item, list):
            require(len(item) <= 2000, "JSON_ARRAY_SIZE")
            for value in item: inspect(value, depth + 1)
        elif isinstance(item, str):
            require(len(item) <= 8192, "JSON_STRING_SIZE")
        else:
            require(item is None or isinstance(item, (int, bool)), "JSON_VALUE_TYPE")
    inspect(result)
    return result


def safe_path(path: str) -> bool:
    if not isinstance(path, str) or not path or len(path) > 512: return False
    if "\\" in path or ":" in path or "\x00" in path or path.startswith("/"): return False
    parts = path.split("/")
    return all(part not in {"", ".", ".."} for part in parts) and str(PurePosixPath(path)) == path


def owns(path: str, roots: list[str]) -> bool:
    return safe_path(path) and any(path == root.rstrip("/") or path.startswith(root.rstrip("/") + "/") for root in roots)


def guarded(path: str) -> bool:
    return any(path == root or (root.endswith("/") and path.startswith(root)) for root in GUARDED)


def validate_policy(policy: dict) -> None:
    require(isinstance(policy, dict) and policy.get("schema_version") == 1, "POLICY_SCHEMA")
    require(policy.get("checker_version") == "2.0.0" and policy.get("cross_ledger_required") is True, "POLICY_CHECKER_REQUIREMENTS")
    require(0 < policy.get("max_snapshot_age_seconds", 0) <= 1800, "POLICY_FRESHNESS")
    require(set(policy.get("sources", {})) == set(audit.DOC_IDS), "POLICY_SOURCE_ALLOWLIST")
    require(audit.SHA64.fullmatch(str(policy.get("settings_sha256", ""))) is not None, "POLICY_SETTINGS")
    for key, source in policy["sources"].items():
        require(isinstance(source, dict) and source.get("id") == audit.DOC_IDS[key], "POLICY_SOURCE_ID")
        require(audit.SHA64.fullmatch(str(source.get("sha256", ""))) is not None, "POLICY_SOURCE_DIGEST")
        for field in ("required", "forbidden"):
            values = source.get(field, [])
            require(isinstance(values, list) and len(values) <= 50 and all(isinstance(v, str) and len(v) <= 512 for v in values), "POLICY_PATTERN_BOUNDS")
    for key in ("work_definitions", "approved_decisions", "interface_definitions"):
        require(isinstance(policy.get(key), dict) and all(audit.SHA64.fullmatch(str(v)) for v in policy[key].values()), "POLICY_FINGERPRINT")
    pending = policy.get("pending_canonical_decisions", {})
    require(isinstance(pending, dict) and len(pending) <= 20, "POLICY_PENDING_DECISIONS")
    for did, item in pending.items():
        require(isinstance(item, dict) and set(item) == {"decision_sha256", "state", "unaffected_work_ids", "source_sha256"}, "POLICY_PENDING_DECISION_FIELDS")
        require(item["state"] == "APPROVED_PROPAGATION_PENDING" and item["decision_sha256"] == policy["approved_decisions"].get(did), "POLICY_PENDING_DECISION_DIGEST")
        require(isinstance(item["unaffected_work_ids"], list) and len(item["unaffected_work_ids"]) <= 3 and set(item["unaffected_work_ids"]) <= {"SYS-033", "SYS-034", "SYS-021"}, "POLICY_PENDING_DECISION_SCOPE")
        require(isinstance(item["source_sha256"], dict) and bool(item["source_sha256"]) and all(k in audit.DOC_IDS and v == policy["sources"][k]["sha256"] for k, v in item["source_sha256"].items()), "POLICY_PENDING_SOURCE_BINDING")
    roots = policy.get("ownership_roots")
    require(isinstance(roots, dict), "POLICY_OWNERSHIP")
    for wid, paths in roots.items():
        require(audit.WORK_ID.fullmatch(wid) is not None and isinstance(paths, list) and len(paths) <= 80 and all(safe_path(p) for p in paths), "POLICY_OWNERSHIP")


def validate_receipt(receipt: dict, pins: list[list], base_policy: dict, result_policy: dict,
                     changed: dict[str, str | None], work_id: str, base_sha: str,
                     head_sha: str, now: datetime) -> dict:
    required = {"schema_version", "receipt_id", "repository", "base_sha", "base_policy_sha256", "result_policy_sha256",
                "work_ids", "created_at", "expires_at", "prepared_by", "changed_files_sha256", "decision_ids", "effect_limits"}
    require(isinstance(receipt, dict) and set(receipt) == required and receipt["schema_version"] == 1, "RECEIPT_SCHEMA")
    require(receipt["repository"] == audit.REPOSITORY and receipt["base_sha"] == base_sha, "RECEIPT_BASE")
    require(receipt["base_policy_sha256"] == canonical_hash(base_policy), "RECEIPT_BASE_POLICY")
    require(receipt["result_policy_sha256"] == canonical_hash(result_policy), "RECEIPT_RESULT_POLICY")
    require(isinstance(receipt["work_ids"], list) and work_id in receipt["work_ids"]
            and all(audit.WORK_ID.fullmatch(w) for w in receipt["work_ids"]), "RECEIPT_WORK_SCOPE")
    created, expiry = audit.parse_time(receipt["created_at"]), audit.parse_time(receipt["expires_at"])
    require(created <= now < expiry and 0 < (expiry-created).total_seconds() <= 48*3600, "RECEIPT_EXPIRED_OR_TIME")
    require(isinstance(receipt["prepared_by"], str) and bool(receipt["prepared_by"].strip()), "RECEIPT_PROPOSER")
    require(receipt["effect_limits"] == {"merge": False, "deploy": False, "paid_activation": False,
                                        "private_client_data": False, "consumer_unlock": False}, "RECEIPT_EFFECT_LIMITS")
    require(isinstance(receipt["decision_ids"], list) and 0 < len(receipt["decision_ids"]) <= 20
            and all(isinstance(v, str) and 0 < len(v) <= 100 for v in receipt["decision_ids"])
            and len(set(receipt["decision_ids"])) == len(receipt["decision_ids"]), "RECEIPT_DECISION_IDS")
    declared = receipt["changed_files_sha256"]
    actual = {p: h for p, h in changed.items() if p != RECEIPT_PATH}
    require(isinstance(declared, dict) and declared == actual and RECEIPT_PATH in changed, "RECEIPT_FILE_SET_OR_DIGEST")
    require(all(safe_path(p) and (h is None or audit.SHA64.fullmatch(str(h))) for p,h in declared.items()), "RECEIPT_FILE_PATH")
    matches = [audit.pad(r, 12) for r in pins[1:] if isinstance(r, list) and r and r[0] == receipt["receipt_id"]]
    require(len(matches) == 1, "RECEIPT_PIN_MISSING_OR_DUPLICATE")
    pin = matches[0]
    require(pin[1] == "Approved", "RECEIPT_NOT_INDEPENDENTLY_APPROVED")
    require(pin[2] == receipt["base_policy_sha256"] and pin[3] == receipt["result_policy_sha256"]
            and pin[4] == canonical_hash(receipt), "RECEIPT_PIN_DIGEST")
    pinned_work = {part.strip() for part in re.split(r"[,;]", pin[5]) if part.strip()}
    require(pinned_work == set(receipt["work_ids"]), "RECEIPT_PIN_SCOPE")
    require(audit.parse_time(pin[6]) == expiry, "RECEIPT_PIN_EXPIRY")
    require(bool(pin[7].strip()) and pin[7].strip() != receipt["prepared_by"].strip()
            and pin[8].startswith("https://"), "RECEIPT_INDEPENDENT_REVIEW_MISSING")
    # Binding the independent row to the head avoids circular hashes inside the commit.
    require(pin[9] == head_sha and audit.SHA40.fullmatch(head_sha) is not None, "RECEIPT_HEAD_NOT_PINNED")
    require(created <= audit.parse_time(pin[10]) <= now, "RECEIPT_PIN_TIME")
    return {"receipt_id": receipt["receipt_id"], "receipt_sha256": canonical_hash(receipt), "head_sha": head_sha,
            "independent_pin": "APPROVED_EXACT_HEAD", "expires_at": receipt["expires_at"]}


def work_request(body: str) -> dict:
    require(isinstance(body, str) and len(body) <= 65536, "PR_BODY_SIZE")
    markers = MARKER.findall(body)
    require(len(markers) == 1, "WORK_REQUEST_MISSING_OR_DUPLICATE")
    request = bounded_json(markers[0].encode())
    require(isinstance(request, dict) and set(request) == {"work_id", "claim_id", "starting_sha"}, "WORK_REQUEST_SCHEMA")
    require(audit.WORK_ID.fullmatch(str(request["work_id"])) is not None, "WORK_REQUEST_ID")
    require(isinstance(request["claim_id"], str) and re.fullmatch(r"[A-Za-z0-9_-]{8,100}", request["claim_id"]) is not None, "WORK_REQUEST_CLAIM")
    require(audit.SHA40.fullmatch(str(request["starting_sha"])) is not None, "WORK_REQUEST_BASE")
    return request


def validate_work(request: dict, snapshot: dict, policy: dict, changed: dict, head_sha: str, now: datetime) -> list[str]:
    rows = [audit.pad(r) for r in snapshot["control"]["Work Graph"][1:] if r and r[0] == request["work_id"]]
    require(len(rows) == 1, "WORK_ROW_MISSING_OR_DUPLICATE")
    row = rows[0]
    require(row[14] == "CODEX_INTEGRATION", "WORK_MODE_NOT_INTEGRATION")
    require(row[6] == request["starting_sha"], "WORK_STARTING_SHA_MISMATCH")
    require(audit.compact_hash(audit.definition(row)) == policy["work_definitions"].get(row[0]), "WORK_DEFINITION_NOT_REVIEWED")
    if row[5] in {"Claimed", "Integrating"}:
        require(row[15] == request["claim_id"] and bool(row[16]), "WORK_CLAIM_MISMATCH")
        start, expiry, updated = map(audit.parse_time, (row[17], row[18], row[19]))
        require(start <= updated <= now and start <= now < expiry and 0 < (expiry-start).total_seconds() <= 21600, "WORK_CLAIM_EXPIRED_OR_TIME")
    else:
        require(row[5] in {"Integrated", "Verified", "Deployed", "Owner accepted"} and not row[15] and row[11] == head_sha, "WORK_NO_LIVE_AUTHORITY")
        runs = [audit.pad(r, 26) for r in snapshot["control"]["Chat Runs"][1:] if r and r[0] == request["claim_id"]]
        require(len(runs) == 1 and runs[0][4] == row[0] and bool(runs[0][2]) and runs[0][19] == head_sha, "WORK_CLOSED_RUN_MISMATCH")
    roots = policy["ownership_roots"].get(row[0], [])
    require(bool(roots) and all(owns(path, roots) for path in changed), "PR_PATH_OUTSIDE_OWNERSHIP")
    # Explicit non-overlap even when another claim's definition is unrelated.
    for raw in snapshot["control"]["Work Graph"][1:]:
        other = audit.pad(raw)
        if not other[0] or other[0] == row[0] or not other[15]: continue
        require(audit.parse_time(other[18]) > now, "OTHER_CLAIM_NEEDS_RECOVERY")
        other_roots = policy["ownership_roots"].get(other[0], [])
        require(bool(other_roots), "OTHER_CLAIM_OWNERSHIP_UNKNOWN")
        require(not any(owns(path, other_roots) for path in changed), "PR_PATH_LIVE_CLAIM_OVERLAP")
    return roots


def api(path: str, token: str | None = None, data: bytes | None = None) -> Any:
    require(path.startswith("/") and ".." not in path.split("/"), "API_PATH")
    return audit.request_json("https://api.github.com/repos/" + audit.REPOSITORY + path, token, data=data)


def get_file(path: str, ref: str, token: str | None) -> bytes:
    require(safe_path(path) and audit.SHA40.fullmatch(ref) is not None, "FILE_LOCATOR")
    item = api("/contents/" + urllib.parse.quote(path, safe="/") + "?ref=" + ref, token)
    require(isinstance(item, dict) and item.get("type") == "file" and item.get("encoding") == "base64"
            and item.get("size", MAX_FILE+1) <= MAX_FILE, "FILE_UNREADABLE_OR_TOO_LARGE")
    try:
        raw = base64.b64decode(item["content"], validate=False)
    except (ValueError, KeyError, TypeError) as error:
        raise GateError("FILE_ENCODING") from error
    require(len(raw) <= MAX_FILE and len(raw) == item["size"], "FILE_SIZE")
    git_hash = hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
    require(git_hash == item.get("sha"), "FILE_GIT_BLOB_MISMATCH")
    return raw


def changed_files(pr_number: int, head: str, token: str | None) -> dict[str, str | None]:
    files = []
    for page in range(1, MAX_FILES//100 + 2):
        batch = api(f"/pulls/{pr_number}/files?per_page=100&page={page}", token)
        require(isinstance(batch, list), "PR_FILES_UNREADABLE")
        files.extend(batch)
        require(len(files) <= MAX_FILES, "PR_TOO_MANY_FILES")
        if len(batch) < 100: break
    result: dict[str, str | None] = {}
    for item in files:
        path = item.get("filename")
        require(safe_path(path) and path not in result, "PR_FILE_PATH_OR_DUPLICATE")
        status = item.get("status")
        require(status in {"added", "modified", "removed", "renamed", "changed"}, "PR_FILE_STATUS")
        if status == "renamed":
            previous = item.get("previous_filename")
            require(safe_path(previous) and previous not in result, "PR_RENAME_PATH")
            result[previous] = None
        result[path] = None if status == "removed" else hashlib.sha256(get_file(path, head, token)).hexdigest()
    require(bool(result), "PR_EMPTY_DIFF")
    return result


def run_gate(pr_number: int, bootstrap_head: str | None = None) -> dict:
    token = os.environ.get("GITHUB_TOKEN")
    require(bool(token), "GITHUB_TOKEN_UNAVAILABLE")
    pr = api(f"/pulls/{pr_number}", token)
    require(pr.get("state") == "open" and pr["base"]["repo"]["full_name"] == audit.REPOSITORY
            and pr["base"]["ref"] == "main", "PR_TARGET")
    head, base_sha = pr["head"]["sha"], pr["base"]["sha"]
    require(audit.SHA40.fullmatch(head) is not None and audit.SHA40.fullmatch(base_sha) is not None, "PR_SHAS")
    executing_sha = os.environ.get("GITHUB_SHA", "")
    if bootstrap_head:
        require(head == bootstrap_head == executing_sha, "BOOTSTRAP_HEAD_MISMATCH")
        require(os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "BOOTSTRAP_EVENT")
    else:
        require(os.environ.get("GITHUB_EVENT_NAME") == "pull_request_target" and executing_sha == base_sha, "TRUSTED_BASE_MISMATCH")
    # Bind the local checked-out code to the workflow's expected immutable commit.
    import subprocess
    actual_checkout = subprocess.run(["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True, timeout=10).stdout.strip()
    require(actual_checkout == executing_sha, "CHECKOUT_SHA_MISMATCH")
    base_policy = bounded_json(get_file(POLICY_PATH, base_sha, token))
    result_policy = bounded_json(get_file(POLICY_PATH, head, token))
    files = changed_files(pr_number, head, token)
    req = work_request(pr.get("body") or "")
    if bootstrap_head:
        require(req["work_id"] == "SYS-034", "BOOTSTRAP_WORK_SCOPE")
    # Read only the nine allowlisted non-client Docs and administrative controls.
    snapshot = audit.collect_live(base_policy)
    require(snapshot["git_head"] == base_sha, "MAIN_ADVANCED_REBASE_REQUIRED")
    now = audit.utcnow()
    receipt_evidence = None
    if canonical_hash(base_policy) != canonical_hash(result_policy) or any(guarded(p) for p in files):
        receipt = bounded_json(get_file(RECEIPT_PATH, head, token))
        receipt_evidence = validate_receipt(receipt, snapshot["control"]["Policy Receipts"], base_policy,
                                            result_policy, files, req["work_id"], base_sha, head, now)
    else:
        require(RECEIPT_PATH not in files, "UNEXPECTED_RECEIPT_CHANGE")
    validate_policy(result_policy)
    if receipt_evidence:
        approved = {audit.pad(r, 10)[0]: audit.pad(r, 10) for r in snapshot["control"]["Decisions"][1:] if audit.pad(r, 10)[3] == "Approved"}
        require(all(d in approved and audit.compact_hash(approved[d][:10]) == result_policy["approved_decisions"].get(d) for d in receipt["decision_ids"]), "RECEIPT_DECISION_NOT_CURRENT_APPROVED")
    validate_work(req, snapshot, result_policy, files, head, now)
    report = audit.audit(snapshot, result_policy, req["work_id"], req["starting_sha"], phase="audit", now=now)
    require(report["result"] == "PASS", "SOURCE_OR_LEDGER_AUDIT_BLOCKED")
    if req["work_id"] == "SYS-034":
        require(not any(f["code"] == "SECURITY_CONTAINMENT_UNVERIFIED" for f in report["findings"]), "SECURITY_CONTAINMENT_UNVERIFIED")
    latest = api(f"/pulls/{pr_number}", token)
    require(latest["head"]["sha"] == head and latest["base"]["sha"] == base_sha, "PR_CHANGED_DURING_CHECK")
    report.update({"head_sha": head, "base_sha": base_sha, "pr_number": pr_number,
                   "receipt": receipt_evidence, "checked_file_sha256": files,
                   "gate_mode": "reviewed_protected_bootstrap" if bootstrap_head else "trusted_base_data_only",
                   "proposed_application_code_executed": False, "reviewed_checker_bootstrap_executed": bool(bootstrap_head), "approval_scope": "CHECK_ONLY_NO_MERGE_NO_DEPLOY"})
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--bootstrap-head")
    parser.add_argument("--publish-status", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    report: dict
    try:
        require(args.pr > 0, "PR_NUMBER")
        report = run_gate(args.pr, args.bootstrap_head)
    except Exception as error:
        code = str(error) if isinstance(error, (GateError, audit.AuditError)) else "GATE_INPUT_OR_RUNTIME_ERROR"
        report = {"checker_version": "2.0.0", "checked_at": audit.utcnow().isoformat(), "result": "BLOCKED",
                  "capture_mode": "live_api", "findings": [{"code": code, "subject": "gate", "severity": "error"}]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as stream:
            stream.write("## Exact-head source gate: " + report["result"] + "\n\n")
            stream.write("```json\n" + json.dumps(report, ensure_ascii=False, indent=2) + "\n```\n")
    # No forced success: only the fully completed exact-head live check can emit success.
    if args.publish_status:
        try:
            token = os.environ.get("GITHUB_TOKEN")
            pr = api(f"/pulls/{args.pr}", token)
            head = pr["head"]["sha"]
            expected = args.bootstrap_head or (bounded_json(Path(os.environ["GITHUB_EVENT_PATH"]).read_bytes())["pull_request"]["head"]["sha"])
            require(head == expected, "STATUS_HEAD_CHANGED")
            success = report["result"] == "PASS" and report.get("head_sha") == head
            target = "https://github.com/" + audit.REPOSITORY + "/actions/runs/" + os.environ["GITHUB_RUN_ID"]
            api(f"/statuses/{head}", token, canonical({"state": "success" if success else "failure", "context": "source-integrity",
                 "description": "Reviewed exact-head source check passed" if success else "Source or approval gate blocked",
                 "target_url": target}))
        except (GateError, audit.AuditError, ValueError, KeyError, TypeError, OSError):
            print(json.dumps({"result": "BLOCKED", "code": "STATUS_PUBLISH_FAILED"}))
            return 1
    print(json.dumps({"result": report["result"], "checked_at": report["checked_at"],
                      "head_sha": report.get("head_sha"), "finding_count": len(report.get("findings", []))}))
    return 0 if report["result"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
