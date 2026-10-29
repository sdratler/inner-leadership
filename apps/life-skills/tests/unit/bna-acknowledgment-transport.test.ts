import {randomUUID} from "node:crypto";
import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {BNA_COOP_NOTICE,type BnaCoopFields} from "../../src/features/bna-inquiry/coop-contract.ts";
import {BNA_EMAIL_SOURCE,BNA_EMAIL_SENDER,freezeBnaAcknowledgment} from "../../src/features/bna-communications/delivery-policy.ts";
import {bnaEmailCandidates} from "../../src/features/bna-communications/email-candidates.ts";
import {bnaRecipientSha256,readBnaDispatchAdmission,type BnaDispatchAdmission} from "../../src/features/bna-communications/dispatch-admission.ts";
import {createBnaAcknowledgmentTransport} from "../../src/features/bna-communications/acknowledgment-transport.ts";

function fixture(){
 const owner=randomUUID(),workspace=randomUUID(),reference=randomUUID(),project=randomUUID(),environment=randomUUID(),service=randomUUID();
 let now=new Date("2026-10-29T18:00:00Z");const clock={now:()=>now};
 const policy:BnaDispatchAdmission={version:1,mode:"controlled_test",workspaceId:workspace,ownerAccountId:owner,sender:BNA_EMAIL_SENDER,sourceSha256:BNA_EMAIL_SOURCE,
  activatedAt:"2026-10-29T17:00:00Z",expiresAt:"2026-10-29T20:00:00Z",releaseCommit:"a".repeat(40),
  messageCopies:{"EMAIL-B0":bnaEmailCandidates.messages.find(item=>item.id==="EMAIL-B0")!.copySha256,"EMAIL-S0":bnaEmailCandidates.messages.find(item=>item.id==="EMAIL-S0")!.copySha256},
  target:{projectId:project,environmentId:environment,serviceId:service,databaseSystemId:"1234567890123456789"},
  references:[{inquiryId:reference,templateId:"EMAIL-B0",locale:"he",recipientSha256:bnaRecipientSha256("owner@example.invalid")}]};
 const env:Record<string,string|undefined>={LS_BNA_EMAIL_QUEUE_ENABLED:"true",LS_BNA_EMAIL_WORKER_ENABLED:"true",LS_BNA_EMAIL_CONTROLLED_SEND_ENABLED:"true",LS_BNA_EMAIL_SEND_ENABLED:"false",
  LS_BNA_EMAIL_SOURCE_SHA256:BNA_EMAIL_SOURCE,LS_BNA_EMAIL_QUEUE_SINCE:policy.activatedAt,LS_IDENTITY_WORKSPACE_ID:workspace,LS_BNA_OWNER_ACCOUNT_ID:owner,
  LS_AUTH_EMAIL_ENABLED:"true",LS_AUTH_EMAIL_PROVIDER:"gmail",LS_AUTH_EMAIL_FROM:BNA_EMAIL_SENDER,
  LS_AUTH_GOOGLE_CLIENT_ID:"synthetic-client",LS_AUTH_GOOGLE_CLIENT_SECRET:"synthetic-client-secret",LS_AUTH_GOOGLE_REFRESH_TOKEN:"synthetic-refresh-token",
  LS_ACADEMY_OWNER_NOTIFICATION_TO:"owner@example.invalid",LS_DATABASE_TLS:"require",RAILWAY_PROJECT_ID:project,RAILWAY_ENVIRONMENT_ID:environment,RAILWAY_SERVICE_ID:service,
  RAILWAY_GIT_COMMIT_SHA:policy.releaseCommit,LS_BNA_EMAIL_DISPATCH_ADMISSION_JSON:JSON.stringify(policy)};
 const fields:BnaCoopFields={name:"SYNTHETIC ADULT",contactChannel:"email",contact:"owner@example.invalid",language:"he",siteLanguage:"en",townOrZip:"PRIVATE TOWN",childAges:[10],emailUpdates:false,
  permission:{confirmed:true,language:"en",version:BNA_COOP_NOTICE.version}};
 const message={id:randomUUID(),inquiryId:reference,createdAt:"2026-10-29T17:30:00Z",recipientKey:"b".repeat(64),payload:freezeBnaAcknowledgment("bna_learning_coop",reference,fields)!};
 return {env,policy,clock,message,setNow:(value:string)=>{now=new Date(value);}};
}

