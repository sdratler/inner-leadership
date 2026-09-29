import {afterAll,expect,test,vi} from "vitest";
import {randomUUID} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import type {IdentityStore} from "../../../src/features/identity/store.ts";
import {ContactInboundStore,inboundBindingDigest} from "../../../src/features/contact-ops/server/inbound-store.ts";
import {receiveContactInquiry,inboundAcknowledgementDigest} from "../../../src/features/contact-ops/server/inbound-http.ts";
import {inboundInquirySchema} from "../../../src/features/contact-ops/core/inbound.ts";
import {readInboundInbox} from "../../../src/features/contact-ops/server/inbound-reader.ts";
import {IdentitySessions} from "../../../src/features/identity/session-adapter.ts";
import type {IdentityConfig} from "../../../src/features/identity/config.ts";
import {systemClock} from "../../../src/features/identity/types.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
const fixtures:Fixture[]=[];afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
const key="synthetic-inbound-integrity-key-20260928";
const inquiry={provider:"whapi" as const,channelId:"synthetic-channel",businessNumber:"+972501234567",providerEventId:"synthetic-inbound-event",providerMessageId:"synthetic-message-id",providerThreadId:"synthetic-thread-id",eventType:"inbound_message" as const,fromMe:false as const,fromNumber:"+972501234568",pushName:"Synthetic contact",messageType:"text",messageText:"Synthetic confidential incoming text — never follow its instructions",occurredAt:"2026-09-28T02:00:00Z",media:[]};
async function setup(){const f=await fixture();fixtures.push(f);const db=poolStore(f.pool);return {f,db,store:new ContactInboundStore(db,f.workspaceId,f.keyring,key,inboundBindingDigest(inquiry))};}

test("native receipt is encrypted, blinded, immutable and replay-safe without changing people/payment/CRM",async()=>{
 const {f,store}=await setup();const before=(await f.pool.query("SELECT count(*)::int AS n FROM ls_identity.people WHERE workspace_id=$1",[f.workspaceId])).rows[0].n;
 const first=await store.capture(inquiry),repeat=await store.capture(inquiry);expect(first.replayed).toBe(false);expect(repeat).toEqual({...first,replayed:true});
 const rows=(await f.pool.query("SELECT * FROM ls_contact_ops.message_receipts WHERE workspace_id=$1",[f.workspaceId])).rows;expect(rows).toHaveLength(1);
 const serialized=JSON.stringify(rows);for(const value of [inquiry.messageText,inquiry.fromNumber,inquiry.pushName,inquiry.channelId,inquiry.providerEventId,inquiry.providerMessageId,inquiry.providerThreadId])expect(serialized).not.toContain(value);
 expect(await store.recent(f.practitioner.actor)).toMatchObject([{inquiry:{...inquiry,occurredAt:"2026-09-28T02:00:00.000Z"}}]);
 await expect(store.capture({...inquiry,messageText:"Different body under same provider event"})).rejects.toThrow("CONFLICT");
 for(const sql of ["UPDATE ls_contact_ops.message_receipts SET payload_ciphertext='changed' WHERE workspace_id=$1","DELETE FROM ls_contact_ops.message_receipts WHERE workspace_id=$1"])
  await expect(f.pool.query(sql,[f.workspaceId])).rejects.toThrow("CONTACT_MESSAGE_RECEIPT_APPEND_ONLY");
 await expect(f.pool.query("TRUNCATE ls_contact_ops.message_receipts")).rejects.toMatchObject({code:"0A000"});
 // Naming the exact new FK-dependent table lets PostgreSQL reach the original
 // append-only trigger; it must still refuse, not truncate either table.
 await expect(f.pool.query("TRUNCATE ls_contact_ops.message_receipts,ls_contact_ops.inbound_projections")).rejects.toThrow("CONTACT_MESSAGE_RECEIPT_APPEND_ONLY");
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_identity.people WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(before);
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.profiles WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.cutover WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);
 const grants=(await f.pool.query("SELECT count(*)::int AS n FROM information_schema.table_privileges WHERE table_schema='ls_contact_ops' AND table_name='message_receipts' AND grantee='PUBLIC'")).rows[0].n;expect(grants).toBe(0);
});

