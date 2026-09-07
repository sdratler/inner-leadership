#!/usr/bin/env python3
"""Derive the exact phase/baseline/producer ZIP arguments from a fresh owned row.

Use --snapshot for credential-free preparation of a not-yet-installed checker.
Live mode is permitted only after the exact implementation has passed independent
review. This command never claims work or edits Drive/Git.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys
import audit


def derive(snapshot: dict, work_id: str, claim_id: str | None, preclaim: bool = False) -> tuple[str, str, list[tuple[str,str]]]:
    matches = [audit.pad(r) for r in snapshot.get("control", {}).get("Work Graph", [])[1:] if r and r[0] == work_id]
    if len(matches) != 1: raise audit.AuditError("WORK_ROW_MISSING_OR_DUPLICATE")
    row = matches[0]
    if preclaim:
        if row[5] != "Ready" or row[15] or claim_id: raise audit.AuditError("PRECLAIM_NOT_READY_OR_OVERLAP")
    elif row[5] not in audit.LEASED or row[15] != claim_id or not claim_id:
        raise audit.AuditError("OWNED_CLAIM_REQUIRED")
    if row[14] not in {"GPT_PACKET", "GPT_ARTIFACT", "CODEX_INTEGRATION"}:
        raise audit.AuditError("EXECUTION_MODE_UNSUPPORTED")
    if not audit.SHA40.fullmatch(row[6]): raise audit.AuditError("EXACT_BASELINE_MISSING")
    phase = "integrate" if row[14] == "CODEX_INTEGRATION" else "prepare"
    return phase, row[6], audit.deps(row[4])


def producer_packets(snapshot: dict, dependencies: list[tuple[str,str]], directory: Path | None) -> dict[str,Path]:
    needed = [wid for wid,state in dependencies if state == "Packet ready"]
    if not needed: return {}
    if directory is None or not directory.is_dir(): raise audit.AuditError("PRODUCER_PACKET_DIRECTORY_REQUIRED")
    files = [p for p in directory.iterdir() if p.is_file() and p.suffix.lower() == ".zip" and not p.is_symlink()]
    if len(files) > 50: raise audit.AuditError("PRODUCER_PACKET_DIRECTORY_TOO_LARGE")
    by_hash: dict[str, list[Path]] = {}
    for p in files:
        if p.stat().st_size > 128*1024*1024: continue
        by_hash.setdefault(hashlib.sha256(p.read_bytes()).hexdigest(), []).append(p)
    rows = {r[0]: audit.pad(r) for r in snapshot["control"]["Work Graph"][1:] if r}
    result = {}
    for wid in needed:
        row = rows.get(wid)
        if not row or not audit.SHA64.fullmatch(row[20]): raise audit.AuditError("PRODUCER_DIGEST_NOT_RECORDED")
        paths = by_hash.get(row[20], [])
        if not paths: raise audit.AuditError("PRODUCER_ZIP_NOT_VERIFIED")
        selected = paths[0]
        if audit.verify_zip(selected, row[20]): raise audit.AuditError("PRODUCER_INVENTORY_FAILED")
        result[wid] = selected
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-id", required=True)
    parser.add_argument("--claim-id")
    parser.add_argument("--preclaim", action="store_true")
    parser.add_argument("--snapshot", type=Path)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--manifest", type=Path, default=Path(__file__).with_name("expected.json"))
    parser.add_argument("--packet-dir", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if bool(args.snapshot) == bool(args.live): raise audit.AuditError("EXACTLY_ONE_CAPTURE_MODE_REQUIRED")
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        snapshot = audit.collect_live(manifest) if args.live else json.loads(args.snapshot.read_text(encoding="utf-8"))
        phase, baseline, dependencies = derive(snapshot, args.work_id, args.claim_id, args.preclaim)
        packets = producer_packets(snapshot, dependencies, args.packet_dir) if phase == "integrate" else {}
        result = audit.audit(snapshot, manifest, args.work_id, baseline, phase, packets)
        result["arguments_derived_from_live_row"] = True
        result["producer_ids_verified"] = sorted(packets)
        result["authorizes_merge_or_deploy"] = False
    except Exception as error:
        result = {"result": "BLOCKED", "checked_at": audit.utcnow().isoformat(), "findings": [
            {"code": str(error) if isinstance(error, audit.AuditError) else "PREFLIGHT_INPUT_OR_RUNTIME_ERROR", "subject": "preflight", "severity": "error"}]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"result": result["result"], "work_id": args.work_id, "phase": result.get("phase"), "baseline": result.get("baseline")}))
    return 0 if result["result"] == "PASS" else 1


if __name__ == "__main__": sys.exit(main())