it("default/mismatched admissions cannot reach OAuth or a message request",async()=>{
 for(const change of [{LS_BNA_EMAIL_WORKER_ENABLED:"false"},{LS_BNA_EMAIL_SEND_ENABLED:"true"},{LS_BNA_EMAIL_QUEUE_SINCE:"2026-10-28T00:00:00Z"},{RAILWAY_SERVICE_ID:randomUUID()},{LS_DATABASE_TLS:"disable"},{LS_ACADEMY_OWNER_NOTIFICATION_TO:"other@example.invalid"}]){
  const f=fixture(),fetcher=vi.fn();Object.assign(f.env,change);expect(()=>createBnaAcknowledgmentTransport(f.env,f.clock,async()=>{},fetcher as typeof fetch)).toThrow();expect(fetcher).not.toHaveBeenCalled();
 }
});
it("the controlled lane binds reference, recipient, language, exact copy and cutoff without broadening a send",async()=>{
 const f=fixture(),fetcher=vi.fn(),transport=createBnaAcknowledgmentTransport(f.env,f.clock,async()=>{},fetcher as typeof fetch);
 expect(transport.authorize(f.message)).toBe(true);
 for(const message of [{...f.message,inquiryId:randomUUID()},{...f.message,createdAt:"2026-10-29T16:59:59Z"},{...f.message,payload:{...f.message.payload,recipient:"family@example.invalid"}},{...f.message,payload:{...f.message.payload,locale:"en" as const}},{...f.message,payload:{...f.message.payload,copySha256:"0".repeat(64)}}]){
  expect(transport.authorize(message)).toBe(false);expect(await transport.send(message)).toEqual({state:"not_attempted"});
 }
 expect(fetcher).not.toHaveBeenCalled();
});
it("sends the frozen Hebrew text through the existing Office transport with the BNA name and stable message identity",async()=>{
 const f=fixture();let raw="",requests=0,verified=0;
 const fetcher:typeof fetch=async(input,init)=>{
  if(String(input)==="https://oauth2.googleapis.com/token")return new Response(JSON.stringify({access_token:"synthetic-access-token"}));
  expect(String(input)).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");requests++;
  raw=Buffer.from(JSON.parse(String(init?.body)).raw,"base64url").toString("utf8");return new Response(JSON.stringify({id:"synthetic-gmail-id"}));
 };
 const transport=createBnaAcknowledgmentTransport(f.env,f.clock,async()=>{verified++;},fetcher);
 expect(await transport.send(f.message)).toEqual({state:"accepted",providerId:"synthetic-gmail-id"});
 expect(requests).toBe(1);expect(verified).toBe(2);expect(raw).toContain("From: BNA Office <office@bneineviimacademy.org>");
 expect(raw).toContain(`Message-ID: <ls-auth-${f.message.id}@bneineviimacademy.org>`);expect(raw).not.toMatch(/Bcc:|Life Skills|JLFA Office|PRIVATE TOWN/);
 expect(Buffer.from(raw.split("\r\n\r\n")[1]!,"base64").toString("utf8")).toBe(f.message.payload.text);
});
it("expiry or authority loss during OAuth prevents the irreversible message request",async()=>{
 for(const reason of ["expired","flag"]){
  const f=fixture();let sent=0;
  const fetcher:typeof fetch=async input=>{if(String(input).includes("oauth2")){if(reason==="expired")f.setNow("2026-10-29T20:00:00Z");else f.env.LS_BNA_EMAIL_CONTROLLED_SEND_ENABLED="false";return new Response(JSON.stringify({access_token:"synthetic-access-token"}));}sent++;return new Response(JSON.stringify({id:"unexpected"}));};
  const transport=createBnaAcknowledgmentTransport(f.env,f.clock,async()=>{},fetcher);expect(await transport.send(f.message)).toEqual({state:"not_attempted"});expect(sent).toBe(0);
 }
});
it("a database/proof refusal is not a send, but an uncertain message request is never retried",async()=>{
 const f=fixture(),fetcher=vi.fn();
 expect(await createBnaAcknowledgmentTransport(f.env,f.clock,async()=>{throw Error("SYNTHETIC_TARGET_REFUSAL");},fetcher as typeof fetch).send(f.message)).toEqual({state:"not_attempted"});expect(fetcher).not.toHaveBeenCalled();
 let messages=0;const losing:typeof fetch=async input=>{if(String(input).includes("oauth2"))return new Response(JSON.stringify({access_token:"synthetic-access-token"}));messages++;throw Error("SYNTHETIC_PROVIDER_RESPONSE_LOST");};
 expect(await createBnaAcknowledgmentTransport(f.env,f.clock,async()=>{},losing).send(f.message)).toEqual({state:"unknown"});expect(messages).toBe(1);
});
it("future service requests require explicit production flags and separate native controlled proofs",()=>{
 const f=fixture(),{releaseCommit:_,expiresAt:__,references:___,...base}=f.policy as Extract<BnaDispatchAdmission,{mode:"controlled_test"}>;void _;void __;void ___;
 const future={...base,mode:"future_requests",controlledProofs:{b0:randomUUID(),s0:randomUUID(),inboxReadbackSha256:"c".repeat(64)}};
 f.env.LS_BNA_EMAIL_DISPATCH_ADMISSION_JSON=JSON.stringify(future);expect(()=>readBnaDispatchAdmission(f.env,f.clock.now())).toThrow();
 f.env.LS_BNA_EMAIL_CONTROLLED_SEND_ENABLED="false";f.env.LS_BNA_EMAIL_SEND_ENABLED="true";expect(readBnaDispatchAdmission(f.env,f.clock.now()).mode).toBe("future_requests");
});