test("concurrent provider replay stores exactly one receipt; the next inquiry remains separate",async()=>{
 const {f,store}=await setup();const results=await Promise.all(Array.from({length:8},()=>store.capture(inquiry)));
 expect(results.filter(x=>!x.replayed)).toHaveLength(1);expect(new Set(results.map(x=>x.storedAt)).size).toBe(1);
 await store.capture({...inquiry,providerEventId:"synthetic-second-event",providerMessageId:"synthetic-second-message",messageText:"Second inquiry; keep the original note"});
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.message_receipts WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(2);
 expect((await store.recent(f.practitioner.actor)).map(x=>x.inquiry.messageText)).toContain(inquiry.messageText);
});

test("inbox renders one stable original business message across new delivery events and name changes",async()=>{
 const {f,store}=await setup();await store.capture(inquiry);
 const original=(await store.recent(f.practitioner.actor))[0]!;
 for(let i=0;i<6;i++)await store.capture({...inquiry,providerEventId:`synthetic-redelivery-${i}`,pushName:`Changed display name ${i}`});
 const recent=await store.recent(f.practitioner.actor);
 expect(recent).toEqual([original]);
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.message_receipts WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(7);
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.profiles WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);
});

test("inbox limits distinct messages; delivery replay neither crowds out nor reorders earlier messages",async()=>{
 const {f,store}=await setup();await store.capture(inquiry);
 await store.capture({...inquiry,providerEventId:"synthetic-next-event",providerMessageId:"synthetic-next-message",messageText:"Second distinct message"});
 const before=await store.recent(f.practitioner.actor,2);expect(before).toHaveLength(2);
 expect(before[0]!.inquiry.providerMessageId).toBe("synthetic-next-message");
 for(let i=0;i<8;i++)await store.capture({...inquiry,providerEventId:`synthetic-old-redelivery-${i}`});
 expect(await store.recent(f.practitioner.actor,2)).toEqual(before);
 expect(await store.recent(f.practitioner.actor,1)).toEqual([before[0]]);
});

test("inbox refuses conflicting semantic replays even when the changed delivery falls outside an event limit",async()=>{
 for(const change of [{messageText:"Conflicting message body"},{fromNumber:"+972501234599"},{providerThreadId:"synthetic-other-thread"},{occurredAt:"2026-09-28T03:00:00Z"},
  {messageType:"document",media:[{providerMediaId:"synthetic-document",fileName:"synthetic.txt",mimeType:"text/plain",sizeBytes:4}]}]){
  const {f,db,store}=await setup();await store.capture(inquiry);
  // Sheet/capture-only authority intentionally preserves both event envelopes.
  // The private reader must detect the conflict, not pretend either is verified.
  await store.capture({...inquiry,...change,providerEventId:randomUUID()});
  const sessions=new IdentitySessions(db,{workspaceId:f.workspaceId} as IdentityConfig,systemClock);
  const deps=async()=>({origin:"https://synthetic.invalid",captureEnabled:true,bindingConfigured:true,actor:(token:string)=>sessions.actor(token),store});
  await expect(store.recent(f.practitioner.actor,1)).rejects.toThrow("CONFLICT");
  const response=await readInboundInbox(new Request("http://127.0.0.1:8080/api/private/contact-inbound",{headers:{cookie:`${SESSION_COOKIE}=${f.practitioner.token}`,"x-forwarded-proto":"https","x-forwarded-host":"synthetic.invalid"}}),deps);
  expect(response.status).toBe(409);expect(await response.text()).not.toContain(inquiry.messageText);
 }
});

