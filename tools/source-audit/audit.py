#!/usr/bin/env python3
"""Read-only Life Skills integrity gate. No source writes or client-data ingestion.

Live mode uses a narrowly shared Google service account or short-lived token.
Snapshot mode requires fresh connector exports; it never claims a cloud run.
Only neutral finding codes/IDs and hashes are emitted. See README for limits.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

VERSION = "1.1.0"
REPOSITORY = "sdratler/inner-leadership"
CONTROL_ID = "1Y_Vf_kipj7mAhhEnuj8F2L85v3KpOi_V9KfSrj4MZ4Y"
DOC_IDS = {
 "registry":"1XZS-MzUtjc3T488lyrSbtDX0Yq5UCl7Wzh5uN_YOvMg",
 "product":"1kJug8ojFwdGgZoPUx8BJt9fLKBjGYvX0wwbtarGTIIg",
 "architecture":"1h-bnQ94uxuTrs8BPeDg-1uwZFcQEONdmYccd9Inacgw",
 "ui":"1KokAca2V-UhCPj1czP28TQ4i5E2Wd1JKJFbuXfmAPu4",
 "program":"1aR8ONMUW0nlPbVe3jFZ6FKJ1_lPHyYPdVbTRbWB3hhA",
 "website":"1jw0shI2DSfUH9RpJc2WdeIqXwO1OYOUEiwuv3mdNngU",
 "prompts":"1r8fN36liKyXcf9GVG1Cl25Yq9vjaYWD9A0YC1h3jn-E",
 "operating":"1q-GDEaL9JmmVfy1meQrGvu3V4H2XNJ4jp2b17ZrP6bE",
 "packet":"1NrlYux3I78nO7M9v1fKGl-UCKpkcZrOUtHSoV-BmLOE",
}
RANGES = {"Work Graph":"'Work Graph'!A1:W201", "Decisions":"Decisions!A1:J100",
          "Interfaces":"Interfaces!A1:I100", "Overview":"Overview!A1:C100",
          "Instructions":"Instructions!A1:H100"}
# Stable policy sections only: exclude live status counters/owner-action summaries.
CONTROL_SECTIONS = {"Overview": (17, 3), "Instructions": (2, 8)}
WORK_ID = re.compile(r"(?:LS|SYS|PRG|MKT|OPS|FIN)-\d{3}\Z")
SHA40 = re.compile(r"[a-f0-9]{40}\Z")
SHA64 = re.compile(r"[a-f0-9]{64}\Z")
ACTIVE = {"Ready", "Claimed", "Code generating", "Integrating"}
LEASED = {"Claimed", "Code generating", "Integrating"}
RETIRED = {"Superseded", "Canceled"}
RANK = {"Packet ready":4,"Integrating":5,"Integrated":6,"Verified":7,"Deployed":8,"Owner accepted":9}
# Runtime baseline and status/lease/output fields deliberately excluded.
DEF_COLS = (0,1,2,3,4,7,8,9,14,22)

class AuditError(Exception):
    """An intentionally content-free operational error."""


def normalize(text: str) -> str:
    return text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")


def digest(text: str) -> str:
    return hashlib.sha256(normalize(text).encode("utf-8")).hexdigest()


def compact_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_time(value: str) -> datetime:
    result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("timezone required")
    return result.astimezone(timezone.utc)


def settings_block(text: str) -> str:
    text = normalize(text)
    begin, end = "BEGIN PROJECT SETTINGS BLOCK", "END PROJECT SETTINGS BLOCK"
    if text.count(begin) != 1 or text.count(end) != 1:
        raise ValueError("one delimited block required")
    start, finish = text.index(begin), text.index(end)
    if finish <= start:
        raise ValueError("invalid block order")
    return text[start:finish+len(end)].strip("\n") + "\n"


def pad(row: list[Any], width: int = 23) -> list[str]:
    return ["" if v is None else (str(int(v)) if isinstance(v, float) and v.is_integer() else str(v)) for v in row] + [""] * max(0, width-len(row))


def definition(row: list[Any]) -> list[str]:
    row = pad(row)
    return [row[i] for i in DEF_COLS]


def control_section(rows: Any, start: int, width: int) -> list[list[str]] | None:
    """Normalize a read-only policy section, retaining empty internal rows.

    A missing/truncated/malformed section must not equal a valid empty policy.
    Overview starts at row 18; Instructions at row 3. Counters are excluded.
    """
    if not isinstance(rows, list) or len(rows) <= start:
        return None
    if any(not isinstance(row, list) for row in rows):
        return None
    result = [pad(row, width)[:width] for row in rows[start:]]
    while result and not any(result[-1]):
        result.pop()
    return result if result and any(any(row) for row in result) else None


def deps(value: str) -> list[tuple[str,str]]:
    """Accept only full IDs and explicit required states in active definitions."""
    if not value.strip():
        return []
    out=[]
    for part in value.split(";"):
        wid, sep, state = part.strip().partition(":")
        if not sep or not WORK_ID.fullmatch(wid) or state not in RANK:
            raise ValueError("invalid dependency syntax")
        out.append((wid,state))
    return out


def verify_zip(path: Path, expected: str) -> list[str]:
    issues=[]
    if not SHA64.fullmatch(expected): return ["PACKET_DIGEST_MISSING"]
    if path.stat().st_size > 128*1024*1024: return ["PACKET_TOO_LARGE"]
    if hashlib.sha256(path.read_bytes()).hexdigest()!=expected: return ["PACKET_DIGEST_MISMATCH"]
    with zipfile.ZipFile(path) as z:
        names=[n for n in z.namelist() if not n.endswith("/")]
        if len(names)!=len(set(names)): return ["PACKET_DUPLICATE_PATH"]
        if any(n.startswith(("/","\\")) or ".." in n.split("/") or "\\" in n for n in names):
            return ["PACKET_UNSAFE_PATH"]
        if sum(x.file_size for x in z.infolist())>256*1024*1024: return ["PACKET_EXPANDED_TOO_LARGE"]
        for item in z.infolist():
            if (item.external_attr>>16)&0o170000 == 0o120000: return ["PACKET_SYMLINK"]
        checkfiles=[n for n in names if n.endswith("/CHECKSUMS.sha256") or n=="CHECKSUMS.sha256"]
        if len(checkfiles)!=1: return ["PACKET_CHECKSUM_INDEX"]
        prefix=checkfiles[0][:-len("CHECKSUMS.sha256")]
        mandatory=["MANIFEST.md","INTEGRATION.md","ACCEPTANCE.md","SOURCE_NOTES.md",
                   "SOURCE_AUDIT.json","CODEX_INTEGRATION_PROMPT.md"]
        if any(prefix+n not in names for n in mandatory): issues.append("PACKET_REQUIRED_FILE")
        for d in ["FULL_FILES/","TESTS/","MIGRATIONS/"]:
            if not any(n.startswith(prefix+d) for n in names): issues.append("PACKET_REQUIRED_DIRECTORY")
        indexed=set()
        for line in z.read(checkfiles[0]).decode("utf-8").splitlines():
            if not line.strip(): continue
            match=re.fullmatch(r"([a-f0-9]{64})  (.+)",line)
            if not match: issues.append("PACKET_CHECKSUM_FORMAT"); continue
            h,n=match.groups(); full=prefix+n
            if full in indexed or full not in names: issues.append("PACKET_CHECKSUM_PATH"); continue
            indexed.add(full)
            if hashlib.sha256(z.read(full)).hexdigest()!=h: issues.append("PACKET_FILE_DIGEST")
        if indexed != set(names)-{checkfiles[0]}: issues.append("PACKET_INVENTORY_MISMATCH")
    return sorted(set(issues))


def audit(snapshot: dict, manifest: dict, work_id: str|None=None, baseline: str|None=None,
          phase: str="audit", packets: dict[str,Path]|None=None, now: datetime|None=None) -> dict:
    now=now or utcnow(); findings=[]; checked=[]
    def add(code: str, subject: str="control", severity: str="error"):
        # Never print source/row content, source titles, credentials or exception payloads.
        safe=subject if re.fullmatch(r"[A-Za-z0-9_-]{1,80}",subject) else "control"
        findings.append({"code":code,"subject":safe,"severity":severity})
    try:
        age=(now-parse_time(snapshot["captured_at"])).total_seconds()
        if age < -120 or age > manifest.get("max_snapshot_age_seconds",1800): add("INPUT_STALE")
    except (ValueError,TypeError,KeyError): add("INPUT_TIME_MISSING")
    if snapshot.get("capture_mode") not in ("connector_export","live_api","synthetic_test"):
        add("CAPTURE_MODE_INVALID")
    if manifest.get("schema_version")!=1 or snapshot.get("schema_version")!=1: add("SCHEMA_VERSION")
    sources=snapshot.get("sources",{})
    selected=set(manifest.get("work_scopes",{}).get(work_id, DOC_IDS.keys()))
    selected.update({"registry","operating","packet","prompts"})
    for key in sorted(selected):
        expected=manifest.get("sources",{}).get(key)
        item=sources.get(key)
        if not expected or not item or not item.get("text"): add("SOURCE_UNREADABLE",key); continue
        if key not in DOC_IDS or expected.get("id")!=DOC_IDS[key] or item.get("id")!=DOC_IDS[key]:
            add("SOURCE_ID_MISMATCH",key); continue
        actual=digest(item["text"])
        checked.append({"key":key,"id":DOC_IDS[key],"sha256":actual,"version":expected.get("version")})
        if actual!=expected.get("sha256"): add("SOURCE_CHANGED",key)
        for pattern in expected.get("required",[]):
            if not re.search(pattern,normalize(item["text"]),re.I): add("REQUIRED_RULE_MISSING",key)
        for pattern in expected.get("forbidden",[]):
            if re.search(pattern,normalize(item["text"]),re.I): add("RETIRED_RULE_PRESENT",key)
        try:
            read_age=(now-parse_time(item["read_at"])).total_seconds()
            if read_age < -120 or read_age > manifest.get("max_snapshot_age_seconds",1800): add("SOURCE_READ_STALE",key)
        except (KeyError,ValueError,TypeError): add("SOURCE_READ_TIME_MISSING",key)
    try:
        b=settings_block(sources["operating"]["text"])
        if b!=settings_block(sources["prompts"]["text"]): add("SETTINGS_BLOCK_MISMATCH")
        if digest(b)!=manifest.get("settings_sha256"): add("SETTINGS_BLOCK_CHANGED")
    except (ValueError,KeyError,TypeError): add("SETTINGS_BLOCK_MISSING")
    registry=sources.get("registry",{}).get("text","")
    if any(docid not in registry for key, docid in DOC_IDS.items() if key != "registry"): add("REGISTRY_MISSING_ID")
    control=snapshot.get("control",{}); raw=control.get("Work Graph")
    if not isinstance(raw,list) or not raw: add("WORK_GRAPH_UNREADABLE"); raw=[]
    control_fingerprints = []
    for name, (start, width) in CONTROL_SECTIONS.items():
        expected_control = manifest.get("control_contracts", {}).get(name)
        actual_control = control_section(control.get(name), start, width)
        if not isinstance(expected_control, dict) or not SHA64.fullmatch(str(expected_control.get("sha256", ""))):
            add("CONTROL_POLICY_BASELINE_MISSING", name)
            continue
        if expected_control.get("start_row") != start + 1 or expected_control.get("columns") != width:
            add("CONTROL_POLICY_SCOPE_MISMATCH", name)
            continue
        if actual_control is None:
            add("CONTROL_POLICY_UNREADABLE", name)
            continue
        actual_hash = compact_hash(actual_control)
        control_fingerprints.append({"sheet": name, "start_row": start + 1,
                                     "columns": width, "sha256": actual_hash})
        if actual_hash != expected_control["sha256"]:
            add("CONTROL_POLICY_CHANGED", name)
    rows={}; graph={}
    for item in raw[1:]:
        row=pad(item); wid=row[0]
        if not wid: continue
        if not WORK_ID.fullmatch(wid): add("WORK_ID_INVALID"); continue
        if wid in rows: add("WORK_ID_DUPLICATE",wid)
        rows[wid]=row
    expected_defs=manifest.get("work_definitions",{})
    for wid,row in rows.items():
        if row[5] in RETIRED: continue
        # Historical audit rows are retained as evidence, never new instructions.
        if wid in manifest.get("historical_work_ids",[]): continue
        try: graph[wid]=deps(row[4])
        except ValueError: add("DEPENDENCY_SYNTAX",wid); graph[wid]=[]
        if wid not in expected_defs: add("WORK_DEFINITION_UNREVIEWED",wid)
        elif compact_hash(definition(row))!=expected_defs[wid]: add("WORK_DEFINITION_CHANGED",wid)
    for wid in expected_defs:
        if wid not in rows: add("WORK_ITEM_MISSING",wid)
    # Scope includes dependencies, so a broken producer cannot be ignored.
    relevant=set(rows) if work_id is None else {work_id}
    pending=list(relevant)
    while pending:
        wid=pending.pop()
        for dep,_ in graph.get(wid,[]):
            if dep not in relevant: relevant.add(dep); pending.append(dep)
    visiting=set(); visited=set()
    def visit(wid):
        if wid in visiting: add("DEPENDENCY_CYCLE",wid); return
        if wid in visited:return
        visiting.add(wid)
        for dep,_ in graph.get(wid,[]):
            if dep not in rows: add("DEPENDENCY_MISSING",wid)
            else:visit(dep)
        visiting.remove(wid);visited.add(wid)
    for wid in relevant: visit(wid)
    claims=[]; claim_ids=set()
    for wid,row in rows.items():
        if row[5] in LEASED or row[15]:
            try:
                start,end,updated=map(parse_time,(row[17],row[18],row[19]))
                if not row[15] or not row[16]: raise ValueError()
                if row[15] in claim_ids:add("CLAIM_ID_DUPLICATE",wid)
                claim_ids.add(row[15])
                if end<=now: add("CLAIM_EXPIRED",wid)
                if end<=start or (end-start).total_seconds()>21600 or updated<start or updated>now.replace(microsecond=0)+timedelta(seconds=120):
                    add("CLAIM_TIME_INVALID",wid)
                if row[5] not in LEASED: add("CLAIM_STATUS_MISMATCH",wid)
                if end>now: claims.append(wid)
            except (ValueError,TypeError): add("CLAIM_INCOMPLETE",wid)
        if wid not in relevant: continue
        if row[5] in ACTIVE:
            if row[14] in {"GPT_PACKET","CODEX_INTEGRATION"} and not SHA40.fullmatch(row[6]):
                add("READY_BASELINE_INVALID",wid)
            for dep,state in graph.get(wid,[]):
                if dep not in rows or RANK.get(rows[dep][5],-1)<RANK[state]: add("DEPENDENCY_NOT_READY",wid)
        if row[14]=="GPT_PACKET" and row[5] in RANK:
            if not row[10].startswith("https://") or not SHA64.fullmatch(row[20]) or not row[21]:
                add("PACKET_EVIDENCE_MISSING",wid)
    roots=manifest.get("ownership_roots",{})
    for i,left in enumerate(claims):
        for right in claims[i+1:]:
            for a in roots.get(left,[]):
                for b in roots.get(right,[]):
                    if a==b or a.startswith(b.rstrip('/')+'/') or b.startswith(a.rstrip('/')+'/'):
                        add("CLAIM_OWNERSHIP_OVERLAP",left)
    approved=manifest.get("approved_decisions",{})
    decision_rows=control.get("Decisions")
    if not isinstance(decision_rows,list) or not decision_rows: add("DECISIONS_UNREADABLE")
    else:
        for values in decision_rows[1:]:
            row=pad(values,10)
            if row[3]!="Approved":continue
            did=row[0]
            if did not in approved or compact_hash(row[:10])!=approved[did]:
                add("APPROVED_DECISION_UNRECONCILED",did)
    actual_approved={pad(v,10)[0] for v in (decision_rows or [])[1:] if pad(v,10)[3]=="Approved"}
    for did in approved:
        if did not in actual_approved:add("APPROVED_DECISION_MISSING",did)
    interface_rows=control.get("Interfaces")
    if not isinstance(interface_rows,list) or not interface_rows:add("INTERFACES_UNREADABLE")
    else:
        observed={}
        for v in interface_rows[1:]:
            row=pad(v,9)
            if row[0]:observed[row[0]]=compact_hash([row[i] for i in (0,1,2,3,4,6,7,8)])
        if observed != manifest.get("interface_definitions",{}):add("INTERFACE_CONTRACT_CHANGED")
        states={pad(v,9)[0]:pad(v,9)[5] for v in interface_rows[1:] if pad(v,9)[0]}
        consumers={"LS-030","LS-040","LS-050","LS-060","LS-080"}
        for wid in relevant & consumers:
            if rows.get(wid,[""]*23)[5] in ACTIVE:
                for iid in ("I-013","I-014"):
                    if states.get(iid) not in {"Frozen","Accepted","Integrated","Verified"}:
                        add("INTERFACE_NOT_FROZEN",wid)
    if not SHA40.fullmatch(str(snapshot.get("git_head",""))): add("GIT_READ_MISSING")
    if work_id:
        if work_id not in rows: add("REQUESTED_WORK_MISSING",work_id)
        else:
            row=rows[work_id]
            allowed={"Ready","Claimed","Code generating"} if phase=="prepare" else ACTIVE|set(RANK)
            if row[5] not in allowed:add("REQUESTED_WORK_NOT_ELIGIBLE",work_id)
            if row[14] in {"GPT_PACKET","CODEX_INTEGRATION"}:
                if not baseline or baseline!=row[6] or not SHA40.fullmatch(baseline):add("EXACT_BASELINE_MISMATCH",work_id)
                if snapshot.get("reachable",{}).get(baseline) is not True:add("BASELINE_NOT_VERIFIED",work_id)
            if phase=="integrate":
                for dep,state in graph.get(work_id,[]):
                    if state!="Packet ready": continue
                    path=(packets or {}).get(dep)
                    if not path:add("PRODUCER_ZIP_NOT_VERIFIED",dep);continue
                    try:
                        for code in verify_zip(path,rows[dep][20]):add(code,dep)
                    except (OSError,ValueError,zipfile.BadZipFile,KeyError):add("PACKET_UNREADABLE",dep)
    # Scope-local definition findings do not block independent work; global failures do.
    for finding in findings:
        if work_id and WORK_ID.fullmatch(finding["subject"]) and finding["subject"] not in relevant and finding["code"] not in {"CLAIM_OWNERSHIP_OVERLAP"}:
            finding["severity"]="warning"
    return {"schema_version":1,"checker_version":VERSION,"checked_at":now.isoformat(),
            "capture_mode":snapshot.get("capture_mode"),"phase":phase,"work_id":work_id,
            "baseline":baseline,"git_head":snapshot.get("git_head"),"source_fingerprints":checked,
            "result":"BLOCKED" if any(f["severity"]=="error" for f in findings) else "PASS",
            "findings":findings,"control_fingerprints":control_fingerprints,"semantic_limit":"Fingerprints/rules do not prove all meaning is consistent; review every approved change.",
            "scheduler_installed":False if snapshot.get("capture_mode")!="live_api" else None}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): raise AuditError("HTTP_REDIRECT_REFUSED")


def request_json(url: str, token: str|None=None, data: bytes|None=None, form: bool=False, raw: bool=False):
    parsed=urllib.parse.urlparse(url)
    if parsed.scheme!="https" or parsed.hostname not in {"www.googleapis.com","sheets.googleapis.com","oauth2.googleapis.com","api.github.com"}:
        raise AuditError("HTTP_HOST_REFUSED")
    headers={"User-Agent":"LifeSkillsSourceAudit/1.1","Accept":"application/json"}
    if token:headers["Authorization"]="Bearer "+token
    if form:headers["Content-Type"]="application/x-www-form-urlencoded"
    for attempt in range(3):
        try:
            req=urllib.request.Request(url,data=data,headers=headers)
            with urllib.request.build_opener(NoRedirect).open(req,timeout=25) as res:
                body=res.read(10*1024*1024+1)
                if len(body)>10*1024*1024:raise AuditError("HTTP_BODY_TOO_LARGE")
                return body.decode("utf-8-sig") if raw else json.loads(body)
        except urllib.error.HTTPError as err:
            if err.code in (429,500,502,503,504) and attempt<2:time.sleep(2**attempt);continue
            raise AuditError("HTTP_STATUS_"+str(err.code)) from None
        except (urllib.error.URLError,TimeoutError,UnicodeError,json.JSONDecodeError):
            if attempt<2:time.sleep(2**attempt);continue
            raise AuditError("HTTP_READ_FAILED") from None


def google_token() -> str:
    token=os.environ.get("GOOGLE_ACCESS_TOKEN")
    if token:return token
    try:
        info=json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"])
        if info.get("type")!="service_account":raise ValueError()
        email=info["client_email"]; key=info["private_key"]
        if not email.endswith(".gserviceaccount.com") or "PRIVATE KEY" not in key:raise ValueError()
        now=int(time.time())
        encode=lambda obj:base64.urlsafe_b64encode(json.dumps(obj,separators=(",",":")).encode()).rstrip(b"=")
        header=encode({"alg":"RS256","typ":"JWT"})
        claim=encode({"iss":email,"scope":"https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly",
                      "aud":"https://oauth2.googleapis.com/token","iat":now,"exp":now+3500})
        unsigned=header+b"."+claim
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/"key.pem";p.write_text(key);p.chmod(0o600)
            signed=subprocess.run(["openssl","dgst","-sha256","-sign",str(p)],input=unsigned,capture_output=True,check=True,timeout=10).stdout
        jwt=unsigned+b"."+base64.urlsafe_b64encode(signed).rstrip(b"=")
        body=urllib.parse.urlencode({"grant_type":"urn:ietf:params:oauth:grant-type:jwt-bearer","assertion":jwt.decode()}).encode()
        result=request_json("https://oauth2.googleapis.com/token",data=body,form=True)
        return result["access_token"]
    except (KeyError,ValueError,TypeError,OSError,subprocess.SubprocessError):
        raise AuditError("GOOGLE_CREDENTIALS_UNAVAILABLE_OR_INVALID") from None


def collect_live(manifest: dict) -> dict:
    token=google_token();read_at=utcnow().isoformat();sources={}
    for key,did in DOC_IDS.items():
        if manifest["sources"].get(key,{}).get("id")!=did:raise AuditError("SOURCE_ALLOWLIST_MISMATCH")
        text=request_json(f"https://www.googleapis.com/drive/v3/files/{did}/export?mimeType=text%2Fplain",token,raw=True)
        sources[key]={"id":did,"read_at":utcnow().isoformat(),"text":text}
    params=urllib.parse.urlencode([("ranges",v) for v in RANGES.values()]+[("valueRenderOption","UNFORMATTED_VALUE")])
    payload=request_json(f"https://sheets.googleapis.com/v4/spreadsheets/{CONTROL_ID}/values:batchGet?{params}",token)
    vr=payload.get("valueRanges",[])
    if len(vr)!=len(RANGES):raise AuditError("CONTROL_RANGE_MISSING")
    control={key:r.get("values",[]) for key,r in zip(RANGES,vr)}
    gh=os.environ.get("GITHUB_TOKEN")
    head=request_json(f"https://api.github.com/repos/{REPOSITORY}/branches/main",gh)["commit"]["sha"]
    reachable={head:True}
    for item in control["Work Graph"][1:]:
        row=pad(item)
        if row[5] in ACTIVE and SHA40.fullmatch(row[6]) and row[6] not in reachable:
            try:
                data=request_json(f"https://api.github.com/repos/{REPOSITORY}/commits/{row[6]}",gh)
                reachable[row[6]]=data.get("sha")==row[6]
            except AuditError:reachable[row[6]]=False
    return {"schema_version":1,"capture_mode":"live_api","captured_at":read_at,"sources":sources,
            "control":control,"git_head":head,"reachable":reachable}


def main(argv=None) -> int:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest",type=Path,default=Path(__file__).with_name("expected.json"))
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--live",action="store_true");group.add_argument("--snapshot",type=Path)
    parser.add_argument("--work-id");parser.add_argument("--baseline")
    parser.add_argument("--phase",choices=["audit","prepare","integrate"],default="audit")
    parser.add_argument("--packet",action="append",default=[],help="Producer Work ID=verified local ZIP path")
    parser.add_argument("--output",type=Path,default=Path("source-audit-report.json"))
    args=parser.parse_args(argv)
    try:
        manifest=json.loads(args.manifest.read_text(encoding="utf-8"))
        snapshot=collect_live(manifest) if args.live else json.loads(args.snapshot.read_text(encoding="utf-8"))
        packets={}
        for value in args.packet:
            wid,sep,path=value.partition("=")
            if not sep or not WORK_ID.fullmatch(wid):raise AuditError("PACKET_ARGUMENT_INVALID")
            packets[wid]=Path(path)
        report=audit(snapshot,manifest,args.work_id,args.baseline,args.phase,packets)
    except (AuditError,OSError,ValueError,TypeError,KeyError) as err:
        code=str(err) if isinstance(err,AuditError) else "INPUT_OR_CONFIGURATION_ERROR"
        report={"schema_version":1,"checker_version":VERSION,"checked_at":utcnow().isoformat(),"result":"BLOCKED",
                "capture_mode":"live_api" if args.live else "connector_export","findings":[{"code":code,"subject":"control","severity":"error"}]}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(json.dumps({"result":report["result"],"checked_at":report["checked_at"],"findings":report["findings"]},ensure_ascii=False))
    summary=os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary,"a",encoding="utf-8") as out:
            out.write(f"## Source integrity: {report['result']}\n\nChecked: {report['checked_at']}\n\n")
            for f in report["findings"]:out.write(f"- {f['severity']}: {f['code']} ({f['subject']})\n")
            out.write("\nRead-only fingerprints and deterministic rules; not a complete semantic or deployment audit.\n")
    return 0 if report["result"]=="PASS" else 1

if __name__=="__main__":sys.exit(main())
