/** Explicit disposable runner only; synthetic Scout GETs, no real provider writer. */
import {createServer as httpsServer} from "node:https";
import type {Server} from "node:net";
import type {Fixture} from "../../database/calendar/fixture.ts";
import {randomBytes,createHash} from "node:crypto";
import {hashPassword,blindEmail,seal} from "../../../src/features/identity/crypto.ts";

export async function communityCredentials(f:Fixture,lookup:Buffer){
 const credentials=[];
 for(const[role,account]of[["practitioner",f.practitioner],["parent",f.parent]]as const){
  const email=`synthetic-community-${role}@example.invalid`,password=randomBytes(18).toString("base64url");
  await f.pool.query("UPDATE ls_identity.accounts SET password_hash=$3,email_blind=$4,email_ciphertext=$5 WHERE workspace_id=$1 AND id=$2",
   [f.workspaceId,account.actor.id,await hashPassword(password),blindEmail(email,lookup),seal(email,`email:${f.workspaceId}:${account.actor.id}`,f.keyring)]);
  credentials.push({role,email,password});
 }
 await f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1",[f.workspaceId]);return credentials;
}
export async function communityProtectedSnapshot(f:Fixture){
 return Promise.all(["ls_calendar.tasks","ls_calendar.appointments","ls_cases.cases","ls_cases.case_guardians","ls_contact_ops.profiles",
  "ls_contact_ops.outbound_projections","ls_identity.auth_mail_outbox","ls_onboarding.first_session_orders"].map(async table=>({table,
   digest:createHash("sha256").update(JSON.stringify((await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[f.workspaceId])).rows)).digest("hex")})));
}
const listen=async(server:Server)=>{await new Promise<void>((ok,fail)=>{server.once("error",fail);server.listen(0,"127.0.0.1",ok);});return (server.address()as{port:number}).port;};
export async function communityReadTransport(key:Buffer,cert:Buffer){
 const secret=randomBytes(32).toString("base64url"),reads:string[]=[],blocked:string[]=[];
 const reject=(reason:string)=>{if(blocked.length<8)blocked.push(reason);};
 let mode="normal";
 const fixture=httpsServer({key,cert},(req,res)=>{
  const url=new URL(req.url??"/","https://localhost"),send=(status:number,data:unknown)=>{res.writeHead(status,{"content-type":"application/json"});res.end(JSON.stringify(data));};
  if(req.headers.authorization!=="Bearer "+secret){send(403,{ok:false});return;}
  if(url.pathname==="/control"&&req.method==="POST"){
   const next=url.searchParams.get("mode");if(!["normal","fail","empty"].includes(next??"")){send(400,{ok:false});return;}
   mode=next!;send(200,{ok:true});return;
  }
  if(url.pathname==="/control"&&req.method==="GET"){send(200,{ok:true,reads,blocked});return;}
  if(req.method!=="GET"){reject("NON_READ_METHOD");send(405,{ok:false});return;}
  if(reads.length>=128){reject("READ_LIMIT");send(503,{ok:false});return;}
  reads.push(url.pathname);
  if(url.pathname==="/internal/life-skills/posts"){
   if(mode==="fail"){send(503,{ok:false});return;}
   const status=url.searchParams.get("status")??"all",base={groupUrl:"https://www.facebook.com/groups/synthetic-public",postedAt:"2026-10-15T08:00:00Z",capturedAt:null,excerptTruncated:false,draft:"",reviewStatus:"",revision:1,copiedAt:null,manuallyPostedAt:null,commentsCaptured:false};
   const items=[{...base,id:1,groupName:"Synthetic public group / קבוצה ציבורית לבדיקה",postUrl:base.groupUrl+"/posts/1",excerpt:"שאלה ציבורית סינתטית בלבד. ".repeat(18),status:"ready",
    englishReadingAid:["Synthetic English reading aid only.","The original excerpt remains authoritative."],englishReadingAidSourceHash:"a".repeat(64),englishReadingAidGeneratedAt:"2026-10-15T08:00:00Z",englishReadingAidMethod:"existing_analysis"},
    {...base,id:2,groupName:"Synthetic legacy source",postUrl:base.groupUrl+"/posts/2",excerpt:"Synthetic original without an English aid.",status:"constructor"}];
   send(200,{ok:true,data:{items:mode==="empty"?[]:items.filter(p=>status==="all"||p.status===status),nextCursor:null,commentsCaptureAvailable:false}});return;
  }
  if(url.pathname==="/internal/life-skills/drafts"){send(200,{ok:true,data:{drafts:[],limit:20}});return;}
  if(url.pathname==="/internal/life-skills/threads"){
   send(200,{ok:true,data:url.searchParams.get("pending")==="true"?{responses:[],more:false}:{threads:[],responses:[],partial:false,captureStatus:null,autonomousCollectionEnabled:false}});return;
  }
  reject("UNEXPECTED_PATH");send(404,{ok:false});
 });
 const fixturePort=await listen(fixture);
 return {secret,controlOrigin:`https://localhost:${fixturePort}`,reads,blocked,
  close:async()=>{fixture.closeAllConnections();await new Promise<void>(ok=>fixture.close(()=>ok()));}};
}