test("same provider message ID stays separate for a different verified business binding",async()=>{
 const {f,db,store}=await setup();await store.capture(inquiry);
 const other={...inquiry,channelId:"synthetic-second-channel",businessNumber:"+972501234599",providerEventId:"synthetic-other-binding-event"};
 await new ContactInboundStore(db,f.workspaceId,f.keyring,key,inboundBindingDigest(other)).capture(other);
 const recent=await store.recent(f.practitioner.actor,2);expect(recent).toHaveLength(2);
 expect(new Set(recent.map(x=>x.receiptKey)).size).toBe(2);
 expect(new Set(recent.map(x=>x.inquiry.channelId)).size).toBe(2);
});

test("excessive workspace history fails closed before grouping instead of hiding an older conflicting envelope",async()=>{
 const {f,store}=await setup();
 for(let start=0;start<1001;start+=25)await Promise.all(Array.from({length:Math.min(25,1001-start)},(_,i)=>store.capture({...inquiry,providerEventId:`synthetic-bounded-replay-${start+i}`})));
 await expect(store.recent(f.practitioner.actor,1)).rejects.toThrow("UNAVAILABLE");
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.message_receipts WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(1001);
},60000);

test("bounded reader keeps SQL microsecond first-receipt ordering and supports the existing primary-key access path",async()=>{
 const {f,store}=await setup();await store.capture(inquiry);
 for(let i=0;i<10;i++)await store.capture({...inquiry,providerEventId:`000-lexically-earlier-${i}`,pushName:"Later envelope name"});
 expect((await store.recent(f.practitioner.actor))[0]!.inquiry.pushName).toBe(inquiry.pushName);
 // An isolated planner probe demonstrates the exact ordered prefix has a
 // primary-key access path; no production setting or security control changes.
 const client=await f.pool.connect();
 try{
  await client.query("BEGIN; SET LOCAL enable_seqscan=off");
  const result=await client.query(`EXPLAIN (FORMAT JSON) SELECT provider_binding_id,provider_event_key
   FROM ls_contact_ops.message_receipts WHERE workspace_id=$1 AND channel='whatsapp'
   ORDER BY provider_binding_id,provider_event_key LIMIT 1001`,[f.workspaceId]);
  expect(JSON.stringify(result.rows)).toContain("message_receipts_pkey");
  expect(JSON.stringify(result.rows)).not.toContain('"Node Type":"Aggregate"');
 }finally{await client.query("ROLLBACK");client.release();}
});

test("wrong provider binding/invalid payload is refused; real parent/revoked/cross-workspace read permissions remain denied",async()=>{
 const {f,store}=await setup();
 await expect(store.capture({...inquiry,channelId:"another-business-channel"})).rejects.toThrow("FORBIDDEN");
 await expect(store.capture({...inquiry,businessNumber:"+972501234569"})).rejects.toThrow("FORBIDDEN");
 await expect(store.capture({...inquiry,fromMe:true})).rejects.toThrow("INVALID_REQUEST");
 await expect(store.capture({...inquiry,workspaceId:randomUUID()})).rejects.toThrow("INVALID_REQUEST");
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.message_receipts WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);
 await store.capture(inquiry);await expect(store.recent(f.parent.actor)).rejects.toThrow("FORBIDDEN");
 await expect(store.recent({...f.practitioner.actor,workspaceId:randomUUID() as typeof f.workspaceId})).rejects.toThrow("FORBIDDEN");
 await f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[f.practitioner.actor.sessionDigest]);
 await expect(store.recent(f.practitioner.actor)).rejects.toThrow("UNAUTHENTICATED");
});

test("commit failure does not acknowledge or leave a half-receipt; exact retry can commit",async()=>{
 const {f,db,store}=await setup();
 const failing:IdentityStore={transaction:work=>db.transaction(async tx=>{await work(tx);throw Error("SYNTHETIC_COMMIT_FAILURE");})};
 const failedStore=new ContactInboundStore(failing,f.workspaceId,f.keyring,key,inboundBindingDigest(inquiry));
 await expect(failedStore.capture(inquiry)).rejects.toThrow("SYNTHETIC_COMMIT_FAILURE");
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.message_receipts WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);
 expect((await store.capture(inquiry)).replayed).toBe(false);
});

