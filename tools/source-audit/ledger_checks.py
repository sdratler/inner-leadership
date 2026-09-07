"""Cross-ledger assertions. Evidence labels never manufacture provider verification.

This module consumes only administrative rows already read by the fixed allowlist.
It emits neutral codes and IDs; it neither writes controls nor contacts a runtime.
"""
from __future__ import annotations
from datetime import datetime
import re
from typing import Any

SHA40 = re.compile(r"[0-9a-f]{40}\Z")
SHA64 = re.compile(r"[0-9a-f]{64}\Z")
TERMINAL = {"Integrated", "Verified", "Deployed", "Owner accepted"}
ACTIVE = {"Ready", "Claimed", "Code generating", "Integrating"}
HEADERS = {
    "Work Graph": "Work ID", "Decisions": "Decision ID", "Interfaces": "Interface ID",
    "Merge Packets": "Packet ID", "Releases": "Release", "Chat Runs": "Run ID",
    "Change Log": "Timestamp", "Policy Receipts": "Receipt ID",
}
REQUIRED_INTERFACES = ("I-001", "I-002", "I-003", "I-011", "I-013", "I-014")
CONSUMERS = {"LS-030", "LS-040", "LS-050", "LS-060", "LS-080"}


def pad(row: list[Any], width: int = 26) -> list[str]:
    return ["" if v is None else str(int(v)) if isinstance(v, float) and v.is_integer() else str(v) for v in row] + [""] * max(0, width-len(row))


def url(value: str) -> bool:
    return value.startswith("https://") and len(value) > 12


def has_positive_test_evidence(value: str) -> bool:
    text = value.strip().upper()
    return bool(text) and not any(t in text for t in ("NOT RUN", "UNVERIFIED", "PENDING", "NOT TESTED")) and any(t in text for t in ("PASS", "PASSED", "SUCCESS"))


def check_ledgers(snapshot: dict, rows: dict, graph: dict, relevant: set[str], now: datetime, strict_global: bool = False) -> list[dict]:
    del graph, now  # Lifecycle time is checked by audit.py; no hidden timestamp assumptions here.
    findings: list[dict] = []
    control = snapshot.get("control", {})
    def add(code: str, subject: str = "control", severity: str = "error") -> None:
        findings.append({"code": code, "subject": subject, "severity": severity})
    for name, first in HEADERS.items():
        data = control.get(name)
        if not isinstance(data, list) or not data or not isinstance(data[0], list) or not data[0] or data[0][0] != first:
            add("LEDGER_UNREADABLE", name.replace(" ", "_"))
            continue
        if name == "Change Log":
            continue  # More than one change can share a timestamp.
        seen: set[str] = set()
        for raw in data[1:]:
            if not isinstance(raw, list):
                add("LEDGER_ROW_MALFORMED", name.replace(" ", "_")); continue
            key = pad(raw)[0]
            if key and key in seen:
                add("LEDGER_DUPLICATE_ID", name.replace(" ", "_"))
            if key: seen.add(key)
    runs = [pad(r) for r in control.get("Chat Runs", [])[1:] if isinstance(r, list)]
    packets = [pad(r) for r in control.get("Merge Packets", [])[1:] if isinstance(r, list)]
    releases = [pad(r) for r in control.get("Releases", [])[1:] if isinstance(r, list)]
    interfaces = {pad(r)[0]: pad(r) for r in control.get("Interfaces", [])[1:] if isinstance(r, list) and r}
    reachable = snapshot.get("reachable", {})
    for wid, row in rows.items():
        if row[14] != "CODEX_INTEGRATION" or row[5] not in TERMINAL:
            continue
        result = row[11]
        if not SHA40.fullmatch(result) or reachable.get(result) is not True:
            add("INTEGRATION_RESULT_UNVERIFIED", wid)
        matching = [r for r in runs if r[4] == wid and r[2] and r[19] == result and r[13].strip()
                    and ((r[3] == "EVIDENCE_RECONCILIATION" and url(r[20]) and bool(r[21]))
                         or (any(r[9].startswith(state) for state in TERMINAL) and url(r[20])))]
        if not matching:
            add("COMPLETED_INTEGRATION_RUN_MISSING", wid)
        elif all(r[3] == "EVIDENCE_RECONCILIATION" for r in matching):
            add("INTEGRATION_RUN_RECONSTRUCTED", wid, "warning")
        for dep, required in _dependencies(row[4]):
            if required != "Packet ready": continue
            matches = [p for p in packets if p[1] == dep and p[10] == result and p[8] in TERMINAL]
            if not matches:
                add("PRODUCER_INTEGRATION_RECORD_MISSING", wid)
        if row[5] in {"Verified", "Deployed", "Owner accepted"} and snapshot.get("main_contains", {}).get(result) is not True:
            add("ACCEPTED_RESULT_NOT_ON_MAIN", wid)
        if row[5] == "Deployed":
            entries = [r for r in releases if r[13] == wid and r[3] == result]
            if not entries:
                add("DEPLOYMENT_RELEASE_MISSING", wid)
            for release in entries:
                # Historical reconstruction is retained but never promoted to fresh proof.
                if "REPORTED" in release[18] or "HISTORICAL" in release[18]:
                    add("PROVIDER_EVIDENCE_HISTORICAL", wid, "warning")
                    continue
                if not all((release[1], release[2], release[15], release[16], release[23], release[24])) \
                   or not url(release[7]) or not url(release[8]) or not url(release[20]) \
                   or not SHA40.fullmatch(release[10]) or not has_positive_test_evidence(release[9]):
                    add("DEPLOYMENT_EVIDENCE_INCOMPLETE", wid)
    for iid, item in interfaces.items():
        if item[5] not in {"Frozen", "Accepted", "Verified"}: continue
        if not SHA64.fullmatch(item[9]) or not SHA40.fullmatch(item[10]) \
           or reachable.get(item[10]) is not True or not has_positive_test_evidence(item[11]) or not url(item[12]):
            add("INTERFACE_FREEZE_EVIDENCE_MISSING", iid)
    for wid in relevant & CONSUMERS:
        if rows.get(wid, [""]*23)[5] not in ACTIVE: continue
        producer = rows.get("LS-025", [""]*23)
        if producer[5] not in {"Verified", "Deployed", "Owner accepted"} \
           or snapshot.get("main_contains", {}).get(producer[11]) is not True:
            add("CONSUMER_ACCEPTED_MAIN_MISSING", wid)
        for iid in REQUIRED_INTERFACES:
            item = interfaces.get(iid, [""]*26)
            if item[5] not in {"Frozen", "Accepted", "Verified"}:
                add("CONSUMER_INTERFACE_NOT_ACCEPTED", wid)
    # The private revocation observation is a separate required administrative gate.
    # Ordinary unaffected worker scopes do not require this security remediation to be finished.
    if "SYS-034" in relevant:
        gate = [r for r in releases if r[0] == "SECURITY-exposed_pat_revoked"]
        if len(gate) != 1 or gate[0][5] != "Verified" or gate[0][18] != "PROVIDER_VERIFIED" or not url(gate[0][20]):
            add("SECURITY_CONTAINMENT_UNVERIFIED", "SYS-034", "error" if strict_global else "warning")
    return findings


def _dependencies(text: str) -> list[tuple[str, str]]:
    result = []
    for part in text.split(";"):
        key, sep, state = part.strip().partition(":")
        if sep: result.append((key, state))
    return result
