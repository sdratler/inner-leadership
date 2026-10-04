import {describe, expect, it} from "vitest";
import {planSourceDelta, reconcileImportedProfile} from "../../../src/features/contact-ops/server/import-delta.ts";
import {planImport, type SheetSnapshot} from "../../../src/features/contact-ops/server/import-plan.ts";
import type {CrmProfile} from "../../../src/features/contact-ops/server/native-store.ts";

const workspace = "00000000-0000-4000-8000-000000000001", key = "synthetic-delta-integrity-20261004";
const headers = ["Lead ID", "Parent/adult name", "Phone", "Email", "Pipeline stage", "Next action", "Next-action date", "General sales notes", "Payment status", "Unknown source column"];
const one = ["LS-LEAD-one", "Synthetic One", "+15555550101", "one@example.invalid", "new", "Call", "2026-10-04", "Original note", "Unverified", "Preserve me"];
const two = ["LS-LEAD-two", "Synthetic Two", "+15555550102", "two@example.invalid", "new", "Call", "", "Second note", "", ""];
const source = (revision = "r1", rows = [one]): SheetSnapshot => ({fileId:"synthetic-workbook",sheetId:101,tab:"Leads",complete:true,revision,headers,rows});
const changed = (values: Record<number,string>) => one.map((value,index) => values[index] ?? value);
const plan = (before: SheetSnapshot, after: SheetSnapshot) => planSourceDelta(before, after, workspace, key);
const row = (values = one) => planImport(source("r1",[values]),workspace,key).rows[0]!;
const profile = (): CrmProfile => ({personId:row().suggestedPersonId,legacyIds:[one[0]!],stage:"new",nextAction:"Call",followUpDate:"2026-10-04",notes:"Original note"});

describe("exact-source final delta planning",()=>{
 it("classifies unchanged and new rows without re-creating existing identities",()=>{
  const result=plan(source(),source("r2",[one,two]));
  expect(result.ready).toBe(true);expect(result.rows.map(r=>r.kind)).toEqual(["unchanged","new"]);
  expect(result.rows[0]!.before!.suggestedPersonId).toBe(result.rows[0]!.after.suggestedPersonId);
 });
 it("matches reordered rows by stable legacy id, not row position",()=>{
  const result=plan(source("r1",[one,two]),source("r2",[two,one]));
  expect(result.ready).toBe(true);expect(result.rows.map(r=>r.kind)).toEqual(["unchanged","unchanged"]);
  expect(result.rows[1]!.before!.sourceRow).toBe(2);expect(result.rows[1]!.after.sourceRow).toBe(3);
 });
 it("never converts a disappeared source row into a deletion",()=>{
  const result=plan(source("r1",[one,two]),source("r2",[one]));
  expect(result.ready).toBe(false);expect(result.missingLegacyIds).toEqual([two[0]]);
 });
 it("preserves all unknown columns and unverified payment claims",()=>{
  const result=plan(source(),source("r2",[changed({8:"Paid",9:"Changed source evidence"})]));
  expect(result.rows[0]!.kind).toBe("changed");expect(result.rows[0]!.after.paymentVerified).toBe(false);
  expect(result.rows[0]!.after.protectedPayload.sourceFields["Unknown source column"]).toBe("Changed source evidence");
 });
 it("fails closed on incomplete snapshots and changed source or headers",()=>{
  expect(()=>plan(source(),{...source("r2"),complete:false})).toThrow("INCOMPLETE_SNAPSHOT");
  expect(()=>plan(source(),{...source("r2"),sheetId:102})).toThrow("DELTA_SOURCE_MISMATCH");
  expect(()=>plan(source(),{...source("r2"),headers:headers.slice(0,-1)})).toThrow("DELTA_SOURCE_COLUMNS_CHANGED");
 });
 it("does not accept changed content under the same source revision",()=>{
  expect(()=>plan(source(),source("r1",[changed({7:"Changed"})]))).toThrow("DELTA_REVISION_REUSED");
  expect(plan(source(),source()).ready).toBe(true);
 });
 it("requires explicit review for endpoint changes and shared endpoints",()=>{
  expect(plan(source(),source("r2",[changed({2:"+15555550999"})])).review[0]!.reasons).toContain("ENDPOINT_CHANGED");
  const shared=[...two];shared[2]=one[2]!;
  const result=plan(source(),source("r2",[one,shared]));expect(result.ready).toBe(false);
  expect(result.review.map(r=>r.reasons)).toEqual([["SHARED_ENDPOINT"],["SHARED_ENDPOINT"]]);
 });
 it("does not hide invalid civil dates or source endpoint errors",()=>{
  const result=plan(source(),source("r2",[changed({2:"invalid",6:"2026-02-31"})]));
  expect(result.ready).toBe(false);expect(result.review[0]!.reasons).toContain("INVALID_FOLLOWUP_DATE");
  expect(result.review[0]!.reasons).toContain("PHONE_NEEDS_REVIEW");
 });
 it("fails duplicate legacy IDs rather than treating them as a merge",()=>{
  expect(()=>plan(source(),source("r2",[one,one]))).toThrow("DELTA_SOURCE_NEEDS_REVIEW");
 });
});

