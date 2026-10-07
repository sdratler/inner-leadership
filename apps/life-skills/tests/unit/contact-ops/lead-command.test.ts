import {expect,test} from "vitest";
import {parseLeadText,leadPreviewRequestSchema,leadIntentSchema} from "../../../src/features/contact-ops/core/lead-command.ts";
const today="2026-10-06";
test("admitted recent caller example is a preview intent, not three writes",()=>{
 expect(parseLeadText("The guy who just called is Moshe Cohen. He's interested. Call him Sunday. Add him as a Life Skills lead.",today))
  .toEqual({recentCaller:true,name:"Moshe Cohen",promote:true,notLead:false,stage:"Prospect",nextAction:"Call",dueDate:"2026-10-11",google:false,whatsapp:false});
});
test("Hebrew natural caller command keeps the name and exact next date",()=>{
 expect(parseLeadText("האדם שהתקשר עכשיו הוא משה כהן. הוא מתעניין. להתקשר ביום ראשון. הוסף אותו כפנייה לכישורי חיים.",today))
  .toMatchObject({recentCaller:true,name:"משה כהן",promote:true,stage:"Prospect",nextAction:"להתקשר",dueDate:"2026-10-11"});
});
test("explicit phone/name and projections remain one owner-confirmed operation",()=>{
 expect(parseLeadText("Add Moshe Cohen +972501234567 as a Life Skills lead. Add to Google Contacts. Add WhatsApp label; Note: Spoke today, please call back.\nשורה שמורה",today))
  .toMatchObject({phone:"+972501234567",name:"Moshe Cohen",promote:true,google:true,whatsapp:true,note:"Spoke today, please call back.\nשורה שמורה"});
});
test("selected WhatsApp example and not-lead intent require later identity resolution",()=>{
 expect(parseLeadText("This WhatsApp is a lead; name is Yossi, spoke today, next action Monday.",today))
  .toMatchObject({name:"Yossi",promote:true,note:"spoke today",nextAction:"Follow up",dueDate:"2026-10-12"});
 expect(parseLeadText("This number isn't a lead.",today)).toMatchObject({notLead:true,promote:false});
});
test("terminal sentence-separated note preserves its contents without accepting unknown preceding clauses",()=>{
 expect(parseLeadText("The guy who just called. Note: saved, exactly.\nהמשך",today))
  .toMatchObject({recentCaller:true,note:"saved, exactly.\nהמשך"});
 expect(parseLeadText("האדם שהתקשר עכשיו. הערה: שורה ראשונה.\nשורה שנייה",today))
  .toMatchObject({recentCaller:true,note:"שורה ראשונה.\nשורה שנייה"});
 expect(parseLeadText("Charge him now. Note: retained",today)).toBeNull();
});
test.each(["Add a lead. Charge him now.","Stage: payment_verified","Stage: Constructor","Stage: __proto__", "Stage: Active",
 "Call him yesterday", "Call him 2026-02-30", "Add a lead +15550001001 +15550001002", "Screenshot of caller, no phone",
 "Please send him a message", "Add him as a lead. Not a lead", "Stage: Contacted. Stage: Prospect", "Call Sunday. Call Monday",
 "Name is First. The guy who just called is Second", "Note: "+"x".repeat(1001)])("unsupported or unsafe command has no partial intent: %s",text=>{
 expect(parseLeadText(text,today)).toBeNull();
});
test("normal stored custom status is not a generated approved stage or prototype hit",()=>{
 expect(leadIntentSchema.safeParse({recentCaller:false,promote:false,notLead:false,google:false,whatsapp:false,stage:"constructor"}).success).toBe(false);
});
test("structured boundary excludes clinical/provider/auth flags and two contexts",()=>{
 const request={action:"preview",operationId:"00000000-0000-4000-8000-000000000001",expectedEpoch:3,text:"Note: follow up"};
 expect(leadPreviewRequestSchema.safeParse(request).success).toBe(true);
 for(const patch of [{role:"practitioner"},{paymentVerified:true},{providerVerified:true},{clinicalNote:"private"},
  {candidateId:request.operationId,personId:request.operationId}])expect(leadPreviewRequestSchema.safeParse({...request,...patch}).success).toBe(false);
});
