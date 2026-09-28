import {expect,test,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {createElement} from "react";
vi.mock("server-only",()=>({}));
import {NativePeopleWorkspace} from "../../../src/features/contact-ops/native-people-workspace.tsx";
import {peopleEdit,sameAdministrativeFields} from "../../../src/features/contact-ops/core/people-edit.ts";
import {practitionerReturnPath,loginReturnDestination} from "../../../src/features/identity/login-return.ts";
import type {NativeContactRow} from "../../../src/features/contact-ops/server/native-directory.ts";
import {selectNativeContacts,type NativeContactReference} from "../../../src/features/contact-ops/server/native-directory.ts";
import nextConfig from "../../../next.config.ts";
const personId="00000000-0000-4000-8000-000000000001",fields={stage:"New inquiry",nextAction:"Synthetic next action",followUpDate:"2026-09-28",notes:"  Synthetic saved note\nהערה סינתטית שמורה  "};
test("build configuration preserves the existing engine defaults and type validation",()=>{
 expect(nextConfig).not.toHaveProperty('webpack');
 expect(nextConfig.typescript?.ignoreBuildErrors).not.toBe(true);
});
test("native edit has exact version/epoch/operation; preserves notes and denies grants/actions",()=>{const input={action:"update" as const,personId,expectedEpoch:3,expectedVersion:1,operationId:"00000000-0000-4000-8000-000000000002",fields};const op=peopleEdit(input);expect(op.fields.notes).toBe(fields.notes);expect(sameAdministrativeFields(op.fields,fields)).toBe(true);expect(sameAdministrativeFields({...op.fields,notes:fields.notes.trim()},fields)).toBe(false);for(const bad of [{...input,role:"practitioner"},{...input,expectedVersion:0},{...input,fields:{...fields,legacyIds:["LS-LEAD-synthetic"]}},{...input,fields:{...fields,followUpDate:"2026-02-30"}}])expect(()=>peopleEdit(bad)).toThrow();});
test.each(["he","en"] as const)("%s render contract has one toolbar, real pagination and semantic desktop/mobile rows",locale=>{const html=renderToStaticMarkup(createElement(NativePeopleWorkspace,{locale,view:"all",initial:{source:"native",authorityEpoch:3,page:{page:1,pages:2,pageSize:12,total:13,items:[{personId,displayName:"DEMO — Synthetic אדם "+"long ".repeat(20),identityKind:"adult",...fields,version:1,mode:"demo",archived:false,doNotContact:false,references:[],caseLinks:[]}]}},onSheet:()=>{}}));expect((html.match(/<form/g)||[]).length).toBe(1);expect(html).toContain('<table>');expect(html).toContain('scope="col"');expect(html).toContain('type="search"');expect(html).toContain('lsu-native-cards');expect(html).not.toContain('id="add-prospect"');expect(html).not.toContain('role="switch"');expect(html).not.toContain('href="#');expect(html).not.toContain(fields.notes);});
test("person/demo deep link survives normal same-role login; malformed or foreign context is excluded",()=>{const path=practitionerReturnPath("he","clients",{section:"paid",personId,mode:"demo",role:"parent"});expect(path).toBe(`/he/app/clients?section=paid&personId=${personId}&mode=demo`);expect(loginReturnDestination("he","practitioner",path)).toBe(path);expect(loginReturnDestination("he","parent",path)).toBe("/he/family/schedule");expect(practitionerReturnPath("he","clients",{personId:"../../escape",mode:"production",role:"practitioner"})).toBe("/he/app/clients");});
test.each([["live",false,true],["live",true,false],["demo",false,false]] as const)("%s opted-out=%s person respects communication suppression",(mode,doNotContact,allowed)=>{
 const row:NativeContactRow={personId,displayName:"Synthetic person",identityKind:"adult",...fields,version:1,mode,archived:false,doNotContact,references:[{leadId:"LS-LEAD-synthetic",phone:"+15550000111",email:"",language:"en",source:"synthetic",campaign:"",outcome:"",messageReceipt:"",paymentClaim:"",bookingClaim:"",formSentClaim:"",formSubmittedClaim:"",sourceFileId:"synthetic",sourceSheetId:1,sourceRevision:"synthetic",journey:{journeyState:"prospect",paymentVerified:false,bookingConfirmed:false}}]};
 const html=renderToStaticMarkup(createElement(NativePeopleWorkspace,{locale:"en",view:"all",initial:{source:"native",authorityEpoch:3,page:{page:1,pages:1,pageSize:12,total:1,items:[row]}},initialMode:mode,initialPersonId:personId,onSheet:()=>{}}));
 expect(html.includes('href="https://wa.me/15550000111"')).toBe(allowed);
 expect(html.includes("Do not contact: communication actions are unavailable.")).toBe(doNotContact);
 expect(html).not.toContain('class="lsu-person-row"');
});
test("missing legacy lead never exposes an unrelated directory or empty-directory success",()=>{
 const html=renderToStaticMarkup(createElement(NativePeopleWorkspace,{locale:"en",view:"prospects",initial:{source:"native",authorityEpoch:3,page:{page:1,pages:1,pageSize:12,total:0,items:[]}},initialLeadId:"LS-LEAD-synthetic-missing",onSheet:()=>{}}));
 expect(html).toContain("This person is not in the authorized view.");expect(html).not.toContain("lsu-people-toolbar");expect(html).not.toContain("No people match these filters.");
});
test("legacy workflows filter the whole native result and never treat a historical paid claim as verification",()=>{
 const ref:NativeContactReference={leadId:'LS-LEAD-synthetic',phone:'',email:'',language:'en',source:'synthetic',campaign:'',outcome:'',messageReceipt:'',paymentClaim:'Paid',bookingClaim:'Confirmed',formSentClaim:'',formSubmittedClaim:'',sourceFileId:'synthetic',sourceSheetId:1,sourceRevision:'synthetic',journey:{journeyState:'prospect',paymentVerified:false,bookingConfirmed:false}};
 const row:NativeContactRow={personId,displayName:'Synthetic inquiry',identityKind:'adult',...fields,version:1,mode:'live',archived:false,doNotContact:false,references:[ref]};
 const q={view:'prospects' as const,search:'',today:'2026-09-28',page:1,pageSize:12};
 expect(selectNativeContacts([row,{...row,personId:'later',followUpDate:'2026-09-29'}],{...q,filter:'today'}).total).toBe(1);
 expect(selectNativeContacts([row],{...q,filter:'new'}).total).toBe(1);
 expect(selectNativeContacts([row],{...q,filter:'booking'}).total).toBe(0);
 const intake={...row,references:[{...ref,formSentClaim:'synthetic-sent'}]};
 expect(selectNativeContacts([intake],{...q,filter:'intake'}).total).toBe(1);expect(selectNativeContacts([intake],{...q,filter:'new'}).total).toBe(0);
 const submitted={...intake,references:[{...ref,formSentClaim:'synthetic-sent',formSubmittedClaim:'synthetic-submitted'}]};
 expect(selectNativeContacts([submitted],{...q,filter:'payment'}).total).toBe(1);expect(selectNativeContacts([submitted],{...q,filter:'intake'}).total).toBe(0);
 const realSubmitted={...row,references:[{...ref,journey:{...ref.journey,journeyState:'awaiting_payment'}}]};
 expect(selectNativeContacts([realSubmitted],{...q,filter:'payment'}).total).toBe(1);expect(selectNativeContacts([realSubmitted],{...q,filter:'new'}).total).toBe(0);
 const paid={...submitted,references:[{...ref,journey:{journeyState:'awaiting_booking',paymentVerified:true,bookingConfirmed:false}}]};
 expect(selectNativeContacts([paid],{...q,filter:'payment'}).total).toBe(0);expect(selectNativeContacts([paid],{...q,filter:'booking'}).total).toBe(1);
 expect(selectNativeContacts([{...row,archived:true}],{...q,filter:'archived'}).total).toBe(1);
});

test("one new inquiry remains visible beside an older completed reference and an active assigned case",()=>{
 const fresh:NativeContactReference={leadId:'LS-LEAD-synthetic-fresh',phone:'',email:'',language:'he',source:'synthetic',campaign:'',outcome:'',messageReceipt:'',paymentClaim:'',bookingClaim:'',formSentClaim:'',formSubmittedClaim:'',sourceFileId:'synthetic',sourceSheetId:1,sourceRevision:'synthetic',journey:{journeyState:'prospect',paymentVerified:false,bookingConfirmed:false}};
 const old:NativeContactReference={...fresh,leadId:'LS-LEAD-synthetic-old',formSentClaim:'sent',formSubmittedClaim:'submitted',journey:{journeyState:'active',paymentVerified:true,bookingConfirmed:true}};
 const row:NativeContactRow={personId,displayName:'Synthetic returning inquiry',identityKind:'adult',...fields,version:1,mode:'live',archived:false,doNotContact:false,references:[old,fresh],caseLinks:[{caseId:'synthetic-case',state:'active'}]};
 const q={view:'prospects' as const,search:'',today:'2026-09-28',page:1,pageSize:12,filter:'new' as const};
 expect(selectNativeContacts([row],q).total).toBe(1);
 expect(selectNativeContacts([{...row,references:[fresh,old]}],q).total).toBe(1);
 expect(selectNativeContacts([{...row,references:[old]}],q).total).toBe(0);
 expect(selectNativeContacts([{...row,references:[]}],q).total).toBe(0);
 expect(selectNativeContacts([{...row,references:[],caseLinks:[]}],q).total).toBe(1);
 expect(selectNativeContacts([{...row,version:null}],q).total).toBe(0);
});

test("archived marketing history and contact opt-out never revoke an active assigned client's visibility",()=>{
 const row:NativeContactRow={personId,displayName:'Synthetic active client',identityKind:'adult',...fields,version:1,mode:'live',archived:true,doNotContact:false,references:[],caseLinks:[{caseId:'synthetic-active-case',state:'active'}]};
 const q={view:'active' as const,search:'',today:'2026-09-28',page:1,pageSize:12};
 expect(selectNativeContacts([row],q).total).toBe(1);
 expect(selectNativeContacts([row],{...q,view:'archived'}).total).toBe(0);
 const optedOut={...row,doNotContact:true};
 expect(selectNativeContacts([optedOut],q).items[0]?.doNotContact).toBe(true);
 expect(selectNativeContacts([{...optedOut,caseLinks:[]}],q).total).toBe(0);
 expect(selectNativeContacts([optedOut],{...q,view:'prospects'}).total).toBe(0);
});

test.each(['invited','intake','paused','completed','archived'])("assigned %s clients are not invented prospects or active clients",state=>{
 const row:NativeContactRow={personId,displayName:'Synthetic assigned client',identityKind:'adult',...fields,version:1,mode:'live',archived:false,doNotContact:false,references:[],caseLinks:[{caseId:'synthetic-case',state}]};
 const q={view:'all' as const,search:'',today:'2026-09-28',page:1,pageSize:12};
 for(const version of [null,1]){
  const current={...row,version};
  expect(selectNativeContacts([current],q).total).toBe(1);
  expect(selectNativeContacts([current],{...q,view:'prospects'}).total).toBe(0);
  expect(selectNativeContacts([current],{...q,view:'active'}).total).toBe(0);
  expect(selectNativeContacts([current],{...q,filter:'new'}).total).toBe(0);
 }
 const ref:NativeContactReference={leadId:'LS-LEAD-synthetic-returning',phone:'',email:'',language:'en',source:'synthetic',campaign:'',outcome:'',messageReceipt:'',paymentClaim:'',bookingClaim:'',formSentClaim:'',formSubmittedClaim:'',sourceFileId:'synthetic',sourceSheetId:1,sourceRevision:'synthetic',journey:{journeyState:'prospect',paymentVerified:false,bookingConfirmed:false}};
 expect(selectNativeContacts([{...row,references:[ref]}],{...q,view:'prospects',filter:'new'}).total).toBe(1);
});

test.each(['Archived — old inquiry','Closed — old inquiry','Not interested'])("%s reference does not fabricate a returning inquiry for an active client",outcome=>{
 const ref:NativeContactReference={leadId:'LS-LEAD-synthetic-old',phone:'',email:'',language:'en',source:'synthetic',campaign:'',outcome,messageReceipt:'',paymentClaim:'',bookingClaim:'',formSentClaim:'',formSubmittedClaim:'',sourceFileId:'synthetic',sourceSheetId:1,sourceRevision:'synthetic',journey:{journeyState:'prospect',paymentVerified:false,bookingConfirmed:false}};
 const row:NativeContactRow={personId,displayName:'Synthetic active client',identityKind:'adult',...fields,version:1,mode:'live',archived:false,doNotContact:false,references:[ref],caseLinks:[{caseId:'synthetic-case',state:'active'}]};
 const q={view:'prospects' as const,search:'',today:'2026-09-28',page:1,pageSize:12};
 expect(selectNativeContacts([row],q).total).toBe(0);
 for(const [filter,formSentClaim,formSubmittedClaim] of [['new','',''],['intake','sent',''],['payment','sent','submitted']] as const)expect(selectNativeContacts([{...row,references:[{...ref,formSentClaim,formSubmittedClaim}]}],{...q,filter}).total).toBe(0);
 expect(selectNativeContacts([row],{...q,view:'active'}).total).toBe(1);
 const paid={...ref,journey:{journeyState:'awaiting_booking',paymentVerified:true,bookingConfirmed:false}};
 expect(selectNativeContacts([{...row,references:[paid]}],{...q,view:'paid'}).total).toBe(0);
 expect(selectNativeContacts([{...row,references:[paid]}],{...q,filter:'booking'}).total).toBe(0);
 expect(selectNativeContacts([{...row,references:[paid,{...paid,leadId:'LS-LEAD-synthetic-open-paid',outcome:''}]}],{...q,view:'paid'}).total).toBe(1);
 expect(selectNativeContacts([{...row,references:[ref,{...ref,leadId:'LS-LEAD-synthetic-fresh',outcome:''}]}],{...q,filter:'new'}).total).toBe(1);
});
