import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect,vi} from 'vitest';
import {asId} from '../../src/lib/ids.ts';
import {AppError} from '../../src/lib/errors.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {seal,unseal,tokenDigest} from '../../src/features/identity/crypto.ts';
import {FishingBillingStore,type BillingAuthority,type BillingLedgerContext,type BillingOutboxReservation} from '../../src/features/fishing-billing/native.ts';
import {syntheticDefinition} from '../../src/features/fishing-billing/fixtures.ts';
import {reminderIntentSchema,reminderPolicySchema,type CreateFamilyOffer,type ReminderPolicy} from '../../src/features/fishing-billing/contracts.ts';
import {BILLING_DTO_V2} from '../../src/features/fishing-billing/contracts-v2.ts';
import {REMINDER_SERVICE_VERSION,type BillingCurrentReminderServiceConfigurationV3} from '../../src/features/fishing-billing/reminder-service.ts';
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
import {createFishingBillingReminderOutbox,BILLING_REMINDER_OUTBOX_PURPOSE,monthlyReminderProviderReceiptSchema,type BillingReminderOutboxAuthority,type BillingReminderApprovedMail} from '../../src/lib/fishing-billing-reminder-outbox.ts';
vi.mock('server-only',()=>({}));

// New memory DB only. Actual Native, Root guest acceptance/cash and the existing
// encrypted outbox run with synthetic authority/display/mail inputs. No URL, transport, SDK,
// credentials, installed schema or real PostgreSQL contention is exercised.
const db=new PGlite(),workspace=asId(randomUUID(),'workspace');
const initial=new Date('2035-01-06T15:00:00Z');let at=new Date(initial),owner:Actor,parent:Actor;
const clock={now:()=>new Date(at)},ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,7)}},key=Buffer.alloc(32,9);
const binder:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=> (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const policy:ReminderPolicy={id:'SYNTHETIC-CURRENT-REMINDER',revision:1,source:{id:'SYNTHETIC',sha256:'a'.repeat(64)},timeZone:'America/New_York',offsetsMinutes:[0,1440]};
const binding={version:REMINDER_SERVICE_VERSION,mode:'test' as const,serviceBindingId:'SYNTHETIC-SERVICE',outboxBindingId:'SYNTHETIC-SAME-OUTBOX'};
const seen:string[]=[];
const terminalCalls:{mode:'owner'|'service';size:number}[]=[];
async function familyRow(c:BillingLedgerContext,familyId:string){
 const rows=await c.tx.query<{guardianId:string;recipientId:string;assuranceId:string}>('SELECT guardian_id AS "guardianId",recipient_id AS "recipientId",assurance_id AS "assuranceId" FROM synthetic_encrypted.families WHERE workspace_id=$1 AND family_id=$2 AND revoked=false',[workspace,familyId]);
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
  'SELECT verified,consented,active,window_open AS "windowOpen",enabled,locale,revision FROM synthetic_encrypted.preferences WHERE guardian_id=$1 AND channel=$2',[guardianId,channel]))[0];
 if(!row)throw new AppError('UNAVAILABLE');seen.push(frame.source.kind);
 return {audience:{guardianId,channel,audience:'individual' as const,locale:row.locale,verified:row.verified,consented:row.consented,active:row.active},sendWindowOpen:row.windowOpen,ownerEnabled:row.enabled,policyCurrent:p.id===policy.id&&p.revision===row.revision&&p.source.sha256===policy.source.sha256};
}
const currentOwner:BillingCurrentOwnerAuthorityV3={authorize:authority.authorize,reminderPermission:permission,
 terminalReservationPermissions:(c,identity,reservations)=>terminalPermissions(c,'owner',identity,binding,reservations),
};
const currentService:BillingCurrentReminderServiceAuthorityV3={
 authorize:async(c,b,operation,s,audience)=>{
  expect(c).not.toHaveProperty('actor');
  const rows=await c.tx.query<{active:boolean}>('SELECT active FROM synthetic_encrypted.service WHERE workspace_id=$1 AND service_id=$2 AND outbox_id=$3',[workspace,b.serviceBindingId,b.outboxBindingId]);
  if(c.workspaceId!==workspace||b.mode!=='test'||rows.length!==1||!rows[0]!.active)throw new AppError('UNAVAILABLE');
  if(!s)return;const family=await familyRow(c,s.familyId!);await children(c,s.familyId!,s.childIds);
  if(s.programKey!=='fishing_monthly_club'||operation!=='plan'&&!audience||audience&&(audience.familyId!==s.familyId||audience.quoteId!==s.quoteId||audience.guardianId!==family.guardianId))throw new AppError('FORBIDDEN');
 },
 plan:async(c,_b,frame)=>{
  expect(c).not.toHaveProperty('actor');seen.push(frame.source.kind);const family=await familyRow(c,frame.source.quote.familyId);
  const row=(await c.tx.query<{policy:ReminderPolicy|null;channel:'email'|'whatsapp'|null}>('SELECT policy,channel FROM synthetic_encrypted.service WHERE workspace_id=$1',[workspace]))[0];
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
 const rows=await c.tx.query<{ordinal:number;id:string;familyId:string;definitionId:string;revision:number;createdAt:Date;ciphertext:string;intentCiphertext:string;policyCiphertext:string;outboxCiphertext:string;mail:BillingReminderApprovedMail;guardianId:string;channel:'email'|'whatsapp';locale:'en'|'he';verified:boolean;consented:boolean;active:boolean;windowOpen:boolean;enabled:boolean;policyCurrent:boolean}>(`SELECT d.ordinal,q.id,q.family_id AS "familyId",q.definition_id AS "definitionId",q.revision,q.created_at AS "createdAt",q.payload_ciphertext AS ciphertext,ob.payload_ciphertext AS "outboxCiphertext",em.body AS mail,
  i.payload_ciphertext AS "intentCiphertext",i.policy_ciphertext AS "policyCiphertext",f.guardian_id AS "guardianId",p.channel,p.locale,p.verified,p.consented,p.active,p.window_open AS "windowOpen",p.enabled,
  (p.revision=d.policy_revision AND sv.policy->>'id'=d.policy_id AND (sv.policy->>'revision')::integer=d.policy_revision AND sv.policy#>>'{source,sha256}'=d.policy_sha) AS "policyCurrent"
  FROM jsonb_to_recordset($1::jsonb) AS d(ordinal integer,quote_id uuid,family_id uuid,intent_id uuid,guardian_id uuid,channel text,revision integer,dispatch_id uuid,child_ids jsonb,policy_id text,policy_revision integer,policy_sha text)
  JOIN synthetic_encrypted.families f ON f.workspace_id=$2 AND f.family_id=d.family_id AND f.guardian_id=d.guardian_id AND f.revoked=false
  JOIN synthetic_encrypted.preferences p ON p.guardian_id=d.guardian_id AND p.channel=d.channel
  JOIN synthetic_encrypted.service sv ON sv.workspace_id=$2
  JOIN ls_fishing_billing.quotes q ON q.workspace_id=$2 AND q.id=d.quote_id AND q.family_id=d.family_id AND q.revision=d.revision
  JOIN ls_fishing_billing.reminders i ON i.workspace_id=$2 AND i.id=d.intent_id AND i.quote_id=d.quote_id AND i.state='unknown'
  JOIN ls_service_interest.inquiry_email_outbox ob ON ob.workspace_id=$2 AND ob.id=d.dispatch_id AND ob.purpose='academy_monthly_payment_reminder_v1' AND ob.message_key='monthly:'||d.dispatch_id::text AND ob.state='queued'
  JOIN synthetic_encrypted.mail em ON em.quote_id=d.quote_id AND em.reference=ob.application_id
  JOIN synthetic_encrypted.inquiries iq ON iq.reference=em.reference AND iq.family_id=d.family_id AND iq.guardian_id=d.guardian_id AND iq.locale=p.locale
  WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(d.child_ids) child WHERE NOT EXISTS(SELECT 1 FROM ls_cases.family_members m WHERE m.workspace_id=$2 AND m.family_id=d.family_id AND m.person_id=child::uuid AND m.role='child' FOR SHARE OF m))
  AND (($3='owner' AND EXISTS(SELECT 1 FROM ls_identity.sessions s JOIN ls_identity.accounts a ON a.id=s.account_id AND a.workspace_id=s.workspace_id JOIN ls_identity.account_subjects sub ON sub.workspace_id=a.workspace_id AND sub.account_id=a.id WHERE s.workspace_id=$2 AND s.account_id=$4 AND s.token_digest=$5 AND s.revoked_at IS NULL AND s.expires_at>$6 AND a.role='practitioner' AND a.state='active' AND sub.person_id=$9 FOR SHARE OF s,a,sub))
   OR ($3='service' AND sv.active=true AND sv.service_id=$7 AND sv.outbox_id=$8))
  ORDER BY d.ordinal FOR SHARE OF f,p,sv,q,i,ob,em,iq`,[JSON.stringify(input),workspace,mode,identity?.id??null,identity?.sessionDigest??null,c.now,b.serviceBindingId,b.outboxBindingId,identity?.personId??null]);
 if(rows.length!==reservations.length)throw new AppError('FORBIDDEN');
 const result=rows.map((row,n)=>{
  const expected=reservations[n]!;expect(row.ordinal).toBe(n);expect(decodeBillingCurrentQuoteV3(workspace,row.id,row,ring)).toEqual(expected.frame.source);
  expect(reminderIntentSchema.parse(JSON.parse(unseal(row.intentCiphertext,'ls_fishing_billing/v1/reminder/'+workspace+'/'+expected.intent.id,ring)))).toEqual({...expected.intent,state:'unknown',dispatchId:expected.dispatchId,reason:'dispatch_reserved'});
  expect(reminderPolicySchema.parse(JSON.parse(unseal(row.policyCiphertext,'ls_fishing_billing/v1/reminder_policy/'+workspace+'/'+expected.intent.id,ring)))).toEqual(expected.policy);
  const envelope=JSON.parse(unseal(row.outboxCiphertext,mailAad(expected.dispatchId),ring));expect(envelope).toMatchObject({workspaceId:workspace,outboxBindingId:binding.outboxBindingId,dispatchId:expected.dispatchId,intentId:expected.intent.id,mail:row.mail});
  expect(envelope.payload.intent).toEqual({...expected.intent,state:'unknown',dispatchId:expected.dispatchId,reason:'dispatch_reserved'});
  return {audience:{guardianId:row.guardianId,channel:row.channel,audience:'individual' as const,locale:row.locale,verified:row.verified,consented:row.consented,active:row.active},sendWindowOpen:row.windowOpen,ownerEnabled:row.enabled,policyCurrent:row.policyCurrent===true};
 });
 return result;
}
const configuration:BillingCurrentReminderServiceConfigurationV3={binding,authority:currentService};
const reservationsRead:string[]=[];
const outbox=createFishingBillingReminderOutbox({workspaceId:workspace,outboxBindingId:binding.outboxBindingId,keyring:ring,authority:{reservation:resolveMail,service:authorizeOutboxService,outcome:authorizeMailOutcome}});
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
 await db.exec('CREATE SCHEMA synthetic_encrypted;CREATE TABLE synthetic_encrypted.families(workspace_id uuid,family_id uuid PRIMARY KEY,guardian_id uuid,recipient_id uuid,assurance_id uuid,revoked boolean DEFAULT false);CREATE TABLE synthetic_encrypted.preferences(guardian_id uuid,channel text,verified boolean DEFAULT true,consented boolean DEFAULT true,active boolean DEFAULT true,window_open boolean DEFAULT true,enabled boolean DEFAULT true,locale text DEFAULT \'he\',revision integer DEFAULT 1,PRIMARY KEY(guardian_id,channel));CREATE TABLE synthetic_encrypted.service(workspace_id uuid PRIMARY KEY,service_id text,outbox_id text,active boolean,policy jsonb,channel text);CREATE TABLE synthetic_encrypted.displays(grant_id uuid PRIMARY KEY,body jsonb,challenge text);CREATE TABLE synthetic_encrypted.inquiries(reference uuid PRIMARY KEY,family_id uuid,guardian_id uuid,locale text,recipient_email text);CREATE TABLE synthetic_encrypted.mail(quote_id uuid PRIMARY KEY,reference uuid,body jsonb,approved_template jsonb,from_email text)');
 await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspace,initial]);owner=await actor('practitioner');parent=await actor('parent');
 await db.query("INSERT INTO synthetic_encrypted.service VALUES($1,$2,$3,true,$4::jsonb,'email')",[workspace,binding.serviceBindingId,binding.outboxBindingId,JSON.stringify(policy)]);
},20000);
beforeEach(async()=>{
 // Only this process's private no-URL memory fixture is cleared between cases.
 expect(globalThis.fetch).toBe(defaultNetwork);
 await db.exec("TRUNCATE ls_fishing_billing.reminders;DELETE FROM ls_service_interest.inquiry_email_outbox WHERE purpose='academy_monthly_payment_reminder_v1'");
 await db.query("UPDATE synthetic_encrypted.service SET active=true,policy=$1::jsonb,channel='email'",[JSON.stringify(policy)]);
 await db.query("UPDATE synthetic_encrypted.preferences SET verified=true,consented=true,active=true,window_open=true,enabled=true,locale='he',revision=1");
 await db.query('UPDATE ls_identity.sessions SET revoked_at=NULL');at=new Date(initial);seen.length=0;terminalCalls.length=0;reservationsRead.length=0;
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
  const rows=await c.tx.query<{body:unknown;challenge:string}>('SELECT body,challenge FROM synthetic_encrypted.displays WHERE grant_id=$1',[g.id]);
  if(rows.length!==1||challenge!==rows[0]!.challenge)throw new AppError('FORBIDDEN');return guestPresentationEvidenceSchema.parse(rows[0]!.body);
 },
};
async function scenario(kind:'historical_account'|'guest_successor'='guest_successor',accepted=true,distinctDue=false){
 const familyId=randomUUID(),childIds=[randomUUID(),randomUUID()],guardianId=kind==='historical_account'?parent.personId:randomUUID();
 await db.query('INSERT INTO ls_cases.families(id,workspace_id,label_ciphertext,created_at) VALUES($1,$2,$3,$4)',[familyId,workspace,'SYNTHETIC',initial]);
 if(kind==='guest_successor')await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','SYNTHETIC',$3)",[guardianId,workspace,initial]);
 for(const id of childIds){await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'minor','SYNTHETIC',$3)",[id,workspace,initial]);await db.query("INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'child')",[workspace,familyId,id]);}
 await db.query('INSERT INTO synthetic_encrypted.families VALUES($1,$2,$3,$4,$5,false)',[workspace,familyId,guardianId,randomUUID(),randomUUID()]);
 await db.query("INSERT INTO synthetic_encrypted.preferences(guardian_id,channel) VALUES($1,'email') ON CONFLICT DO NOTHING",[guardianId]);
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
   const family=(await db.query<{recipient_id:string}>('SELECT recipient_id FROM synthetic_encrypted.families WHERE family_id=$1',[familyId])).rows[0]!,token=randomBytes(32).toString('base64url'),challenge='z'.repeat(43);
   const lifecycle=guestGrantLifecycleSchema.parse({version:BILLING_GUEST_V3,state:'active',revokedAt:null,use:null,grant:{version:BILLING_GUEST_V3,id:randomUUID(),action:'accept_financial_offer',offer,displayBundle:display,recipientBindingEvidenceId:family.recipient_id,admissionPolicy:q.definition.source,tokenDigest:tokenDigest(token),issuedAt:initial.toISOString(),expiresAt:new Date(initial.valueOf()+86400000).toISOString(),issuedByAccountId:owner.id}}),g=lifecycle.grant;
   await db.query('INSERT INTO ls_fishing_billing.guest_grants VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[workspace,g.id,q.id,g.action,g.tokenDigest,'active',g.issuedAt,g.expiresAt,seal(JSON.stringify(lifecycle),'ls_fishing_billing/guest_grant/v3/'+workspace+'/'+g.id,ring)]);
   const presentation={action:'accept_financial_offer',grantId:g.id,displayBundleId:display.id,displayBundleSha256:display.sha256,locale:display.locale,evidenceId:randomUUID(),affirmation:{version:'SYNTHETIC STATEMENT',guardianAuthorityText:'SYNTHETIC GUARDIAN',financialTermsText:'SYNTHETIC FINANCIAL'}};
   await db.query('INSERT INTO synthetic_encrypted.displays VALUES($1,$2::jsonb,$3)',[g.id,JSON.stringify(presentation),challenge]);
   const resolver=new FishingBillingGuestGrantResolver(workspace,ring,key,clock,guestAuthority),acceptance=new FishingBillingGuestNativeV3(binder,workspace,ring,clock,resolver);
   await acceptance.acceptFinancialOffer(token,{operationId:randomUUID(),expectedVersion:2,displayBundleId:display.id,displayBundleSha256:display.sha256,displayChallenge:challenge,parent:{submittedName:'SYNTHETIC GUEST',guardianAuthorityAttested:true,financialTermsAffirmed:true}});
  }
 }
 return {id:cmd.id,guardianId,kind,cmd};
}
async function cash(f:Awaited<ReturnType<typeof scenario>>,full=false){
 const frame=await native().readCurrentLedgerV3(owner,f.id),q=frame.source.quote,amount=full?130000:20000;
 const command={version:f.kind==='guest_successor'?OWNER_MONEY_V3:BILLING_DTO_V2,operationId:randomUUID(),quoteId:f.id,expectedVersion:q.revision,currency:'USD',amountMinor:amount,allocations:full?q.lines.map(l=>({lineId:l.id,amountMinor:65000})):[{lineId:q.lines[0]!.id,amountMinor:amount}],receivedPrecision:'date',receivedDate:'2035-01-06',timeZone:'America/New_York'};
 if(f.kind==='guest_successor')await money().recordCashDate(owner,command);else await native().recordCashDate(owner,command);
}

