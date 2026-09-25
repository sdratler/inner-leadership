import {describe,expect,it} from "vitest";
import {importSummary,planImport,sameProtectedRow,type SheetSnapshot} from "../../../src/features/contact-ops/server/import-plan.ts";

const key="synthetic-test-integrity-key-123456789";
const snapshot=(changes:Partial<SheetSnapshot>={}):SheetSnapshot=>({fileId:"synthetic-source",tab:"Leads",revision:"synthetic-revision",complete:true,headers:["Lead ID","Parent/adult name","Phone","Email","Pipeline stage","Payment status","General sales notes","Update provenance","Inbound provider message IDs","Unmapped source column"],rows:[["LS-LEAD-DEMO-01","DEMO — Synthetic parent","0520000001","demo@example.invalid","Offer made","PAID","Synthetic administrative note","synthetic import","provider-event-synthetic","Preserve this extra"]],...changes});

describe("native CRM candidate source planner",()=>{
 it("preserves every source field privately but never treats Sheet payment text as verified",()=>{
  const row=planImport(snapshot(),"synthetic-workspace",key).rows[0]!;
  expect(row.paymentVerified).toBe(false);
  expect(row.protectedPayload.sourceFields["Unmapped source column"]).toBe("Preserve this extra");
  expect(row.protectedPayload.sourceFields["General sales notes"]).toBe("Synthetic administrative note");
  expect(row.protectedPayload.sourceFields["Inbound provider message IDs"]).toBe("provider-event-synthetic");
 });
 it("excludes names, contacts and notes from the public-safe summary",()=>{
  const summary=JSON.stringify(importSummary(planImport(snapshot(),"synthetic-workspace",key)));
  expect(summary).not.toContain("Synthetic parent");
  expect(summary).not.toContain("Synthetic administrative note");
  expect(summary).not.toContain("0520000001");
 });
 it("rejects incomplete snapshots, missing or ambiguous headers, and hidden extra cells",()=>{
  expect(()=>planImport(snapshot({complete:false}),"synthetic-workspace",key)).toThrow("INCOMPLETE_SNAPSHOT");
  expect(()=>planImport(snapshot({headers:["Lead ID"]}),"synthetic-workspace",key)).toThrow("MISSING_HEADER");
  expect(()=>planImport(snapshot({headers:["Lead ID","Lead ID"]}),"synthetic-workspace",key)).toThrow("AMBIGUOUS_HEADERS");
  expect(()=>planImport(snapshot({headers:[...snapshot().headers," Lead ID "]}),"synthetic-workspace",key)).toThrow("AMBIGUOUS_HEADERS");
  expect(()=>planImport(snapshot({rows:[[...snapshot().rows[0]!,"hidden"]]}),"synthetic-workspace",key)).toThrow("UNMAPPED_EXTRA_CELLS");
 });
 it("preserves exact source headers and digests while matching required columns by trimmed lookup",()=>{
  const before=snapshot(),headers=[...before.headers];headers[0]=" Lead ID ";headers[9]=" Unmapped source column ";
  const original=planImport(before,"synthetic-workspace",key),spaced=planImport(snapshot({headers}),"synthetic-workspace",key);
  expect(spaced.rows[0]?.legacyId).toBe(original.rows[0]?.legacyId);
  expect(spaced.rows[0]?.protectedPayload.sourceFields[" Unmapped source column "]).toBe("Preserve this extra");
  expect(spaced.rows[0]?.protectedPayload.sourceFields["Unmapped source column"]).toBeUndefined();
  expect(spaced.snapshotDigest).not.toBe(original.snapshotDigest);
  expect(spaced.rows[0]?.rowDigest).not.toBe(original.rows[0]?.rowDigest);
 });
 it("keeps import identity stable and never merges two different legacy IDs by phone",()=>{
  const original=snapshot().rows[0]!;
  const double=snapshot({rows:[original,["LS-LEAD-DEMO-02",...original.slice(1)]]});
  const first=planImport(snapshot(),"synthetic-workspace",key),second=planImport(snapshot(),"synthetic-workspace",key);
  expect(first.rows[0]?.suggestedPersonId).toBe(second.rows[0]?.suggestedPersonId);
  expect(sameProtectedRow(first.rows[0]!,second.rows[0]!)).toBe(true);
  expect(new Set(planImport(double,"synthetic-workspace",key).rows.map(row=>row.suggestedPersonId)).size).toBe(2);
 });
 it("accounts for duplicate IDs, blank rows and changed note contents",()=>{
  const original=snapshot().rows[0]!;
  const plan=planImport(snapshot({rows:[original,original,["",""]]}),"synthetic-workspace",key);
  expect(plan).toMatchObject({canImport:false,blankRows:1});
  expect(plan.conflicts[0]?.code).toBe("DUPLICATE_LEGACY_ID");
  const revised=[...original];revised[6]="Changed synthetic note";
  expect(sameProtectedRow(planImport(snapshot(),"synthetic-workspace",key).rows[0]!,planImport(snapshot({rows:[revised]}),"synthetic-workspace",key).rows[0]!)).toBe(false);
 });
 it("flags malformed contact email without dropping its original private source value",()=>{
  const row=[...snapshot().rows[0]!];row[3]="a..b@example.com";
  const imported=planImport(snapshot({rows:[row]}),"synthetic-workspace",key).rows[0]!;
  expect(imported.normalizedEmail).toBeNull();
  expect(imported.issues).toContain("EMAIL_NEEDS_REVIEW");
  expect(imported.protectedPayload.sourceFields.Email).toBe("a..b@example.com");
 });
});
