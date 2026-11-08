import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';
import {asId} from '../../src/lib/ids.ts';
import {AppError} from '../../src/lib/errors.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {seal,unseal,tokenDigest} from '../../src/features/identity/crypto.ts';
import {FishingBillingStore,type BillingAuthority,type BillingLedgerContext,type BillingOutboxReservation} from '../../src/features/fishing-billing/native.ts';
import {syntheticDefinition} from '../../src/features/fishing-billing/fixtures.ts';
import {reminderIntentSchema,reminderPolicySchema,type CreateFamilyOffer,type ReminderPolicy} from '../../src/features/fishing-billing/contracts.ts';
import {BILLING_DTO_V2} from '../../src/features/fishing-billing/contracts-v2.ts';
import {cardExceptionSchema} from '../../src/features/fishing-billing/card-contracts.ts';
import {REMINDER_SERVICE_VERSION,type BillingCurrentReminderServiceConfigurationV3,type VerifiedReminderOutcome} from '../../src/features/fishing-billing/reminder-service.ts';
import type {BillingCurrentOwnerAuthorityV3,BillingCurrentReminderServiceAuthorityV3,CurrentReminderReservationV3} from '../../src/lib/fishing-billing-current-ledger-v3.ts';
import {decodeBillingCurrentQuoteV3} from '../../src/lib/fishing-billing-current-readback-v3.ts';
import type {DispatchPermission} from '../../src/features/fishing-billing/reminders.ts';
import type {CurrentLedgerFrameV3} from '../../src/lib/fishing-billing-current-contract-v3.ts';
import {FishingBillingGuestOwnerStore} from '../../src/lib/fishing-billing-guest-owner-store.ts';
import {OWNER_MONEY_V3} from '../../src/lib/fishing-billing-owner-contract-v3.ts';
import {BILLING_GUEST_V3} from '../../src/lib/fishing-billing-guest-contract-v3.ts';
import {bindGuestIssuedMaterial,bindGuestDisplayBundle,verifyGuestFamilyOffer} from '../../src/lib/fishing-billing-guest-material-v3.ts';
import {FishingBillingGuestGrantResolver,guestGrantLifecycleSchema,guestPresentationEvidenceSchema,type BillingGuestGrantAuthority} from '../../src/lib/fishing-billing-guest-grant-resolver.ts';
import {FishingBillingGuestNativeV3} from '../../src/features/fishing-billing/guest-native-v3.ts';
vi.mock('server-only',()=>({}));