const oldReference=randomUUID(),oldAckId=randomUUID();let oldAck:object;
const mailAad=(id:string)=>'ls_service_interest/monthly_payment_reminder/v1/'+workspace+'/'+id;
const defaultNetwork=vi.fn<typeof fetch>(async()=>{throw new Error('SYNTHETIC_DEFAULT_NETWORK_FORBIDDEN');});
beforeAll(async()=>{
 // EXACT existing Root unit baseline/proposal, only in this new memory DB.
 await db.exec('CREATE SCHEMA ls_service_interest;CREATE TABLE ls_service_interest.public_applications(workspace_id uuid,id uuid,PRIMARY KEY(workspace_id,id))');
 await db.exec(await readFile('migrations/0135_ls_inquiry_email_outbox.sql','utf8'));
 await db.exec("ALTER TABLE ls_service_interest.inquiry_email_outbox ADD COLUMN founder_id uuid,ADD COLUMN message_key text;ALTER TABLE ls_service_interest.inquiry_email_outbox DROP CONSTRAINT inquiry_email_outbox_workspace_id_application_id_key;CREATE UNIQUE INDEX inquiry_email_legacy_one ON ls_service_interest.inquiry_email_outbox(workspace_id,application_id) WHERE purpose='academy_inquiry_acknowledgment_v1';");
 await db.exec(await readFile('migrations/0137_ls_academy_owner_notifications.sql','utf8'));
 await db.exec(await readFile('migrations/proposals/UNNUMBERED_ls_monthly_reminder_outbox.sql','utf8'));
 await db.query('INSERT INTO ls_service_interest.public_applications VALUES($1,$2)',[workspace,oldReference]);
 await db.query("INSERT INTO ls_service_interest.inquiry_email_outbox(workspace_id,id,application_id,purpose,payload_ciphertext,created_at) VALUES($1,$2,$3,'academy_inquiry_acknowledgment_v1',$4,$5)",[workspace,oldAckId,oldReference,seal('SYNTHETIC OLD PURPOSE ACK','SYNTHETIC_OLD_ACK/'+oldAckId,ring),initial]);
 oldAck=(await db.query('SELECT * FROM ls_service_interest.inquiry_email_outbox WHERE id=$1',[oldAckId])).rows[0]!;vi.stubGlobal('fetch',defaultNetwork);
});
afterEach(async()=>{expect((await db.query('SELECT * FROM ls_service_interest.inquiry_email_outbox WHERE id=$1',[oldAckId])).rows[0]).toEqual(oldAck);expect(defaultNetwork).not.toHaveBeenCalled();});
afterAll(()=>{vi.unstubAllGlobals();});
type MailRow={id:string;familyId:string;definitionId:string;revision:number;createdAt:Date;ciphertext:string;reference:string;body:BillingReminderApprovedMail;template:BillingReminderApprovedMail['template'];fromEmail:string;recipient:string;inquiryLocale:'en'|'he';locale:'en'|'he';verified:boolean;consented:boolean;active:boolean;windowOpen:boolean;enabled:boolean;policyRevision:number;policy:ReminderPolicy};
async function mailRow(c:BillingLedgerContext,quoteId:string,guardianId:string){
 const rows=await c.tx.query<MailRow>(`SELECT q.id,q.family_id AS "familyId",q.definition_id AS "definitionId",q.revision,q.created_at AS "createdAt",q.payload_ciphertext AS ciphertext,
  m.reference,m.body,m.approved_template AS template,m.from_email AS "fromEmail",iq.recipient_email AS recipient,iq.locale AS "inquiryLocale",p.locale,p.verified,p.consented,p.active,p.window_open AS "windowOpen",p.enabled,p.revision AS "policyRevision",s.policy
  FROM synthetic_encrypted.mail m JOIN ls_fishing_billing.quotes q ON q.workspace_id=$1 AND q.id=m.quote_id
  JOIN synthetic_encrypted.families f ON f.workspace_id=$1 AND f.family_id=q.family_id AND f.guardian_id=$3 AND f.revoked=false
  JOIN synthetic_encrypted.inquiries iq ON iq.reference=m.reference AND iq.family_id=f.family_id AND iq.guardian_id=f.guardian_id
  JOIN ls_service_interest.public_applications app ON app.workspace_id=$1 AND app.id=iq.reference
  JOIN synthetic_encrypted.preferences p ON p.guardian_id=f.guardian_id AND p.channel='email'
  JOIN synthetic_encrypted.service s ON s.workspace_id=$1
  WHERE q.id=$2 FOR SHARE OF m,q,f,iq,app,p,s`,[workspace,quoteId,guardianId]);
 if(c.workspaceId!==workspace||rows.length!==1)throw new AppError('UNAVAILABLE');return rows[0]!;
}
async function authorizeOutboxService(...[c,b]:Parameters<BillingReminderOutboxAuthority['service']>){
 const rows=await c.tx.query<{active:boolean}>('SELECT active FROM synthetic_encrypted.service WHERE workspace_id=$1 AND service_id=$2 AND outbox_id=$3',[workspace,b.serviceBindingId,b.outboxBindingId]);
 if(c.workspaceId!==workspace||b.mode!=='test'||rows.length!==1||!rows[0]!.active)throw new AppError('UNAVAILABLE');
}
async function resolveMail(...[c,principal,payload]:Parameters<BillingReminderOutboxAuthority['reservation']>):Promise<BillingReminderApprovedMail>{
 reservationsRead.push(payload.intent.quoteId);await authorizeOutboxService(c,principal.kind==='service'?principal.binding:binding);
 if(principal.kind==='owner'){
  const rows=await c.tx.query("SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active'",[workspace,principal.actor.id]);if(rows.length!==1)throw new AppError('UNAVAILABLE');
 }
 const i=payload.intent,r=await mailRow(c,i.quoteId,i.guardianId),q=decodeBillingCurrentQuoteV3(workspace,r.id,r,ring).quote,m=r.body;
 if(q.revision!==payload.amount.revision||q.state!=='accepted'||q.paused||!q.acceptance||!payload.amount.lines.every(l=>q.lines.some(line=>line.id===l.lineId&&line.childId===l.childId))||!r.verified||!r.consented||!r.active||!r.windowOpen||!r.enabled||r.policyRevision!==i.policyRevision||r.policy.id!==i.policyId||r.policy.revision!==i.policyRevision||r.policy.source.sha256!==policy.source.sha256)throw new AppError('UNAVAILABLE');
 if(m.reference!==r.reference||m.quoteId!==q.id||m.familyId!==q.familyId||m.guardianId!==i.guardianId||m.locale!==i.locale||m.locale!==r.locale||r.inquiryLocale!==r.locale||m.to!==r.recipient||m.from!==r.fromEmail||m.template.id!==r.template.id||m.template.sha256!==r.template.sha256)throw new AppError('UNAVAILABLE');return m;
}
async function authorizeMailOutcome(...[c,b,mail]:Parameters<BillingReminderOutboxAuthority['outcome']>){
 // Current relationship/access, with original payload scope; send-window and
 // consent are deliberately not a new prerequisite for the historical fact.
 if(b.outboxBindingId!==binding.outboxBindingId||b.serviceBindingId!==binding.serviceBindingId||b.mode!=='test')throw new AppError('UNAVAILABLE');const r=await mailRow(c,mail.quoteId,mail.guardianId);
 if(mail.reference!==r.reference||mail.familyId!==r.familyId||mail.to!==r.recipient)throw new AppError('UNAVAILABLE');
}
async function mapped(kind:'historical_account'|'guest_successor'='guest_successor',distinctDue=false){
 const f=await scenario(kind,true,distinctDue),reference=randomUUID(),template={id:'SYNTHETIC-MAIL-TEMPLATE',sha256:'e'.repeat(64)};
 const mail:BillingReminderApprovedMail={reference,quoteId:f.id,familyId:f.cmd.familyId,guardianId:f.guardianId,locale:'he',from:'sender@example.invalid',to:'parent-'+reference+'@example.invalid',template,subject:'SYNTHETIC ONLY',text:'SYNTHETIC ONLY; native due-group amount is stored separately',html:'<p>SYNTHETIC ONLY</p>'};
 await db.query('INSERT INTO ls_service_interest.public_applications VALUES($1,$2)',[workspace,reference]);
 await db.query('INSERT INTO synthetic_encrypted.inquiries VALUES($1,$2,$3,$4,$5)',[reference,f.cmd.familyId,f.guardianId,'he',mail.to]);
 await db.query('INSERT INTO synthetic_encrypted.mail VALUES($1,$2,$3::jsonb,$4::jsonb,$5)',[f.id,reference,JSON.stringify(mail),JSON.stringify(template),mail.from]);return {...f,reference,mail};
}
async function planned(f:Awaited<ReturnType<typeof mapped>>,mode:'owner'|'service'='service'){
 const result=mode==='owner'?await native().queueCurrentRemindersV3(owner,{quoteId:f.id,policy,guardianId:f.guardianId,channel:'email'}):await native().queueCurrentReminderServiceIntentsV3({quoteId:f.id});
 return result.intents.find(i=>Date.parse(i.scheduledAt)<=initial.valueOf())!;
}
type MailStored={id:string;payload_ciphertext:string;state:string;reserved_at:Date|null;completed_at:Date|null;provider_id:string|null;monthly_receipt_ciphertext:string|null;application_id:string;[key:string]:unknown};
async function rows(){return (await db.query<MailStored>('SELECT * FROM ls_service_interest.inquiry_email_outbox WHERE purpose=$1 ORDER BY id',[BILLING_REMINDER_OUTBOX_PURPOSE])).rows;}
async function nativeIntent(id:string){const r=(await db.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_fishing_billing.reminders WHERE id=$1',[id])).rows[0]!;return reminderIntentSchema.parse(JSON.parse(unseal(r.payload_ciphertext,'ls_fishing_billing/v1/reminder/'+workspace+'/'+id,ring)));}
async function reserved(){const f=await mapped(),i=await planned(f),dispatchId=randomUUID();expect(await native().reserveCurrentReminderV3(owner,i.id,dispatchId)).toMatchObject({state:'reserved'});return {...f,intent:i,dispatchId};}
async function syntheticProviderAccepted(f:Awaited<ReturnType<typeof reserved>>,change:Record<string,unknown>={}){
 // SYNTHETIC provider-shaped sealed evidence ONLY. No worker/send/provider ran.
 const row=(await rows()).find(r=>r.id===f.dispatchId)!,receipt=monthlyReminderProviderReceiptSchema.parse({version:'JLFA-MONTHLY-REMINDER-SEND-v1',workspaceId:workspace,outboxBindingId:binding.outboxBindingId,intentId:f.intent.id,dispatchId:f.dispatchId,payloadSha256:createHash('sha256').update(row.payload_ciphertext).digest('hex'),providerId:'SYNTHETIC_PROVIDER_REFERENCE',reservedAt:initial.toISOString(),acceptedAt:initial.toISOString(),...change});
 await db.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='sent',reserved_at=$2,completed_at=$3,provider_id=$4,monthly_receipt_ciphertext=$5 WHERE id=$1",[f.dispatchId,new Date(receipt.reservedAt),new Date(receipt.acceptedAt),'SYNTHETIC_PROVIDER_REFERENCE',seal(JSON.stringify(receipt),mailAad(f.dispatchId)+'/provider',ring)]);
}
it.each([['historical_account','owner'],['historical_account','service'],['guest_successor','owner'],['guest_successor','service']] as const)('actual encrypted outbox joins %s %s reservation with current cash remainder and parent locale',async(kind,mode)=>{
 const f=await mapped(kind,true);await cash(f);const i=await planned(f,mode);
 const result=mode==='owner'?await native().reserveCurrentReminderV3(owner,i.id,randomUUID()):(await native().reserveCurrentReminderServiceBatchV3({limit:1})).results[0];expect(result).toMatchObject({state:'reserved',remainingMinor:45000});
 const stored=await rows();expect(stored).toHaveLength(1);const row=stored[0]!,message=JSON.parse(unseal(row.payload_ciphertext,mailAad(row.id),ring));
 expect(await nativeIntent(i.id)).toMatchObject({state:'unknown',dispatchId:row.id,locale:'he'});expect(row.state).toBe('queued');expect(row.payload_ciphertext).not.toContain(f.mail.to);
 expect(message).toMatchObject({intentId:i.id,dispatchId:row.id,mail:f.mail,payload:{amount:{revision:4,remainingMinor:45000}}});expect(message.payload.amount.lines).toHaveLength(1);expect(message.payload.amount.lines[0].lineId).toBe(f.cmd.children[0]!.lineId);
 expect(terminalCalls).toEqual([{mode,size:1}]);expect(reservationsRead).toEqual([f.id]);
 expect(await native().recordCurrentReminderServiceOutcomeV3({intentId:i.id,dispatchId:row.id})).toMatchObject({state:'unresolved'});expect((await nativeIntent(i.id)).state).toBe('unknown');
});
it.each(['missing_mapping','family','recipient','locale','template','reference'] as const)('actual encrypted outbox rolls back native UNKNOWN on invalid current %s',async bad=>{
 const f=await mapped(),i=await planned(f);const body={...f.mail,template:{...f.mail.template}};
 if(bad==='missing_mapping')await db.query('DELETE FROM synthetic_encrypted.mail WHERE quote_id=$1',[f.id]);
 else if(bad==='family')await db.query('UPDATE synthetic_encrypted.inquiries SET family_id=$2 WHERE reference=$1',[f.reference,randomUUID()]);
 else{
  if(bad==='recipient')body.to='other@example.invalid';if(bad==='locale')body.locale='en';if(bad==='template')body.template.sha256='f'.repeat(64);if(bad==='reference')body.reference=oldReference;
  await db.query('UPDATE synthetic_encrypted.mail SET body=$2::jsonb WHERE quote_id=$1',[f.id,JSON.stringify(body)]);
 }
 await expect(native().reserveCurrentReminderServiceBatchV3({limit:1})).rejects.toThrow('UNAVAILABLE');expect((await nativeIntent(i.id)).state).toBe('queued');expect(await rows()).toHaveLength(0);
});
it('actual encrypted outbox and native UNKNOWN both roll back on the terminal permission decision',async()=>{
 const f=await mapped(),i=await planned(f);let tripped=0,sawQueued=false;
 const barrier:IdentityStore={transaction:work=>binder.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  if(sql.includes('FROM jsonb_to_recordset')&&tripped++===0){
   sawQueued=(await tx.query("SELECT id FROM ls_service_interest.inquiry_email_outbox WHERE purpose='academy_monthly_payment_reminder_v1' AND state='queued'")).length===1;
   await tx.query('UPDATE synthetic_encrypted.preferences SET consented=false WHERE guardian_id=$1',[f.guardianId]);
  }
  return tx.query<T>(sql,values);
 }}))};
 await expect(native(currentOwner,configuration,outbox,barrier).reserveCurrentReminderServiceBatchV3({limit:1})).rejects.toThrow('CONFLICT');expect(sawQueued).toBe(true);expect(tripped).toBe(1);
 expect((await nativeIntent(i.id)).state).toBe('queued');expect(await rows()).toHaveLength(0);
});
it('actual encrypted outbox preserves UNKNOWN and original ciphertext on Native retry and exact adapter replay',async()=>{
 const f=await reserved();await db.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='unknown',reserved_at=$2 WHERE id=$1",[f.dispatchId,initial]);const before=(await rows())[0]!;
 expect(await native().reserveCurrentReminderV3(owner,f.intent.id,randomUUID())).toMatchObject({state:'blocked_unknown'});expect((await native().reserveCurrentReminderServiceBatchV3({limit:50})).results).toEqual([]);
 const envelope=JSON.parse(unseal(before.payload_ciphertext,mailAad(f.dispatchId),ring));await binder.transaction(tx=>outbox.reserveService({tx,workspaceId:workspace,now:new Date(initial.valueOf()+60000)},binding,envelope.payload));
 expect(await rows()).toEqual([before]);expect(await native().recordCurrentReminderServiceOutcomeV3({intentId:f.intent.id,dispatchId:f.dispatchId})).toMatchObject({state:'unresolved'});expect((await nativeIntent(f.intent.id)).state).toBe('unknown');
});
it.each(['paid','paused','cancelled'] as const)('actual encrypted adapter reads only SYNTHETIC provider acceptance after %s and closed new-send permission',async change=>{
 const f=await reserved();if(change==='paid')await cash(f,true);else await money().setState(owner,{version:OWNER_MONEY_V3,operationId:randomUUID(),quoteId:f.id,expectedVersion:3,...(change==='paused'?{paused:true}:{cancel:true})});
 await db.exec('UPDATE synthetic_encrypted.preferences SET consented=false,window_open=false');await syntheticProviderAccepted(f);const before=(await rows())[0]!,calls=reservationsRead.length;
 expect(await native().recordCurrentReminderServiceOutcomeV3({intentId:f.intent.id,dispatchId:f.dispatchId})).toMatchObject({state:'recorded',intent:{state:'provider_accepted',providerId:'SYNTHETIC_PROVIDER_REFERENCE'}});
 expect(await native().recordCurrentReminderOutcomeV3(owner,{intentId:f.intent.id,dispatchId:f.dispatchId})).toMatchObject({state:'recorded',intent:{state:'provider_accepted'}});expect((await nativeIntent(f.intent.id)).state).not.toBe('delivered');
 expect(await rows()).toEqual([before]);expect(reservationsRead).toHaveLength(calls);expect((await native().readCurrentLedgerV3(owner,f.id)).balance.reminders.filter(r=>r.state==='queued')).toHaveLength(0);
});
it.each(['hash','binding','scope','ciphertext'] as const)('actual encrypted adapter rejects SYNTHETIC %s receipt corruption and retains native UNKNOWN',async bad=>{
 const f=await reserved();await syntheticProviderAccepted(f,bad==='hash'?{payloadSha256:'a'.repeat(64)}:bad==='binding'?{outboxBindingId:'OTHER'}:{});
 if(bad==='scope')await db.query('UPDATE ls_service_interest.inquiry_email_outbox SET application_id=$2 WHERE id=$1',[f.dispatchId,oldReference]);
 if(bad==='ciphertext')await db.query("UPDATE ls_service_interest.inquiry_email_outbox SET monthly_receipt_ciphertext='SYNTHETIC_CORRUPTION' WHERE id=$1",[f.dispatchId]);
 const before=(await rows())[0]!;await expect(native().recordCurrentReminderServiceOutcomeV3({intentId:f.intent.id,dispatchId:f.dispatchId})).rejects.toThrow('UNAVAILABLE');expect((await nativeIntent(f.intent.id)).state).toBe('unknown');expect(await rows()).toEqual([before]);
});
it('actual encrypted outbox constraints reject a sent label without the separately sealed original receipt',async()=>{
 const f=await reserved();await expect(db.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='sent',reserved_at=$2,completed_at=$2,provider_id='SYNTHETIC_WITHOUT_RECEIPT' WHERE id=$1",[f.dispatchId,initial])).rejects.toThrow();
 expect(await native().recordCurrentReminderServiceOutcomeV3({intentId:f.intent.id,dispatchId:f.dispatchId})).toMatchObject({state:'unresolved'});expect((await nativeIntent(f.intent.id)).state).toBe('unknown');
});
it('actual encrypted outbox leaves WhatsApp unsupported without creating an email fallback',async()=>{
 const f=await mapped();await db.query("INSERT INTO synthetic_encrypted.preferences(guardian_id,channel) VALUES($1,'whatsapp')",[f.guardianId]);await db.exec("UPDATE synthetic_encrypted.service SET channel='whatsapp'");
 const i=(await native().queueCurrentReminderServiceIntentsV3({quoteId:f.id})).intents.find(i=>Date.parse(i.scheduledAt)<=initial.valueOf())!;expect(i.channel).toBe('whatsapp');
 await expect(native().reserveCurrentReminderServiceBatchV3({limit:1})).rejects.toThrow('UNAVAILABLE');expect(await rows()).toHaveLength(0);expect((await nativeIntent(i.id)).state).toBe('queued');expect(reservationsRead).toEqual([]);
});
