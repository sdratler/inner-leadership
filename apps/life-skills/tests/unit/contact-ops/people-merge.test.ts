import {expect,test} from "vitest";
import type {AdministrativeFields} from "../../../src/features/contact-ops/core/people-edit.ts";
import {compareAdministrativeEdits,resolveAdministrativeEdits} from "../../../src/features/contact-ops/core/people-merge.ts";
const base:AdministrativeFields={stage:"New",nextAction:"Call",followUpDate:"2026-09-30",notes:"Original\nהערה"};

test("independent edits combine without dropping either note or follow-up",()=>{
 const draft={...base,nextAction:"Send form"},saved={...base,notes:"Original\nהערה\nSaved note"};
 expect(compareAdministrativeEdits(base,draft,saved)).toEqual({merged:{...saved,nextAction:"Send form"},conflicts:[]});
 expect(resolveAdministrativeEdits(base,draft,saved,{})).toEqual({...saved,nextAction:"Send form"});
});
test("overlapping notes never default to the local or saved value",()=>{
 const draft={...base,notes:"My unsaved note"},saved={...base,notes:"Another saved note"};
 expect(compareAdministrativeEdits(base,draft,saved).conflicts).toEqual(["notes"]);
 expect(resolveAdministrativeEdits(base,draft,saved,{})).toBeNull();
 expect(resolveAdministrativeEdits(base,draft,saved,{notes:"saved"})?.notes).toBe(saved.notes);
 expect(resolveAdministrativeEdits(base,draft,saved,{notes:"draft"})?.notes).toBe(draft.notes);
 expect(base.notes).toBe("Original\nהערה");
});
test("identical concurrent value and unchanged fields are not conflicts",()=>{
 const draft={...base,stage:"Awaiting form"},saved={...base,stage:"Awaiting form",notes:"Saved note"};
 expect(compareAdministrativeEdits(base,draft,saved)).toEqual({merged:saved,conflicts:[]});
});
test("all overlapping fields require individual decisions",()=>{
 const draft={...base,stage:"Mine",notes:"My note"},saved={...base,stage:"Theirs",notes:"Their note"};
 expect(resolveAdministrativeEdits(base,draft,saved,{stage:"draft"})).toBeNull();
 expect(resolveAdministrativeEdits(base,draft,saved,{stage:"draft",notes:"saved"})).toEqual({...saved,stage:"Mine"});
});