// New memory DB only. Actual Native and Root guest acceptance/cash code run
// against synthetic authority/display/outbox records. No URL, transport, SDK,
// credentials, installed schema or real PostgreSQL contention is exercised.
const db=new PGlite(),workspace=asId(randomUUID(),'workspace');
const initial=new Date('2035-01-06T15:00:00Z');let at=new Date(initial),owner:Actor,parent:Actor;
const clock={now:()=>new Date(at)},ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,7)}},key=Buffer.alloc(32,9);
const binder:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=> (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const policy:ReminderPolicy={id:'SYNTHETIC-CURRENT-REMINDER',revision:1,source:{id:'SYNTHETIC',sha256:'a'.repeat(64)},timeZone:'America/New_York',offsetsMinutes:[0,1440]};
const binding={version:REMINDER_SERVICE_VERSION,mode:'test' as const,serviceBindingId:'SYNTHETIC-SERVICE',outboxBindingId:'SYNTHETIC-SAME-OUTBOX'};
const seen:string[]=[];let outboxFails=false;
const terminalCalls:{mode:'owner'|'service';size:number}[]=[];let afterTerminalHook:(()=>void)|null=null;
let reserveHook:((c:BillingLedgerContext,payload:Parameters<BillingOutboxReservation['reserve']>[1])=>Promise<void>)|null=null;
let outcomeHook:((c:BillingLedgerContext)=>Promise<void>)|null=null;
let viewHook:((c:BillingLedgerContext,frame:CurrentLedgerFrameV3)=>void)|null=null;
async function familyRow(c:BillingLedgerContext,familyId:string){
 const rows=await c.tx.query<{guardianId:string;recipientId:string;assuranceId:string}>('SELECT guardian_id AS "guardianId",recipient_id AS "recipientId",assurance_id AS "assuranceId" FROM synthetic_current.families WHERE workspace_id=$1 AND family_id=$2 AND revoked=false',[workspace,familyId]);
 if(c.workspaceId!==workspace||rows.length!==1)throw new AppError('FORBIDDEN');return rows[0]!;
}
async function children(c:BillingLedgerContext,familyId:string,ids:string[]){
 const rows=await c.tx.query<{id:string}>("SELECT person_id AS id FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND role='child'",[workspace,familyId]);
 if(!ids.every(id=>rows.some(r=>r.id===id)))throw new AppError('FORBIDDEN');
}
const authority:BillingAuthority={
 authorize:async(c,action,s)=>{
  if(s.familyId===null){if(c.actor.id!==owner.id||action!=='publish')throw new AppError('FORBIDDEN');return;}
  const family=await familyRow(c,s.familyId);await children(c,s.familyId,s.childIds);
  if(s.programKey!=='fishing_monthly_club'||c.actor.id!==owner.id&&c.actor.personId!==family.guardianId)throw new AppError('FORBIDDEN');
 },
 reminderPermission:async()=>{throw new Error('LEGACY_REMINDER_PERMISSION_MUST_NOT_RUN');},
};
async function permission(c:BillingLedgerContext,frame:CurrentLedgerFrameV3,p:ReminderPolicy,guardianId:string,channel:'email'|'whatsapp'){
 const family=await familyRow(c,frame.source.quote.familyId);if(family.guardianId!==guardianId)throw new AppError('FORBIDDEN');
 const row=(await c.tx.query<{verified:boolean;consented:boolean;active:boolean;windowOpen:boolean;enabled:boolean;locale:'en'|'he';revision:number}>(
  'SELECT verified,consented,active,window_open AS "windowOpen",enabled,locale,revision FROM synthetic_current.preferences WHERE guardian_id=$1 AND channel=$2',[guardianId,channel]))[0];
 if(!row)throw new AppError('UNAVAILABLE');seen.push(frame.source.kind);if(viewHook)viewHook(c,frame);
 return {audience:{guardianId,channel,audience:'individual' as const,locale:row.locale,verified:row.verified,consented:row.consented,active:row.active},sendWindowOpen:row.windowOpen,ownerEnabled:row.enabled,policyCurrent:p.id===policy.id&&p.revision===row.revision&&p.source.sha256===policy.source.sha256};
}
const currentOwner:BillingCurrentOwnerAuthorityV3={authorize:authority.authorize,reminderPermission:permission,
 terminalReservationPermissions:(c,identity,reservations)=>terminalPermissions(c,'owner',identity,binding,reservations),
};
const currentService:BillingCurrentReminderServiceAuthorityV3={
 authorize:async(c,b,operation,s,audience)=>{
  expect(c).not.toHaveProperty('actor');
  const rows=await c.tx.query<{active:boolean}>('SELECT active FROM synthetic_current.service WHERE workspace_id=$1 AND service_id=$2 AND outbox_id=$3',[workspace,b.serviceBindingId,b.outboxBindingId]);
  if(c.workspaceId!==workspace||b.mode!=='test'||rows.length!==1||!rows[0]!.active)throw new AppError('UNAVAILABLE');
  if(!s)return;const family=await familyRow(c,s.familyId!);await children(c,s.familyId!,s.childIds);
  if(s.programKey!=='fishing_monthly_club'||operation!=='plan'&&!audience||audience&&(audience.familyId!==s.familyId||audience.quoteId!==s.quoteId||audience.guardianId!==family.guardianId))throw new AppError('FORBIDDEN');
 },
 plan:async(c,_b,frame)=>{
  expect(c).not.toHaveProperty('actor');seen.push(frame.source.kind);const family=await familyRow(c,frame.source.quote.familyId);
  const row=(await c.tx.query<{policy:ReminderPolicy|null;channel:'email'|'whatsapp'|null}>('SELECT policy,channel FROM synthetic_current.service WHERE workspace_id=$1',[workspace]))[0];
  return row?.policy&&row.channel?{policy:row.policy,channel:row.channel,guardianId:family.guardianId}:null;
 },
 permission:async(c,_b,frame,p,audience)=>{expect(c).not.toHaveProperty('actor');return permission(c,frame,p,audience.guardianId,audience.channel);},
 terminalReservationPermissions:(c,b,reservations)=>terminalPermissions(c,'service',null,b,reservations),
};
/** Synthetic implementation of the Root-owned terminal port. ONE actual SQL
 * statement reads/locks every selected family's scope and permissions plus
 * owner session OR service and the actual UNKNOWN/outbox dispatches together.
 * No saved permission arrays, blanket approval, writes or transport. These
 * fixture tables are not the production authority/outbox implementation. */
async function terminalPermissions(c:Readonly<BillingLedgerContext>,mode:'owner'|'service',identity:Readonly<Actor>|null,b:Readonly<typeof binding>,reservations:readonly CurrentReminderReservationV3[]):Promise<DispatchPermission[]>{
 expect(c).not.toHaveProperty('actor');expect(b).toEqual(binding);expect(reservations.length).toBeGreaterThan(0);expect(reservations.length).toBeLessThanOrEqual(50);
 const input=reservations.map((r,n)=>({ordinal:n,quote_id:r.frame.source.quote.id,family_id:r.intent.familyId,intent_id:r.intent.id,guardian_id:r.intent.guardianId,channel:r.intent.channel,revision:r.frame.source.quote.revision,dispatch_id:r.dispatchId,child_ids:r.frame.source.quote.lines.map(l=>l.childId),policy_id:r.policy.id,policy_revision:r.policy.revision,policy_sha:r.policy.source.sha256}));
 terminalCalls.push({mode,size:input.length});
 const rows=await c.tx.query<{ordinal:number;id:string;familyId:string;definitionId:string;revision:number;createdAt:Date;ciphertext:string;intentCiphertext:string;policyCiphertext:string;guardianId:string;channel:'email'|'whatsapp';locale:'en'|'he';verified:boolean;consented:boolean;active:boolean;windowOpen:boolean;enabled:boolean;policyCurrent:boolean}>(`SELECT d.ordinal,q.id,q.family_id AS "familyId",q.definition_id AS "definitionId",q.revision,q.created_at AS "createdAt",q.payload_ciphertext AS ciphertext,
  i.payload_ciphertext AS "intentCiphertext",i.policy_ciphertext AS "policyCiphertext",f.guardian_id AS "guardianId",p.channel,p.locale,p.verified,p.consented,p.active,p.window_open AS "windowOpen",p.enabled,
  (p.revision=d.policy_revision AND sv.policy->>'id'=d.policy_id AND (sv.policy->>'revision')::integer=d.policy_revision AND sv.policy#>>'{source,sha256}'=d.policy_sha) AS "policyCurrent"
  FROM jsonb_to_recordset($1::jsonb) AS d(ordinal integer,quote_id uuid,family_id uuid,intent_id uuid,guardian_id uuid,channel text,revision integer,dispatch_id uuid,child_ids jsonb,policy_id text,policy_revision integer,policy_sha text)
  JOIN synthetic_current.families f ON f.workspace_id=$2 AND f.family_id=d.family_id AND f.guardian_id=d.guardian_id AND f.revoked=false
  JOIN synthetic_current.preferences p ON p.guardian_id=d.guardian_id AND p.channel=d.channel
  JOIN synthetic_current.service sv ON sv.workspace_id=$2
  JOIN ls_fishing_billing.quotes q ON q.workspace_id=$2 AND q.id=d.quote_id AND q.family_id=d.family_id AND q.revision=d.revision
  JOIN ls_fishing_billing.reminders i ON i.workspace_id=$2 AND i.id=d.intent_id AND i.quote_id=d.quote_id AND i.state='unknown'
  JOIN synthetic_current.outbox ob ON ob.intent_id=d.intent_id AND ob.dispatch_id=d.dispatch_id AND ob.payload->'intent'->>'dispatchId'=d.dispatch_id::text
  WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(d.child_ids) child WHERE NOT EXISTS(SELECT 1 FROM ls_cases.family_members m WHERE m.workspace_id=$2 AND m.family_id=d.family_id AND m.person_id=child::uuid AND m.role='child' FOR SHARE OF m))
  AND (($3='owner' AND EXISTS(SELECT 1 FROM ls_identity.sessions s JOIN ls_identity.accounts a ON a.id=s.account_id AND a.workspace_id=s.workspace_id JOIN ls_identity.account_subjects sub ON sub.workspace_id=a.workspace_id AND sub.account_id=a.id WHERE s.workspace_id=$2 AND s.account_id=$4 AND s.token_digest=$5 AND s.revoked_at IS NULL AND s.expires_at>$6 AND a.role='practitioner' AND a.state='active' AND sub.person_id=$9 FOR SHARE OF s,a,sub))
   OR ($3='service' AND sv.active=true AND sv.service_id=$7 AND sv.outbox_id=$8))
  ORDER BY d.ordinal FOR SHARE OF f,p,sv,q,i,ob`,[JSON.stringify(input),workspace,mode,identity?.id??null,identity?.sessionDigest??null,c.now,b.serviceBindingId,b.outboxBindingId,identity?.personId??null]);
 if(rows.length!==reservations.length)throw new AppError('FORBIDDEN');
 const result=rows.map((row,n)=>{
  const expected=reservations[n]!;expect(row.ordinal).toBe(n);expect(decodeBillingCurrentQuoteV3(workspace,row.id,row,ring)).toEqual(expected.frame.source);
  expect(reminderIntentSchema.parse(JSON.parse(unseal(row.intentCiphertext,'ls_fishing_billing/v1/reminder/'+workspace+'/'+expected.intent.id,ring)))).toEqual({...expected.intent,state:'unknown',dispatchId:expected.dispatchId,reason:'dispatch_reserved'});
  expect(reminderPolicySchema.parse(JSON.parse(unseal(row.policyCiphertext,'ls_fishing_billing/v1/reminder_policy/'+workspace+'/'+expected.intent.id,ring)))).toEqual(expected.policy);
  return {audience:{guardianId:row.guardianId,channel:row.channel,audience:'individual' as const,locale:row.locale,verified:row.verified,consented:row.consented,active:row.active},sendWindowOpen:row.windowOpen,ownerEnabled:row.enabled,policyCurrent:row.policyCurrent===true};
 });
 if(afterTerminalHook)afterTerminalHook();return result;
}
const configuration:BillingCurrentReminderServiceConfigurationV3={binding,authority:currentService};
async function reserve(c:BillingLedgerContext,payload:Parameters<BillingOutboxReservation['reserve']>[1]){
 expect((await c.tx.query<{state:string}>('SELECT state FROM ls_fishing_billing.reminders WHERE workspace_id=$1 AND id=$2',[workspace,payload.intent.id]))[0]!.state).toBe('unknown');
 if(outboxFails)throw new Error('SYNTHETIC_OUTBOX_FAILURE');
 await c.tx.query('INSERT INTO synthetic_current.outbox(dispatch_id,intent_id,payload) VALUES($1,$2,$3::jsonb)',[payload.intent.dispatchId,payload.intent.id,JSON.stringify(payload)]);
 if(reserveHook)await reserveHook(c,payload);
}
const outbox:BillingOutboxReservation={
 reserve:async(c,payload)=>{expect(c.actor.id).toBe(owner.id);await reserve(c,payload);},
 reserveService:async(c,b,payload)=>{expect(c).not.toHaveProperty('actor');expect(b).toEqual(binding);await reserve(c,payload);},
 readServiceOutcome:async(c,b,lookup)=>{
  expect(c).not.toHaveProperty('actor');expect(b).toEqual(binding);if(outcomeHook)await outcomeHook(c);
  return (await c.tx.query<{payload:VerifiedReminderOutcome}>('SELECT payload FROM synthetic_current.outcomes WHERE dispatch_id=$1 AND intent_id=$2',[lookup.dispatchId,lookup.intentId]))[0]?.payload??null;
 },
};
const native=(ownerPort:BillingCurrentOwnerAuthorityV3|null=currentOwner,servicePort:BillingCurrentReminderServiceConfigurationV3|null=configuration,port:BillingOutboxReservation|null=outbox,dbinder:IdentityStore=binder)=>new FishingBillingStore(dbinder,workspace,ring,key,authority,clock,port,null,null,ownerPort,servicePort);
const money=()=>new FishingBillingGuestOwnerStore(binder,workspace,ring,key,clock,authority);
async function actor(role:'practitioner'|'parent'){
 const id=randomUUID(),digest=id.replaceAll('-','').padEnd(64,'0');
 await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','SYNTHETIC',$3)",[id,workspace,initial]);
 await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'SYNTHETIC',$5,'SYNTHETIC',$5,$5)",[id,workspace,role,digest,initial]);
 await db.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)',[workspace,id]);
 await db.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[digest,workspace,id,initial,new Date('2036-01-01T00:00:00Z')]);
 return {id:asId(id,'account'),workspaceId:workspace,personId:asId(id,'person'),role,state:'active',locale:'en',sessionDigest:digest,expiresAt:Date.parse('2036-01-01T00:00:00Z')} as Actor;
}
beforeAll(async()=>{
 await db.exec('CREATE SCHEMA ls_control');for(const file of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql'])await db.exec(await readFile('migrations/'+file,'utf8'));
 await db.exec(await readFile('tests/fixtures/fishing-billing.sql','utf8'));await db.exec(await readFile('migrations/proposals/UNNUMBERED_ls_fishing_billing_guest_v3.sql','utf8'));
 await db.exec('CREATE SCHEMA synthetic_current;CREATE TABLE synthetic_current.families(workspace_id uuid,family_id uuid PRIMARY KEY,guardian_id uuid,recipient_id uuid,assurance_id uuid,revoked boolean DEFAULT false);CREATE TABLE synthetic_current.preferences(guardian_id uuid,channel text,verified boolean DEFAULT true,consented boolean DEFAULT true,active boolean DEFAULT true,window_open boolean DEFAULT true,enabled boolean DEFAULT true,locale text DEFAULT \'he\',revision integer DEFAULT 1,PRIMARY KEY(guardian_id,channel));CREATE TABLE synthetic_current.service(workspace_id uuid PRIMARY KEY,service_id text,outbox_id text,active boolean,policy jsonb,channel text);CREATE TABLE synthetic_current.displays(grant_id uuid PRIMARY KEY,body jsonb,challenge text);CREATE TABLE synthetic_current.outbox(dispatch_id uuid PRIMARY KEY,intent_id uuid UNIQUE,payload jsonb);CREATE TABLE synthetic_current.outcomes(dispatch_id uuid PRIMARY KEY,intent_id uuid,payload jsonb)');
 await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspace,initial]);owner=await actor('practitioner');parent=await actor('parent');
 await db.query("INSERT INTO synthetic_current.service VALUES($1,$2,$3,true,$4::jsonb,'email')",[workspace,binding.serviceBindingId,binding.outboxBindingId,JSON.stringify(policy)]);
},20000);
beforeEach(async()=>{
 // Only this process's private no-URL memory fixture is cleared between cases.
 await db.exec('TRUNCATE ls_fishing_billing.reminders,synthetic_current.outbox,synthetic_current.outcomes');
 await db.query("UPDATE synthetic_current.service SET active=true,policy=$1::jsonb,channel='email'",[JSON.stringify(policy)]);
 await db.query("UPDATE synthetic_current.preferences SET verified=true,consented=true,active=true,window_open=true,enabled=true,locale='he',revision=1");
 await db.query('UPDATE ls_identity.sessions SET revoked_at=NULL');at=new Date(initial);seen.length=0;terminalCalls.length=0;afterTerminalHook=null;outboxFails=false;reserveHook=null;outcomeHook=null;viewHook=null;
});
afterAll(async()=>{await db.close();});
const guestAuthority:BillingGuestGrantAuthority={
 target:async c=>{if(c.workspaceId!==workspace)throw new AppError('UNAVAILABLE');},
 current:async(c,g,mode)=>{
  const family=await familyRow(c,g.offer.material.familyId);await children(c,g.offer.material.familyId,g.offer.material.lines.map(l=>l.childId));
  const rows=await c.tx.query<{ciphertext:string}>('SELECT payload_ciphertext AS ciphertext FROM ls_fishing_billing.quotes WHERE workspace_id=$1 AND id=$2',[workspace,g.offer.material.quoteId]);
  const issuers=await c.tx.query("SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active'",[workspace,g.issuedByAccountId]);
  if(rows.length!==1||issuers.length!==1)throw new AppError('FORBIDDEN');const q=verifyGuestFamilyOffer(JSON.parse(unseal(rows[0]!.ciphertext,'ls_fishing_billing/guest/v3/quote/'+workspace+'/'+g.offer.material.quoteId,ring)));
  if(mode==='fresh'?q.state!=='issued':q.acceptance?.grantId!==g.id)throw new AppError('FORBIDDEN');
  return {workspaceId:workspace,familyId:q.familyId,quoteId:q.id,grantId:g.id,recipientBindingEvidenceId:family.recipientId,assuranceEvidenceId:family.assuranceId,admissionPolicy:q.definition.source};
 },
 display:async(c,g,challenge)=>{
  const rows=await c.tx.query<{body:unknown;challenge:string}>('SELECT body,challenge FROM synthetic_current.displays WHERE grant_id=$1',[g.id]);
  if(rows.length!==1||challenge!==rows[0]!.challenge)throw new AppError('FORBIDDEN');return guestPresentationEvidenceSchema.parse(rows[0]!.body);
 },
};
async function scenario(kind:'historical_account'|'guest_successor'='guest_successor',accepted=true,distinctDue=false){
 const familyId=randomUUID(),childIds=[randomUUID(),randomUUID()],guardianId=kind==='historical_account'?parent.personId:randomUUID();
 await db.query('INSERT INTO ls_cases.families(id,workspace_id,label_ciphertext,created_at) VALUES($1,$2,$3,$4)',[familyId,workspace,'SYNTHETIC',initial]);
 if(kind==='guest_successor')await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','SYNTHETIC',$3)",[guardianId,workspace,initial]);
 for(const id of childIds){await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'minor','SYNTHETIC',$3)",[id,workspace,initial]);await db.query("INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'child')",[workspace,familyId,id]);}
 await db.query('INSERT INTO synthetic_current.families VALUES($1,$2,$3,$4,$5,false)',[workspace,familyId,guardianId,randomUUID(),randomUUID()]);
 await db.query("INSERT INTO synthetic_current.preferences(guardian_id,channel) VALUES($1,'email') ON CONFLICT DO NOTHING",[guardianId]);
 const d=syntheticDefinition(),definitionId=randomUUID();await native().publishOffer(owner,{operationId:randomUUID(),offer:{version:d.version,id:definitionId,programKey:d.programKey,environment:d.environment,currency:d.currency,unitAmountMinor:d.unitAmountMinor,effectiveAt:d.effectiveAt,source:d.source,terms:d.terms,policies:d.policies}});
 const cmd:CreateFamilyOffer={operationId:randomUUID(),id:randomUUID(),familyId,definitionId,override:null,children:childIds.map((childId,i)=>({lineId:randomUUID(),childId,groupId:null,period:{id:randomUUID(),startsAt:'2035-01-01T05:00:00Z',endsAt:'2035-02-01T05:00:00Z',timeZone:'America/New_York'},dueAt:distinctDue&&i===1?'2035-02-05T22:00:00Z':'2035-01-05T22:00:00Z'}))};
 if(kind==='historical_account'){
  await native().createOffer(owner,cmd);const issued=await native().issueOffer(owner,{operationId:randomUUID(),quoteId:cmd.id,expectedVersion:1});
  if(accepted)await native().acceptOffer(parent,{operationId:randomUUID(),quoteId:cmd.id,expectedVersion:2,terms:issued.result.quote.definition.terms,acknowledged:true});
 }else{
  await money().createOffer(owner,cmd);const q=(await money().issueOffer(owner,{operationId:randomUUID(),quoteId:cmd.id,expectedVersion:1})).quote;
  if(accepted){
   const offer=bindGuestIssuedMaterial({workspaceId:workspace,familyId,quoteId:q.id,issuedRevision:q.revision,definition:q.definition,lines:q.lines,createdAt:q.createdAt,issuedAt:q.issuedAt,override:q.override});
   const display=bindGuestDisplayBundle({id:randomUUID(),version:'SYNTHETIC ONLY',locale:'he',offerSnapshotSha256:offer.sha256,documents:[{purpose:'financial_terms',source:q.definition.terms,displayedTextSha256:'b'.repeat(64),releaseEvidenceId:randomUUID()}]});
   const family=(await db.query<{recipient_id:string}>('SELECT recipient_id FROM synthetic_current.families WHERE family_id=$1',[familyId])).rows[0]!,token=randomBytes(32).toString('base64url'),challenge='z'.repeat(43);
   const lifecycle=guestGrantLifecycleSchema.parse({version:BILLING_GUEST_V3,state:'active',revokedAt:null,use:null,grant:{version:BILLING_GUEST_V3,id:randomUUID(),action:'accept_financial_offer',offer,displayBundle:display,recipientBindingEvidenceId:family.recipient_id,admissionPolicy:q.definition.source,tokenDigest:tokenDigest(token),issuedAt:initial.toISOString(),expiresAt:new Date(initial.valueOf()+86400000).toISOString(),issuedByAccountId:owner.id}}),g=lifecycle.grant;
   await db.query('INSERT INTO ls_fishing_billing.guest_grants VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[workspace,g.id,q.id,g.action,g.tokenDigest,'active',g.issuedAt,g.expiresAt,seal(JSON.stringify(lifecycle),'ls_fishing_billing/guest_grant/v3/'+workspace+'/'+g.id,ring)]);
   const presentation={action:'accept_financial_offer',grantId:g.id,displayBundleId:display.id,displayBundleSha256:display.sha256,locale:display.locale,evidenceId:randomUUID(),affirmation:{version:'SYNTHETIC STATEMENT',guardianAuthorityText:'SYNTHETIC GUARDIAN',financialTermsText:'SYNTHETIC FINANCIAL'}};
   await db.query('INSERT INTO synthetic_current.displays VALUES($1,$2::jsonb,$3)',[g.id,JSON.stringify(presentation),challenge]);
   const resolver=new FishingBillingGuestGrantResolver(workspace,ring,key,clock,guestAuthority),acceptance=new FishingBillingGuestNativeV3(binder,workspace,ring,clock,resolver);
   await acceptance.acceptFinancialOffer(token,{operationId:randomUUID(),expectedVersion:2,displayBundleId:display.id,displayBundleSha256:display.sha256,displayChallenge:challenge,parent:{submittedName:'SYNTHETIC GUEST',guardianAuthorityAttested:true,financialTermsAffirmed:true}});
  }
 }
 return {id:cmd.id,guardianId,kind,cmd};
}
async function queued(kind:'historical_account'|'guest_successor'='guest_successor',distinctDue=false){const f=await scenario(kind,true,distinctDue),plan=await native().queueCurrentReminderServiceIntentsV3({quoteId:f.id});return {...f,intents:plan.intents};}
async function cash(f:Awaited<ReturnType<typeof scenario>>,full=false){
 const frame=await native().readCurrentLedgerV3(owner,f.id),q=frame.source.quote,amount=full?130000:20000;
 const command={version:f.kind==='guest_successor'?OWNER_MONEY_V3:BILLING_DTO_V2,operationId:randomUUID(),quoteId:f.id,expectedVersion:q.revision,currency:'USD',amountMinor:amount,allocations:full?q.lines.map(l=>({lineId:l.id,amountMinor:65000})):[{lineId:q.lines[0]!.id,amountMinor:amount}],receivedPrecision:'date',receivedDate:'2035-01-06',timeZone:'America/New_York'};
 if(f.kind==='guest_successor')await money().recordCashDate(owner,command);else await native().recordCashDate(owner,command);
}
async function outboxRows(){return (await db.query<{dispatch_id:string;intent_id:string;payload:Parameters<BillingOutboxReservation['reserve']>[1]}>('SELECT * FROM synthetic_current.outbox')).rows;}
async function stored(id:string){const row=(await db.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_fishing_billing.reminders WHERE id=$1',[id])).rows[0]!;return JSON.parse(unseal(row.payload_ciphertext,'ls_fishing_billing/v1/reminder/'+workspace+'/'+id,ring));}
async function setOutcome(intentId:string,dispatchId:string,change:Partial<VerifiedReminderOutcome>={}){
 const i=await stored(intentId),value:VerifiedReminderOutcome={intentId,dispatchId,guardianId:i.guardianId,channel:i.channel,outboxBindingId:binding.outboxBindingId,sourceReceiptId:'SYNTHETIC-VERIFIED-OUTBOX-RECEIPT',state:'delivered',providerId:'SYNTHETIC-PROVIDER',...change};
 await db.query('INSERT INTO synthetic_current.outcomes VALUES($1,$2,$3::jsonb) ON CONFLICT(dispatch_id) DO UPDATE SET payload=excluded.payload',[dispatchId,intentId,JSON.stringify(value)]);
}
it.each(['historical_account','guest_successor'] as const)('plans %s from actual acceptance with stable intent IDs and actual parent language',async kind=>{
 const before=(await db.query('SELECT id FROM ls_identity.accounts')).rows.length,f=await scenario(kind);
 const first=await native().queueCurrentReminderServiceIntentsV3({quoteId:f.id});expect(first.state).toBe('queued');expect(first.intents).toHaveLength(2);
 const ownerResult=await native().queueCurrentRemindersV3(owner,{quoteId:f.id,policy,guardianId:f.guardianId,channel:'email'});expect(ownerResult.intents).toEqual(first.intents);
 expect(first.intents.every(i=>i.guardianId===f.guardianId&&i.locale==='he'&&i.audience==='individual')).toBe(true);expect(seen.every(k=>k===kind)).toBe(true);
 expect((await native().readCurrentLedgerV3(owner,f.id)).source.quote.revision).toBe(3);expect((await db.query('SELECT id FROM ls_identity.accounts')).rows).toHaveLength(before);
});
it('denies unanswered offers and missing current ports or approved plan without old-authority fallback',async()=>{
 const f=await scenario('guest_successor',false);await expect(native().queueCurrentReminderServiceIntentsV3({quoteId:f.id})).rejects.toThrow('CONFLICT');
 const accepted=await scenario();await expect(native(null).queueCurrentRemindersV3(owner,{quoteId:accepted.id,policy,guardianId:accepted.guardianId,channel:'email'})).rejects.toThrow('UNAVAILABLE');
 await expect(native(currentOwner,null).queueCurrentReminderServiceIntentsV3({quoteId:accepted.id})).rejects.toThrow('UNAVAILABLE');
 await expect(native(currentOwner,configuration,null).reserveCurrentReminderServiceBatchV3({limit:1})).rejects.toThrow('UNAVAILABLE');
 await db.query('UPDATE synthetic_current.service SET policy=NULL');await expect(native().queueCurrentReminderServiceIntentsV3({quoteId:accepted.id})).rejects.toThrow('UNAVAILABLE');expect(await outboxRows()).toHaveLength(0);
});
it.each(['owner','service'] as const)('reserves only the due child remainder through actual %s authority after real date cash',async mode=>{
 const f=await queued('guest_successor',true);await cash(f);
 const due=f.intents.find(i=>i.dueAt==='2035-01-05T22:00:00.000Z')??f.intents.find(i=>Date.parse(i.dueAt)===Date.parse('2035-01-05T22:00:00Z'))!;
 if(mode==='owner')expect(await native().reserveCurrentReminderV3(owner,due.id,randomUUID())).toMatchObject({state:'reserved',remainingMinor:45000});
 else expect((await native().reserveCurrentReminderServiceBatchV3({limit:1})).results[0]).toMatchObject({state:'reserved',remainingMinor:45000});
 const rows=await outboxRows();expect(rows).toHaveLength(1);expect(rows[0]!.payload.amount).toMatchObject({remainingMinor:45000,revision:4});expect(rows[0]!.payload.amount.lines).toHaveLength(1);
 expect(rows[0]!.payload.amount.lines[0]!.lineId).toBe(f.cmd.children[0]!.lineId);expect((await native().readCurrentLedgerV3(owner,f.id)).balance.remainingMinor).toBe(110000);
});
it.each(['owner','service'] as const)('rolls back UNKNOWN and the same outbox together on %s reservation failure',async mode=>{
 const f=await queued(),due=f.intents.find(i=>Date.parse(i.scheduledAt)<=initial.valueOf())!;outboxFails=true;
 const work=mode==='owner'?native().reserveCurrentReminderV3(owner,due.id,randomUUID()):native().reserveCurrentReminderServiceBatchV3({limit:1});
 await expect(work).rejects.toThrow('SYNTHETIC_OUTBOX_FAILURE');expect((await stored(due.id)).state).toBe('queued');expect(await outboxRows()).toHaveLength(0);
});
it.each([
 ['consented=false','audience_not_permitted','suppressed'],['verified=false','audience_not_permitted','suppressed'],['window_open=false','send_window_closed','deferred'],['enabled=false','owner_paused','suppressed'],['revision=2','policy_changed','suppressed'],
] as const)('refreshes current permission %s before dispatch',async(sql,reason,state)=>{
 const f=await queued();await db.exec('UPDATE synthetic_current.preferences SET '+sql);
 expect((await native().reserveCurrentReminderServiceBatchV3({limit:1})).results[0]).toMatchObject({state,reason});expect(await outboxRows()).toHaveLength(0);
 expect((await stored(f.intents.find(i=>Date.parse(i.scheduledAt)<=initial.valueOf())!.id)).state).toBe(state==='deferred'?'queued':'suppressed');
});
it('denies a changed language or guardian instead of sending the original-language intent to another audience',async()=>{
 const f=await queued();await db.exec("UPDATE synthetic_current.preferences SET locale='en'");await expect(native().reserveCurrentReminderServiceBatchV3({limit:1})).rejects.toThrow('FORBIDDEN');
 await db.exec("UPDATE synthetic_current.preferences SET locale='he'");await db.query('UPDATE synthetic_current.families SET guardian_id=$2 WHERE family_id=$1',[f.cmd.familyId,randomUUID()]);
 await expect(native().reserveCurrentReminderServiceBatchV3({limit:1})).rejects.toThrow('FORBIDDEN');expect(await outboxRows()).toHaveLength(0);
});
it.each(['owner_session','service_binding','consent'] as const)('rechecks %s after outbox IO and rolls its reservation back',async gate=>{
 const f=await queued(),due=f.intents.find(i=>Date.parse(i.scheduledAt)<=initial.valueOf())!;
 reserveHook=async c=>{
  if(gate==='owner_session')await c.tx.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[owner.sessionDigest,initial]);
  else if(gate==='service_binding')await c.tx.query('UPDATE synthetic_current.service SET active=false');
  else await c.tx.query('UPDATE synthetic_current.preferences SET consented=false');
 };
 await expect(gate==='owner_session'?native().reserveCurrentReminderV3(owner,due.id,randomUUID()):native().reserveCurrentReminderServiceBatchV3({limit:1})).rejects.toThrow();
 expect((await stored(due.id)).state).toBe('queued');expect(await outboxRows()).toHaveLength(0);
});
it('recovers the original UNKNOWN without resending or requeuing after a lost response',async()=>{
 const f=await queued(),due=f.intents.find(i=>Date.parse(i.scheduledAt)<=initial.valueOf())!,dispatchId=randomUUID();
 await native().reserveCurrentReminderV3(owner,due.id,dispatchId);
 expect(await native().reserveCurrentReminderV3(owner,due.id,randomUUID())).toMatchObject({state:'blocked_unknown'});
 expect((await native().queueCurrentReminderServiceIntentsV3({quoteId:f.id})).state).toBe('blocked_unknown');
 expect((await native().reserveCurrentReminderServiceBatchV3({limit:50})).results).toEqual([]);
 expect(await native().recordCurrentReminderServiceOutcomeV3({intentId:due.id,dispatchId})).toMatchObject({state:'unresolved'});expect(await outboxRows()).toHaveLength(1);
 expect(await stored(due.id)).toMatchObject({state:'unknown',dispatchId});
});
it.each(['paid','paused','cancelled'] as const)('retains UNKNOWN after %s and records only the actual original-dispatch late outbox fact',async change=>{
 const f=await queued(),due=f.intents.find(i=>Date.parse(i.scheduledAt)<=initial.valueOf())!,dispatchId=randomUUID();await native().reserveCurrentReminderV3(owner,due.id,dispatchId);
 if(change==='paid')await cash(f,true);else await money().setState(owner,{version:OWNER_MONEY_V3,operationId:randomUUID(),quoteId:f.id,expectedVersion:3,...(change==='paused'?{paused:true}:{cancel:true})});
 expect(await stored(due.id)).toMatchObject({state:'unknown',dispatchId});expect((await native().readCurrentLedgerV3(owner,f.id)).balance.reminders.filter(i=>i.state==='queued')).toHaveLength(0);
 await db.exec('UPDATE synthetic_current.preferences SET consented=false,window_open=false');
 await setOutcome(due.id,dispatchId,{outboxBindingId:'WRONG'});await expect(native().recordCurrentReminderServiceOutcomeV3({intentId:due.id,dispatchId})).rejects.toThrow('UNAVAILABLE');
 expect((await stored(due.id)).state).toBe('unknown');await setOutcome(due.id,dispatchId);
 expect(await native().recordCurrentReminderServiceOutcomeV3({intentId:due.id,dispatchId})).toMatchObject({state:'recorded',intent:{state:'delivered',dispatchId}});
 expect(await native().recordCurrentReminderOutcomeV3(owner,{intentId:due.id,dispatchId})).toMatchObject({state:'recorded',intent:{state:'delivered'}});expect(await outboxRows()).toHaveLength(1);
});
it('authenticates all original UNKNOWN facts before the audience index can hide one',async()=>{
 const f=await queued(),due=f.intents.find(i=>Date.parse(i.scheduledAt)<=initial.valueOf())!;await native().reserveCurrentReminderV3(owner,due.id,randomUUID());
 at=new Date(initial.valueOf()+2*86400000);await db.query('UPDATE ls_fishing_billing.reminders SET audience_key=$2 WHERE id=$1',[due.id,'b'.repeat(64)]);
 await expect(native().reserveCurrentReminderServiceBatchV3({limit:1})).rejects.toThrow('UNAVAILABLE');expect(await outboxRows()).toHaveLength(1);
});
it('uses independent actual service authority while owner-session work is revoked',async()=>{
 const f=await scenario();await db.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[owner.sessionDigest,initial]);
 await expect(native().queueCurrentRemindersV3(owner,{quoteId:f.id,policy,guardianId:f.guardianId,channel:'email'})).rejects.toThrow();
 expect((await native().queueCurrentReminderServiceIntentsV3({quoteId:f.id})).state).toBe('queued');expect((await native().reserveCurrentReminderServiceBatchV3({limit:1})).results[0]!.state).toBe('reserved');
});
it('denies corrupted native quote metadata before planning or outbox mutation',async()=>{
 const f=await scenario();await db.query('UPDATE ls_fishing_billing.quotes SET revision=revision+1 WHERE id=$1',[f.id]);
 await expect(native().queueCurrentReminderServiceIntentsV3({quoteId:f.id})).rejects.toThrow('UNAVAILABLE');expect(await outboxRows()).toHaveLength(0);
});
it('keeps current frames, dates and returned reservation facts detached from the authority and outbox views',async()=>{
 const f=await scenario();viewHook=(c,frame)=>{c.now.setUTCFullYear(2099);frame.balance.remainingMinor=0;frame.source.quote.paused=true;};
 const plan=await native().queueCurrentReminderServiceIntentsV3({quoteId:f.id});expect(plan.intents).toHaveLength(2);
 reserveHook=async(c,payload)=>{c.now.setUTCFullYear(2099);payload.intent.state='delivered';payload.amount.remainingMinor=1;};
 const result=await native().reserveCurrentReminderServiceBatchV3({limit:1});expect(result.results[0]).toMatchObject({state:'reserved',remainingMinor:130000});
 expect((await stored(result.results[0]!.intentId)).state).toBe('unknown');expect((await outboxRows())[0]!.payload.amount.remainingMinor).toBe(130000);
});
it('keeps UNKNOWN when current service authority is revoked while reading a late outcome',async()=>{
 const f=await queued(),due=f.intents.find(i=>Date.parse(i.scheduledAt)<=initial.valueOf())!,dispatchId=randomUUID();await native().reserveCurrentReminderV3(owner,due.id,dispatchId);await setOutcome(due.id,dispatchId);
 outcomeHook=async c=>{await c.tx.query('UPDATE synthetic_current.service SET active=false');};
 await expect(native().recordCurrentReminderServiceOutcomeV3({intentId:due.id,dispatchId})).rejects.toThrow('UNAVAILABLE');expect((await stored(due.id)).state).toBe('unknown');
});
it('current reminder hardening rolls back a financial-state change made during the outbox callback',async()=>{
 const f=await queued(),due=f.intents.find(i=>Date.parse(i.scheduledAt)<=initial.valueOf())!;
 reserveHook=async c=>{
  const row=(await c.tx.query<{ciphertext:string}>('SELECT payload_ciphertext AS ciphertext FROM ls_fishing_billing.quotes WHERE id=$1',[f.id]))[0]!;
  const prefix='ls_fishing_billing/guest/v3/quote/'+workspace+'/'+f.id,q=verifyGuestFamilyOffer(JSON.parse(unseal(row.ciphertext,prefix,ring)));
  const changed=verifyGuestFamilyOffer({...q,revision:q.revision+1,paused:true});
  await c.tx.query('UPDATE ls_fishing_billing.quotes SET revision=$2,payload_ciphertext=$3 WHERE id=$1',[f.id,changed.revision,seal(JSON.stringify(changed),prefix,ring)]);
 };
 await expect(native().reserveCurrentReminderServiceBatchV3({limit:1})).rejects.toThrow('CONFLICT');
 expect((await stored(due.id)).state).toBe('queued');expect(await outboxRows()).toHaveLength(0);expect((await native().readCurrentLedgerV3(owner,f.id)).source.quote).toMatchObject({revision:3,paused:false});
});
it('current reminder hardening rechecks the exact approved plan after planning IO',async()=>{
 const f=await scenario();let changed=false;
 const authorityWithChangedPlan:BillingCurrentReminderServiceAuthorityV3={...currentService,permission:async(c,b,frame,p,audience)=>{
  const allowed=await currentService.permission(c,b,frame,p,audience);
  if(!changed){changed=true;await c.tx.query('UPDATE synthetic_current.service SET policy=$1::jsonb',[JSON.stringify({...policy,source:{...policy.source,sha256:'c'.repeat(64)}})]);}
  return allowed;
 }};
 await expect(native(currentOwner,{binding,authority:authorityWithChangedPlan}).queueCurrentReminderServiceIntentsV3({quoteId:f.id})).rejects.toThrow('CONFLICT');
 expect((await db.query('SELECT id FROM ls_fishing_billing.reminders WHERE quote_id=$1',[f.id])).rows).toHaveLength(0);expect(await outboxRows()).toHaveLength(0);
});
it('current reminder hardening authenticates original guest evidence on dispatch after earlier successful planning',async()=>{
 const f=await queued(),before=(await db.query('SELECT * FROM ls_fishing_billing.guest_financial_acceptances WHERE quote_id=$1',[f.id])).rows;
 // Immutable evidence rejects SQL updates. Inject only a synthetic read fault;
 // keep the actual trigger and stored original bytes intact.
 const corruptRead:IdentityStore={transaction:work=>binder.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  const rows=await tx.query<T>(sql,values);return sql.includes('evidence_ciphertext AS ciphertext FROM ls_fishing_billing.guest_financial_acceptances')?rows.map(row=>({...row,ciphertext:'SYNTHETIC-READ-CORRUPTION'})):rows;
 }}))};
 await expect(native(currentOwner,configuration,outbox,corruptRead).reserveCurrentReminderServiceBatchV3({limit:1})).rejects.toThrow();expect(await outboxRows()).toHaveLength(0);
 expect((await db.query('SELECT * FROM ls_fishing_billing.guest_financial_acceptances WHERE quote_id=$1',[f.id])).rows).toEqual(before);
});
it.each(['guardian','channel','dispatch'] as const)('current reminder hardening rejects an outbox fact with a different %s',async mismatch=>{
 const f=await queued(),due=f.intents.find(i=>Date.parse(i.scheduledAt)<=initial.valueOf())!,dispatchId=randomUUID();await native().reserveCurrentReminderV3(owner,due.id,dispatchId);
 const change:Partial<VerifiedReminderOutcome>=mismatch==='guardian'?{guardianId:randomUUID()}:mismatch==='channel'?{channel:'whatsapp'}:{dispatchId:randomUUID()};
 await setOutcome(due.id,dispatchId,change);await expect(native().recordCurrentReminderOutcomeV3(owner,{intentId:due.id,dispatchId})).rejects.toThrow('UNAVAILABLE');
 expect((await stored(due.id)).state).toBe('unknown');expect(await outboxRows()).toHaveLength(1);
});
it('current reminder hardening uses the actual full open card-exception frame to suppress a new dispatch',async()=>{
 const f=await queued(),id=randomUUID(),eventId='evt_SYNTHETIC_'+randomUUID().replaceAll('-','');
 const exception=cardExceptionSchema.parse({version:'JLFA-FISHING-CARD-EXCEPTION-v1',id,workspaceId:workspace,quoteId:f.id,familyId:f.cmd.familyId,eventId,eventDigest:'d'.repeat(64),reason:'SYNTHETIC_FINANCIAL_REVIEW',state:'open',recordedAt:initial.toISOString(),snapshot:{accountId:'acct_SYNTHETIC',livemode:false,apiVersion:'2026-09-30.endive',quoteId:f.id,attemptId:randomUUID(),sessionId:'cs_SYNTHETIC',paymentIntentId:'pi_SYNTHETIC',currency:'USD',amountMinor:130000,receivedMinor:130000,status:'paid',method:'card',paidAt:initial.toISOString(),observedAt:initial.toISOString(),refunds:[],dispute:'none'}});
 await db.query('INSERT INTO ls_fishing_billing.card_exceptions(workspace_id,id,quote_id,event_id,state,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6)',[workspace,id,f.id,eventId,'open',seal(JSON.stringify(exception),'ls_fishing_billing/card/v1/exception/'+workspace+'/'+id,ring)]);
 expect((await native().readCurrentLedgerV3(owner,f.id)).balance.state).toBe('review_required');
 expect((await native().reserveCurrentReminderServiceBatchV3({limit:1})).results[0]).toMatchObject({state:'suppressed',reason:'financial_review'});expect(await outboxRows()).toHaveLength(0);
});
it.each(['owner','service'] as const)('M4 R01 terminal %s decision refuses a consent revocation in the last Native authority reads',async mode=>{
 const f=await queued(),due=f.intents.find(i=>Date.parse(i.scheduledAt)<=initial.valueOf())!;
 let reads=0,armed=false,tripped=0;
 const capture=async(...args:Parameters<typeof permission>)=>{
  const allowed=await permission(...args);if(++reads===(mode==='owner'?2:3))armed=true;return allowed;
 };
 const ownerPort:BillingCurrentOwnerAuthorityV3={...currentOwner,reminderPermission:capture};
 const servicePort:BillingCurrentReminderServiceAuthorityV3={...currentService,permission:async(c,_b,frame,p,audience)=>capture(c,frame,p,audience.guardianId,audience.channel)};
 const barrier:IdentityStore={transaction:work=>binder.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  if(armed&&(sql.includes('FROM synthetic_current.families')||sql.includes('FROM synthetic_current.service'))){
   armed=false;tripped++;await tx.query('UPDATE synthetic_current.preferences SET consented=false WHERE guardian_id=$1',[f.guardianId]);
  }
  return tx.query<T>(sql,values);
 }}))};
 const current=native(ownerPort,{binding,authority:servicePort},outbox,barrier);
 await expect(mode==='owner'?current.reserveCurrentReminderV3(owner,due.id,randomUUID()):current.reserveCurrentReminderServiceBatchV3({limit:1})).rejects.toThrow();
 expect(tripped).toBe(1);expect((await stored(due.id)).state).toBe('queued');expect(await outboxRows()).toHaveLength(0);
});
it.each(['owner','service'] as const)('M4 R01 fence %s denies a missing terminal resolver without reserving',async mode=>{
 const f=await queued(),due=f.intents.find(i=>Date.parse(i.scheduledAt)<=initial.valueOf())!;
 const ownerPort:BillingCurrentOwnerAuthorityV3={...currentOwner},servicePort:BillingCurrentReminderServiceAuthorityV3={...currentService};delete ownerPort.terminalReservationPermissions;delete servicePort.terminalReservationPermissions;
 const current=native(ownerPort,{binding,authority:servicePort});
 await expect(mode==='owner'?current.reserveCurrentReminderV3(owner,due.id,randomUUID()):current.reserveCurrentReminderServiceBatchV3({limit:1})).rejects.toThrow('UNAVAILABLE');
 expect(await outboxRows()).toHaveLength(0);expect((await stored(due.id)).state).toBe('queued');expect(terminalCalls).toEqual([]);
});
it.each(['owner','service'] as const)('M4 R01 fence %s performs no Native IO after the joint terminal decision',async mode=>{
 const f=await queued(),due=f.intents.find(i=>Date.parse(i.scheduledAt)<=initial.valueOf())!;let terminal=false;
 const noLaterReads:IdentityStore={transaction:work=>binder.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  if(terminal)throw new Error('SYNTHETIC_NATIVE_IO_AFTER_TERMINAL_DECISION');return tx.query<T>(sql,values);
 }}))};
 afterTerminalHook=()=>{terminal=true;};const current=native(currentOwner,configuration,outbox,noLaterReads);
 const result=mode==='owner'?await current.reserveCurrentReminderV3(owner,due.id,randomUUID()):(await current.reserveCurrentReminderServiceBatchV3({limit:1})).results[0];
 expect(result).toMatchObject({state:'reserved',remainingMinor:130000});expect(terminal).toBe(true);expect(terminalCalls).toEqual([{mode,size:1}]);expect(await outboxRows()).toHaveLength(1);
});
it.each(['owner','service'] as const)('M4 R01 fence %s refreshes actual native authority inside the terminal decision',async mode=>{
 const f=await queued(),due=f.intents.find(i=>Date.parse(i.scheduledAt)<=initial.valueOf())!;let tripped=0;
 const barrier:IdentityStore={transaction:work=>binder.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  if(sql.includes('FROM jsonb_to_recordset')&&tripped++===0){
   if(mode==='owner')await tx.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[owner.sessionDigest,initial]);
   else await tx.query('UPDATE synthetic_current.service SET active=false');
  }
  return tx.query<T>(sql,values);
 }}))};
 const current=native(currentOwner,configuration,outbox,barrier);
 await expect(mode==='owner'?current.reserveCurrentReminderV3(owner,due.id,randomUUID()):current.reserveCurrentReminderServiceBatchV3({limit:1})).rejects.toThrow('FORBIDDEN');
 expect(tripped).toBe(1);expect(await outboxRows()).toHaveLength(0);expect((await stored(due.id)).state).toBe('queued');
});
it.each(['length','recipient','locale','extra'] as const)('M4 R01 fence rejects a malformed terminal %s result atomically',async bad=>{
 const f=await queued(),due=f.intents.find(i=>Date.parse(i.scheduledAt)<=initial.valueOf())!;
 const port:BillingCurrentReminderServiceAuthorityV3={...currentService,terminalReservationPermissions:async(c,b,reservations)=>{
  const values=[...await currentService.terminalReservationPermissions!(c,b,reservations)];
  if(bad==='length')return [];if(bad==='recipient')values[0]!.audience.guardianId=randomUUID();
  if(bad==='locale')values[0]!.audience.locale='en';if(bad==='extra')Object.assign(values[0]!,{unverifiedClaim:true});return values;
 }};
 await expect(native(currentOwner,{binding,authority:port}).reserveCurrentReminderServiceBatchV3({limit:1})).rejects.toThrow();expect(await outboxRows()).toHaveLength(0);expect((await stored(due.id)).state).toBe('queued');
});
it('M4 R01 fence makes one ordered joint decision for a mixed-source two-family batch',async()=>{
 await queued('historical_account');await queued('guest_successor');
 const result=await native().reserveCurrentReminderServiceBatchV3({limit:2});expect(result.results.every(r=>r.state==='reserved')).toBe(true);expect(result.results).toHaveLength(2);
 expect(terminalCalls).toEqual([{mode:'service',size:2}]);expect(await outboxRows()).toHaveLength(2);
});
it('M4 R01 fence rejects an out-of-order terminal permission array for the whole batch',async()=>{
 await queued('historical_account');await queued('guest_successor');
 const port:BillingCurrentReminderServiceAuthorityV3={...currentService,terminalReservationPermissions:async(c,b,reservations)=>[...await currentService.terminalReservationPermissions!(c,b,reservations)].reverse()};
 await expect(native(currentOwner,{binding,authority:port}).reserveCurrentReminderServiceBatchV3({limit:2})).rejects.toThrow('FORBIDDEN');expect(terminalCalls).toEqual([{mode:'service',size:2}]);expect(await outboxRows()).toHaveLength(0);
});
it('M4 R01 fence rechecks the earlier reservation when a later batch read revokes its consent',async()=>{
 await queued('historical_account');await queued('guest_successor');
 const first=(await db.query<{id:string}>("SELECT id FROM ls_fishing_billing.reminders WHERE state='queued' AND scheduled_at<=$1 ORDER BY scheduled_at,id LIMIT 1",[initial])).rows[0]!,guardianId=reminderIntentSchema.parse(await stored(first.id)).guardianId;
 let reads=0,armed=false,tripped=0;
 const port:BillingCurrentReminderServiceAuthorityV3={...currentService,permission:async(c,b,frame,p,audience)=>{
  const allowed=await currentService.permission(c,b,frame,p,audience);if(++reads===6)armed=true;return allowed;
 }};
 const barrier:IdentityStore={transaction:work=>binder.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  if(armed&&sql.includes('FROM synthetic_current.service')){armed=false;tripped++;await tx.query('UPDATE synthetic_current.preferences SET consented=false WHERE guardian_id=$1',[guardianId]);}
  return tx.query<T>(sql,values);
 }}))};
 await expect(native(currentOwner,{binding,authority:port},outbox,barrier).reserveCurrentReminderServiceBatchV3({limit:2})).rejects.toThrow('CONFLICT');
 expect(tripped).toBe(1);expect(terminalCalls).toEqual([{mode:'service',size:2}]);expect(await outboxRows()).toHaveLength(0);expect((await stored(first.id)).state).toBe('queued');
});
it('M4 R01 recovery preserves original late outcomes with no terminal send resolver or new consent',async()=>{
 const f=await queued(),due=f.intents.find(i=>Date.parse(i.scheduledAt)<=initial.valueOf())!,dispatchId=randomUUID();await native().reserveCurrentReminderV3(owner,due.id,dispatchId);
 await db.exec('UPDATE synthetic_current.preferences SET consented=false,window_open=false');await setOutcome(due.id,dispatchId);terminalCalls.length=0;
 const ownerPort:BillingCurrentOwnerAuthorityV3={...currentOwner},servicePort:BillingCurrentReminderServiceAuthorityV3={...currentService};delete ownerPort.terminalReservationPermissions;delete servicePort.terminalReservationPermissions;const current=native(ownerPort,{binding,authority:servicePort});
 expect(await current.recordCurrentReminderOutcomeV3(owner,{intentId:due.id,dispatchId})).toMatchObject({state:'recorded',intent:{state:'delivered'}});
 expect(await current.recordCurrentReminderServiceOutcomeV3({intentId:due.id,dispatchId})).toMatchObject({state:'recorded',intent:{state:'delivered'}});expect(terminalCalls).toEqual([]);expect(await outboxRows()).toHaveLength(1);
});