describe("three-way administrative reconciliation",()=>{
 it("applies a source-only change and does not mutate the caller",()=>{
  const current=profile(), result=reconcileImportedProfile(row(),row(changed({7:"Source note"})),current);
  expect(result).toMatchObject({changed:true,conflicts:[],profile:{notes:"Source note"}});
  expect(current.notes).toBe("Original note");
 });
 it("preserves new native notes when the source only changes a different field",()=>{
  const current={...profile(),notes:"New native note",doNotContact:true};
  const result=reconcileImportedProfile(row(),row(changed({5:"Follow up"})),current);
  expect(result.profile).toMatchObject({notes:"New native note",nextAction:"Follow up",doNotContact:true});
  expect(result.conflicts).toEqual([]);
 });
 it("competing notes reject the entire row rather than partially applying fields",()=>{
  const current={...profile(),notes:"Native note"};
  const result=reconcileImportedProfile(row(),row(changed({5:"New action",7:"Source note"})),current);
  expect(result).toEqual({profile:current,conflicts:["notes"],changed:false});
 });
 it("identical convergent edits are idempotent",()=>{
  const current={...profile(),notes:"Same edit"};
  expect(reconcileImportedProfile(row(),row(changed({7:"Same edit"})),current)).toEqual({profile:current,conflicts:[],changed:false});
 });
 it("preserves explicit empty notes without manufacturing content",()=>{
  const result=reconcileImportedProfile(row(),row(changed({7:""})),profile());
  expect(result.profile.notes).toBe("");expect(result.changed).toBe(true);
 });
 it("payment and unknown source fields cannot grant paid state or overwrite native fields",()=>{
  const current={...profile(),doNotContact:true,leadUpdates:{"LS-LEAD-one":{outcome:"Owner noted"}}};
  const result=reconcileImportedProfile(row(),row(changed({8:"Paid",9:"Confirmed booking"})),current);
  expect(result).toEqual({profile:current,conflicts:[],changed:false});
 });
 it("rejects a different person or changed endpoint instead of silently relinking",()=>{
  expect(()=>reconcileImportedProfile(row(),row(two),profile())).toThrow("DELTA_IDENTITY_MISMATCH");
  expect(()=>reconcileImportedProfile(row(),row(changed({3:"other@example.invalid"})),profile())).toThrow("DELTA_ENDPOINT_REQUIRES_REVIEW");
 });
 it("refuses oversized imported notes before applying an update",()=>{
  expect(()=>reconcileImportedProfile(row(),row(changed({7:"x".repeat(5001)})),profile())).toThrow("DELTA_PROFILE_FIELD_TOO_LONG");
 });
});
