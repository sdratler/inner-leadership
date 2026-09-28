import {afterAll,expect,test,vi} from "vitest";
import {randomUUID} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import type {IdentityStore} from "../../../src/features/identity/store.ts";
import {ContactInboundStore,inboundBindingDigest} from "../../../src/features/contact-ops/server/inbound-store.ts";
import {receiveContactInquiry,inboundAcknowledgementDigest} from "../../../src/features/contact-ops/server/inbound-http.ts";
import {inboundInquirySchema} from "../../../src/features/contact-ops/core/inbound.ts";
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
 await expect(f.pool.query("TRUNCATE ls_contact_ops.message_receipts")).rejects.toThrow("CONTACT_MESSAGE_RECEIPT_APPEND_ONLY");
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