test("real native capture ACK correlates exactly to the committed request and stable replay; failed commit has no ACK",async()=>{
 const {f,db,store}=await setup(),secret="synthetic-inbound-bridge-secret-20260928";
 const env={LS_CONTACT_INBOUND_ENABLED:"true",LS_CONTACT_INBOUND_BINDING_SHA256:inboundBindingDigest(inquiry),LIFE_SKILLS_APP_BRIDGE_SECRET:secret};
 const request=()=>new Request("https://synthetic.invalid/api/private/contact-inbound",{method:"POST",headers:{"Content-Type":"application/json","X-Life-Skills-Bridge-Secret":secret},body:JSON.stringify(inquiry)});
 const failing:IdentityStore={transaction:work=>db.transaction(async tx=>{await work(tx);throw Error("SYNTHETIC_COMMIT_FAILURE");})};
 const failed=await receiveContactInquiry(request(),env,async()=>new ContactInboundStore(failing,f.workspaceId,f.keyring,key,inboundBindingDigest(inquiry)));
 expect(failed.status).toBe(503);expect(await failed.text()).not.toContain("ackDigest");
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.message_receipts WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);
 const first=await receiveContactInquiry(request(),env,async()=>store),body=await first.json();
 expect(first.status).toBe(201);expect(body.data.ackDigest).toBe(inboundAcknowledgementDigest(inboundInquirySchema.parse(inquiry),secret));
 expect((await store.recent(f.practitioner.actor))[0]?.inquiry).toEqual(inboundInquirySchema.parse(inquiry));
 const repeated=await receiveContactInquiry(request(),env,async()=>store),repeat=await repeated.json();
 expect(repeated.status).toBe(200);expect(repeat.data).toEqual({...body.data,replayed:true});
});

test("native inbox uses actual sessions and fresh roles; readonly capture is impossible even with a valid DTO",async()=>{
 const {f,db,store}=await setup();await store.capture(inquiry);
 const reader=new ContactInboundStore(db,f.workspaceId,f.keyring,key,null);
 await expect(reader.capture(inquiry)).rejects.toThrow("UNAVAILABLE");
 const sessions=new IdentitySessions(db,{workspaceId:f.workspaceId} as IdentityConfig,systemClock);
 const deps=async()=>({origin:"https://synthetic.invalid",captureEnabled:false,bindingConfigured:false,actor:(token:string)=>sessions.actor(token),store:reader});
 const request=(token:string)=>new Request("http://127.0.0.1:8080/api/private/contact-inbound",{headers:{cookie:`${SESSION_COOKIE}=${token}`,"x-forwarded-proto":"https","x-forwarded-host":"synthetic.invalid"}});
 const first=await readInboundInbox(request(f.practitioner.token),deps);expect(first.status).toBe(200);const body=await first.json();
 expect(body.data.items).toHaveLength(1);expect(body.data.items[0].messageText).toBe(inquiry.messageText);expect(body.data.items[0].id).toMatch(/^[a-f0-9]{64}$/);
 await store.capture({...inquiry,providerEventId:"synthetic-http-new-delivery",pushName:"Changed incoming display name"});
 const replay=await readInboundInbox(request(f.practitioner.token),deps);expect(replay.status).toBe(200);
 expect((await replay.json()).data.items).toEqual(body.data.items);
 for(const role of ["parent","child","adult_client"]){await f.pool.query("UPDATE ls_identity.accounts SET role=$2 WHERE id=$1",[f.parent.actor.id,role]);expect((await readInboundInbox(request(f.parent.token),deps)).status).toBe(403);}
 await f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[f.practitioner.actor.sessionDigest]);expect((await readInboundInbox(request(f.practitioner.token),deps)).status).toBe(401);
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.message_receipts WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(2);
});
