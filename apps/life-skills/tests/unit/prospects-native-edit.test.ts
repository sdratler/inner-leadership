import {describe,expect,it} from "vitest";
import {applyNativeProspectUpdate,changedProspectFollowUp,nativeProspectUpdateKey,prepareNativeProspectUpdate,prospectContactSuppressed,
 prospectFollowUpDraft,prospectUpdateFieldsSchema,reconcileProspectFollowUp} from "../../src/features/prospects/native-edit.ts";
import type {Prospect} from "../../src/features/prospects/bridge.ts";
const person="11111111-1111-4111-8111-111111111111",operation="22222222-2222-4222-8222-222222222222";
function row(leadId="LS-LEAD-synthetic"):Prospect{return {leadId,notes:"Synthetic preserved note",owner:"Synthetic original owner",outcome:"Synthetic original outcome",nextAction:"Original",
 dueDate:"2026-09-28",stage:"New inquiry",caseId:"synthetic-case",paymentVerified:true,bookingConfirmed:false,paymentStatus:"Verified fact",
 nativeEdit:{personId:person,profileVersion:1,authorityEpoch:3}} as Prospect;}
describe("native follow-up input preservation",()=>{
 it("constructs versioned commands without accepting browser authority/person selectors",()=>{
  const command=prepareNativeProspectUpdate(row(),{nextAction:"Synthetic changed",notes:""},operation);
  expect(command).toEqual({action:"update",leadId:"LS-LEAD-synthetic",fields:{nextAction:"Synthetic changed",notes:""},expectedEpoch:3,expectedVersion:1,operationId:operation});
  expect(command).not.toHaveProperty("personId");expect(command).not.toHaveProperty("destination");
 });
 it("uses a stable input key for exact uncertain retries, not a new operation",()=>{
  expect(nativeProspectUpdateKey(row(),{owner:"A",notes:"B"})).toBe(nativeProspectUpdateKey(row(),{notes:"B",owner:"A"}));
  expect(nativeProspectUpdateKey(row(),{notes:"B"})).not.toBe(nativeProspectUpdateKey(row(),{notes:"C"}));
  expect(nativeProspectUpdateKey(row(),{notes:"B"})).not.toBe(nativeProspectUpdateKey({...row(),nativeEdit:{...row().nativeEdit!,profileVersion:2}},{notes:"B"}));
 });
 it("advances shared profile references but retains unrelated records and authoritative journey facts",()=>{
  const selected=row(),second=row("LS-LEAD-second"),other={...row("LS-LEAD-other"),nativeEdit:{...row().nativeEdit!,personId:operation}};
  const request=prepareNativeProspectUpdate(selected,{notes:"Synthetic saved",nextAction:"Tomorrow",owner:"Reassigned",outcome:"Contacted"},operation);
  const rows=applyNativeProspectUpdate([selected,second,other],request,{updated:true,source:"native",personId:person,version:2,replayed:false});
  expect(rows[0]).toMatchObject({notes:"Synthetic saved",owner:"Reassigned",outcome:"Contacted",paymentVerified:true,caseId:"synthetic-case",paymentStatus:"Verified fact",nativeEdit:{profileVersion:2}});
  expect(rows[1]).toMatchObject({notes:"Synthetic saved",owner:second.owner,outcome:second.outcome,nativeEdit:{profileVersion:2}});expect(rows[2]).toBe(other);
 });
 it("an old replay response cannot downgrade a newer local version or authority epoch",()=>{
  const selected=row(),request=prepareNativeProspectUpdate(selected,{notes:"Synthetic old response"},operation);
  const newer={...selected,notes:"Synthetic newer saved",nativeEdit:{...selected.nativeEdit!,profileVersion:3}};
  expect(applyNativeProspectUpdate([newer],request,{updated:true,source:"native",personId:person,version:2,replayed:true})[0]).toBe(newer);
  const switched={...selected,nativeEdit:{...selected.nativeEdit!,authorityEpoch:4}};
  expect(applyNativeProspectUpdate([switched],request,{updated:true,source:"native",personId:person,version:2,replayed:true})[0]).toBe(switched);
 });
 it("rejects malformed context/results rather than reporting an unconfirmed save",()=>{
  const selected=row(),request=prepareNativeProspectUpdate(selected,{notes:"Synthetic saved"},operation);
  const legacy={...selected};delete legacy.nativeEdit;
  expect(()=>prepareNativeProspectUpdate(legacy,{notes:"A"},operation)).toThrow("INVALID_NATIVE_EDIT_CONTEXT");
  expect(()=>prepareNativeProspectUpdate(selected,{notes:"A"},"not-a-uuid")).toThrow("INVALID_NATIVE_EDIT_CONTEXT");
  for(const result of [{updated:true,source:"native",personId:operation,version:2,replayed:false},{updated:true,source:"native",personId:person,version:1,replayed:false}])
   expect(()=>applyNativeProspectUpdate([selected],request,result as Parameters<typeof applyNativeProspectUpdate>[2])).toThrow("INVALID_SAVE_RESULT");
 });
 it("supports explicit clearing and long Hebrew/English text but no clinical/payment or identity fields",()=>{
  expect(prospectUpdateFieldsSchema.safeParse({notes:"עברית English ".repeat(300),nextAction:"",dueDate:"",owner:""}).success).toBe(true);
  expect(prospectUpdateFieldsSchema.safeParse({notes:"x".repeat(5001)}).success).toBe(false);
  for(const field of ["clinicalNotes","personId","legacyIds","paymentVerified","bookingConfirmed"])
   expect(prospectUpdateFieldsSchema.safeParse({[field]:"synthetic"}).success).toBe(false);
 });
 it("owner-only sibling editing submits only its dirty field and rebases untouched shared values",()=>{
  const sibling=row("LS-LEAD-sibling"),draft=prospectFollowUpDraft(sibling);draft.values.owner="Synthetic changed owner";
  const updated={...sibling,notes:"Synthetic newer note saved in A",nextAction:"New action in A",dueDate:"2026-09-30",nativeEdit:{...sibling.nativeEdit!,profileVersion:2}};
  const rebased=reconcileProspectFollowUp(draft,updated);
  expect(rebased.values).toEqual({notes:updated.notes,nextAction:updated.nextAction,dueDate:updated.dueDate,owner:"Synthetic changed owner"});
  expect(changedProspectFollowUp(rebased)).toEqual({owner:"Synthetic changed owner"});expect(rebased.baseline.nativeEdit?.profileVersion).toBe(2);expect(rebased.conflict).toBe(false);
 });
 it("a conflicting sibling note stays visible but keeps its stale edit version rather than restoring old shared fields",()=>{
  const sibling=row("LS-LEAD-sibling"),draft=prospectFollowUpDraft(sibling);draft.values.notes="Synthetic unsaved competing note";
  const updated={...sibling,notes:"Synthetic newer note saved in A",nextAction:"New action in A",nativeEdit:{...sibling.nativeEdit!,profileVersion:2}};
  const rebased=reconcileProspectFollowUp(draft,updated);
  expect(rebased.values.notes).toBe("Synthetic unsaved competing note");expect(rebased.values.nextAction).toBe(updated.nextAction);expect(rebased.conflict).toBe(true);
  expect(rebased.baseline.nativeEdit?.profileVersion).toBe(1);expect(changedProspectFollowUp(rebased)).toEqual({notes:"Synthetic unsaved competing note"});
  expect(prepareNativeProspectUpdate(rebased.baseline,changedProspectFollowUp(rebased),operation).expectedVersion).toBe(1);
 });
 it("a confirmed own save reconciles cleanly, while an authority change keeps dirty input fenced",()=>{
  const initial=row(),draft=prospectFollowUpDraft(initial);draft.values.notes="Synthetic confirmed note";
  const saved={...initial,notes:draft.values.notes,nativeEdit:{...initial.nativeEdit!,profileVersion:2}};
  const clean=reconcileProspectFollowUp(draft,saved);expect(clean.conflict).toBe(false);expect(changedProspectFollowUp(clean)).toEqual({});expect(clean.baseline.nativeEdit?.profileVersion).toBe(2);
  draft.values.owner="Synthetic unsaved owner";const shifted=reconcileProspectFollowUp(draft,{...initial,nativeEdit:{...initial.nativeEdit!,authorityEpoch:4}});
  expect(shifted.values.owner).toBe(draft.values.owner);expect(shifted.baseline.nativeEdit?.authorityEpoch).toBe(3);expect(shifted.conflict).toBe(true);
 });
 it("communication suppression recognizes original opt-out forms, not only one display spelling",()=>{
  for(const value of ["Do not contact","do_not_contact","Opt out — synthetic","opted-out"])
   expect(prospectContactSuppressed({stage:"New inquiry",outcome:value})).toBe(true);
  expect(prospectContactSuppressed({stage:"Do not contact",outcome:"Contacted"})).toBe(true);
  expect(prospectContactSuppressed({stage:"New inquiry",outcome:"Contacted"})).toBe(false);
 });
});
