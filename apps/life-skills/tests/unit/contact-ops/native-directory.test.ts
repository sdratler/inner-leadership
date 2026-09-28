import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {selectNativeContacts,type NativeContactRow,type NativeContactQuery,type NativeContactReference} from "../../../src/features/contact-ops/server/native-directory.ts";
const query=(patch:Partial<NativeContactQuery>={}):NativeContactQuery=>({view:"all",search:"",today:"2026-09-28",page:1,pageSize:20,...patch});
const reference=(patch:Partial<NativeContactReference>={}):NativeContactReference=>({leadId:"LS-LEAD-synthetic",phone:"+972520000001",email:"demo+synthetic@example.invalid",language:"he",source:"Synthetic",campaign:"",outcome:"",messageReceipt:"",paymentClaim:"PAID",bookingClaim:"Confirmed",formSentClaim:"",formSubmittedClaim:"",sourceFileId:"synthetic-workbook",sourceSheetId:0,sourceRevision:"synthetic-rev",journey:{journeyState:"prospect",paymentVerified:false,bookingConfirmed:false},...patch});
const row=(id:string,patch:Partial<NativeContactRow>={}):NativeContactRow=>({personId:id,displayName:"Synthetic "+id,identityKind:"adult",stage:"new",nextAction:"Follow up",followUpDate:"2026-09-28",notes:"Synthetic administrative note",version:1,mode:"live",archived:false,doNotContact:false,references:[reference()],...patch});

describe("complete native contact result selection",()=>{
 it("searches and filters the entire source result before server pagination",()=>{
  const rows=Array.from({length:125},(_,i)=>row(String(i).padStart(3,"0")));
  rows[124]=row("124",{displayName:"Hebrew owner-approved synthetic name",references:[reference({email:"demo+last@example.invalid"})]});
  expect(selectNativeContacts(rows,query({search:"+last"}))).toMatchObject({total:1,page:1,pages:1,items:[{personId:"124"}]});
  expect(selectNativeContacts(rows,query({page:7}))).toMatchObject({total:125,page:7,pages:7});
  expect(selectNativeContacts(rows,query({page:999})).page).toBe(7);
 });
 it("keeps archived and opted-out people in All without adding them to any open queue",()=>{
  const rows=[row("open"),row("archived",{archived:true}),row("suppressed",{doNotContact:true})];
  expect(selectNativeContacts(rows,query()).total).toBe(3);
  expect(selectNativeContacts(rows,query({view:"prospects"})).items.map(p=>p.personId)).toEqual(["open"]);
  expect(selectNativeContacts(rows,query({view:"archived"})).items.map(p=>p.personId)).toEqual(["archived","suppressed"]);
 });
 it("never makes paid/active/booked from imported payment or booking text",()=>{
  const rows=[row("claim-only")];
  expect(selectNativeContacts(rows,query({view:"paid"})).total).toBe(0);
  expect(selectNativeContacts(rows,query({view:"active"})).total).toBe(0);
 });
 it("keeps independent linked journeys rather than promoting siblings through one paid flag",()=>{
  const rows=[row("family",{references:[reference({leadId:"LS-LEAD-child-a",journey:{journeyState:"active",paymentVerified:true,bookingConfirmed:true}}),
   reference({leadId:"LS-LEAD-child-b",journey:{journeyState:"awaiting_booking",paymentVerified:true,bookingConfirmed:false}})]})];
  expect(selectNativeContacts(rows,query({view:"active"})).items[0]?.personId).toBe("family");
  expect(selectNativeContacts(rows,query({view:"paid"})).items[0]?.personId).toBe("family");
  const reversed=[row("reversed",{references:[reference({journey:{journeyState:"awaiting_booking",paymentVerified:false,bookingConfirmed:false}})]})];
  expect(selectNativeContacts(reversed,query({view:"paid"})).total).toBe(0);
  const hold=[row("hold",{references:[reference({journey:{journeyState:"hold",paymentVerified:true,bookingConfirmed:false}})]})];
  expect(selectNativeContacts(hold,query({view:"paid"})).total).toBe(0);
 });
 it("shows overdue items in Today and uses an explicit demo-only view",()=>{
  const rows=[row("old",{followUpDate:"2026-09-27"}),row("today"),row("future",{followUpDate:"2026-09-29"}),row("demo",{mode:"demo"})];
  expect(selectNativeContacts(rows,query({due:"today"})).items.map(p=>p.personId)).toEqual(["old","today"]);
  expect(selectNativeContacts(rows,query({mode:"demo"})).items.map(p=>p.personId)).toEqual(["demo"]);
 });
 it("validates date, paging and bounded query values",()=>{
  expect(()=>selectNativeContacts([],query({today:"2026-02-30"}))).toThrow();
  expect(()=>selectNativeContacts([],query({pageSize:101}))).toThrow();
  expect(()=>selectNativeContacts([],query({page:0}))).toThrow();
  expect(()=>selectNativeContacts([],query({search:"x".repeat(201)}))).toThrow();
 });
});
