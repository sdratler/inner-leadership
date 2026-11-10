import 'server-only';
import {z} from 'zod';
import {canonical} from '../contact-ops/core/validation.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {one} from '../identity/store.ts';
import type {WorkspaceId,IdentityClock} from '../identity/types.ts';
import {AppError} from '../../lib/errors.ts';
import type {BillingLedgerContext} from './native.ts';
import {billingId,sourceReferenceSchema} from './contracts.ts';
import {verifyServiceOfferBindingV4} from './guest-service-material-v4.ts';
import type {ServiceOfferBindingV4} from './guest-service-contract-v4.ts';
import {SEAT_RESERVATION_V1,seatScopeV1Schema,seatResourceAdmissionV1Schema,seatReservationRecordV1Schema,
 type SeatScopeV1,type SeatResourceV1,type SeatClaimV1,type SeatResourceAdmissionV1,type SeatReservationRecordV1} from './fishing-seat-reservation-contract-v1.ts';

/** Mandatory trusted server composition. Implementations must lock genuine
 * native resource/capacity/occupant and admission rows in c.tx, not accept an
 * owner-entered capacity, synthetic source ref, parsed receipt or offer claim.
 * Pool IDs identify GLOBAL overlapping passenger/supervision resources across
 * groups. Every native pool/occupant writer must acquire the same sorted pool
 * locks before changing these sources. No default implementation is supplied. */
export interface FishingSeatReservationAuthorityV1{
 target(c:BillingLedgerContext):Promise<void>;
 access(c:BillingLedgerContext,offer:Readonly<ServiceOfferBindingV4>,mode:'reserve'|'current'|'history'):Promise<void>;
 resources(c:BillingLedgerContext,offer:Readonly<ServiceOfferBindingV4>,resources:readonly SeatResourceV1[]):Promise<readonly SeatResourceAdmissionV1[]>;
}
type Row={quoteId:string;familyId:string;offerSha256:string;digest:string;createdAt:Date;ciphertext:string};
type ClaimRow={quoteId:string;digest:string;poolId:string;childId:string;kind:string;resourceId:string;startsAt:Date;endsAt:Date};
function fail(code:'UNAVAILABLE'|'FORBIDDEN'|'CONFLICT'='UNAVAILABLE'):never{throw new AppError(code);}
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const key=(r:SeatResourceV1)=>r.kind+':'+r.id;
const overlaps=(a:{startsAt:string;endsAt:string},b:{startsAt:string;endsAt:string})=>Date.parse(a.startsAt)<Date.parse(b.endsAt)&&Date.parse(b.startsAt)<Date.parse(a.endsAt);
function freeze<T>(v:T):T{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}

/** Extract exact IDs and periods; no RM/history rewrite or fishing-experience
 * inference. Material integrity is NOT current native authority. */
export function fishingSeatScopeV1(raw:unknown):SeatScopeV1{
 const offer=verifyServiceOfferBindingV4(raw),f=offer.material.financial,s=offer.material.schedule.snapshot;
 const children=s.children.map(child=>({lineId:child.lineId,childId:child.childId,groupId:child.groupId,period:child.period,
  resources:[...child.weeklyLessons.map(l=>({kind:'lesson' as const,id:l.id,groupId:child.groupId,revision:l.revision,digest:l.digest,startsAt:l.startsAt,endsAt:l.endsAt})),
   ...[child.keys,child.local].map(t=>({kind:'departure' as const,id:t.id,groupId:t.groupId,revision:t.revision,digest:t.digest,startsAt:t.fields.startsAt,endsAt:t.fields.endsAt}))]
   .sort((a,b)=>key(a).localeCompare(key(b)))})).sort((a,b)=>a.childId.localeCompare(b.childId));
 if(children.length!==f.lines.length||new Set(children.map(c=>c.childId)).size!==children.length)fail();
 for(const c of children){const line=f.lines.find(l=>l.id===c.lineId);if(!line||line.childId!==c.childId||line.groupId!==c.groupId||!same(line.period,c.period))fail();
  if(new Set(c.resources.map(key)).size!==c.resources.length)fail();
  for(const [i,a] of c.resources.entries())for(const b of c.resources.slice(i+1))if(overlaps(a,b))fail('CONFLICT');
 }
 return seatScopeV1Schema.parse({workspaceId:f.workspaceId,quoteId:f.quoteId,familyId:f.familyId,offerSha256:offer.sha256,children});
}
function resources(scope:SeatScopeV1){const map=new Map<string,SeatResourceV1>();for(const c of scope.children)for(const r of c.resources){
 const old=map.get(key(r));if(old&&!same(old,r))fail();map.set(key(r),r);}return [...map.values()].sort((a,b)=>key(a).localeCompare(key(b)));}
function claims(scope:SeatScopeV1,admissions:readonly SeatResourceAdmissionV1[]):SeatClaimV1[]{return scope.children.flatMap(c=>c.resources.flatMap(r=>{
 const a=admissions.find(a=>key(a.resource)===key(r));if(!a||!same(a.resource,r))fail();return a.pools.map(p=>({poolId:p.id,childId:c.childId,resource:r}));
})).sort((a,b)=>canonical(a).localeCompare(canonical(b)));}
function rowClaim(c:SeatClaimV1){return {poolId:c.poolId,childId:c.childId,kind:c.resource.kind,resourceId:c.resource.id,
 startsAt:new Date(c.resource.startsAt).toISOString(),endsAt:new Date(c.resource.endsAt).toISOString()};}

/** Initial native, immutable, globally counted PROVISIONAL memberships only.
 * Caller owns the transaction and must propagate failures through rollback.
 * No method starts a hold clock, releases a seat, creates a debt, marks paid or
 * grants legal/operating permission. Unknown send/payment stays blocking.
 * Later lifecycle adoption needs its own genuine sender/settlement adapters. */
export class FishingSeatReservationNativeV1{
 constructor(private readonly workspaceId:WorkspaceId,private readonly ring:Keyring,private readonly integrityKey:string,
  private readonly clock:IdentityClock,private readonly authority:FishingSeatReservationAuthorityV1){billingId.parse(workspaceId);if(integrityKey.length<32||!authority)fail();}
 private context(c:BillingLedgerContext){if(c.workspaceId!==this.workspaceId)fail('FORBIDDEN');}
 private now(){const d=this.clock.now();if(!(d instanceof Date)||!Number.isFinite(d.valueOf()))fail();return d.toISOString();}
 private aad(quote:string){return `ls_fishing_billing/seat_reservation/v1/${this.workspaceId}/${quote}`;}
 private hash(r:SeatReservationRecordV1){return privateDigest({domain:SEAT_RESERVATION_V1,record:r},this.integrityKey);}
 private ref(r:SeatReservationRecordV1){return {id:r.scope.quoteId,sha256:this.hash(r)};}
 private async lock(c:BillingLedgerContext,scope:SeatScopeV1,poolIds:readonly string[],create:boolean){
  const locks=[['quote',scope.quoteId],...scope.children.map(c=>['child',c.childId]),...poolIds.map(p=>['pool',p])];
  for(const [kind,id] of locks.sort((a,b)=>canonical(a).localeCompare(canonical(b)))){
   if(create)await c.tx.query('INSERT INTO ls_fishing_billing.seat_reservation_locks(workspace_id,kind,entity_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[this.workspaceId,kind,id]);
   if(!await one(c.tx,'SELECT entity_id FROM ls_fishing_billing.seat_reservation_locks WHERE workspace_id=$1 AND kind=$2 AND entity_id=$3 FOR UPDATE',[this.workspaceId,kind,id]))fail();
  }
 }
 private async load(c:BillingLedgerContext,quoteId:string){
  const row=await one<Row>(c.tx,'SELECT quote_id AS "quoteId",family_id AS "familyId",offer_sha256 AS "offerSha256",record_digest AS digest,created_at AS "createdAt",payload_ciphertext AS ciphertext FROM ls_fishing_billing.seat_reservations WHERE workspace_id=$1 AND quote_id=$2 FOR SHARE',[this.workspaceId,quoteId]);
  if(!row)return null;const r=seatReservationRecordV1Schema.parse(JSON.parse(unseal(row.ciphertext,this.aad(quoteId),this.ring)));
  if(r.scope.workspaceId!==this.workspaceId||r.scope.quoteId!==quoteId||r.scope.familyId!==row.familyId||r.scope.offerSha256!==row.offerSha256||r.createdAt!==row.createdAt.toISOString()||this.hash(r)!==row.digest||!same(claims(r.scope,r.admissions),r.claims))fail();
  const rows=await c.tx.query<ClaimRow>('SELECT quote_id AS "quoteId",record_digest AS digest,pool_id AS "poolId",child_id AS "childId",resource_kind AS kind,resource_id AS "resourceId",starts_at AS "startsAt",ends_at AS "endsAt" FROM ls_fishing_billing.seat_reservation_claims WHERE workspace_id=$1 AND quote_id=$2 LIMIT 961',[this.workspaceId,quoteId]);
  if(rows.some(x=>x.digest!==row.digest)||!same(rows.map(x=>({poolId:x.poolId,childId:x.childId,kind:x.kind,resourceId:x.resourceId,startsAt:x.startsAt.toISOString(),endsAt:x.endsAt.toISOString()})).sort((a,b)=>canonical(a).localeCompare(canonical(b))),r.claims.map(rowClaim).sort((a,b)=>canonical(a).localeCompare(canonical(b)))))fail();
  return r;
 }
 private async admitted(c:BillingLedgerContext,offer:ServiceOfferBindingV4,scope:SeatScopeV1){
  const expected=resources(scope),a=z.array(seatResourceAdmissionV1Schema).min(1).max(120).parse(await this.authority.resources(c,offer,freeze(structuredClone(expected))));
  a.sort((a,b)=>key(a.resource).localeCompare(key(b.resource)));for(const x of a)x.pools.sort((a,b)=>a.id.localeCompare(b.id));
  if(!same(a.map(x=>x.resource),expected))fail();
  const pools=new Map<string,unknown>();for(const x of a)for(const p of x.pools){const old=pools.get(p.id);if(old&&!same(old,p))fail();pools.set(p.id,p);}
  return a;
 }
 private async room(c:BillingLedgerContext,scope:SeatScopeV1,admissions:SeatResourceAdmissionV1[],selected:SeatClaimV1[]){
  const poolIds=[...new Set(selected.map(x=>x.poolId))],childIds=scope.children.map(x=>x.childId),rs=resources(scope);
  const start=rs.reduce((a,b)=>Date.parse(a)<Date.parse(b.startsAt)?a:b.startsAt,rs[0]!.startsAt),end=rs.reduce((a,b)=>Date.parse(a)>Date.parse(b.endsAt)?a:b.endsAt,rs[0]!.endsAt);
  const rows=await c.tx.query<{quoteId:string}>('SELECT DISTINCT quote_id AS "quoteId" FROM ls_fishing_billing.seat_reservation_claims WHERE workspace_id=$1 AND (pool_id=ANY($2::uuid[]) OR child_id=ANY($3::uuid[])) AND starts_at<$5 AND ends_at>$4 LIMIT 1001',[this.workspaceId,poolIds,childIds,start,end]);
  if(rows.length>1000)fail();const other:SeatClaimV1[]=[];for(const row of rows){if(row.quoteId===scope.quoteId)continue;const r=await this.load(c,row.quoteId);if(!r)fail();other.push(...r.claims);}
  for(const a of selected)for(const b of other)if(a.childId===b.childId&&overlaps(a.resource,b.resource))fail('CONFLICT');
  const pools=new Map(admissions.flatMap(x=>x.pools).map(p=>[p.id,p]));
  for(const [poolId,p] of pools){const intervals=[...selected,...other].filter(x=>x.poolId===poolId).map(x=>({childId:x.childId,startsAt:x.resource.startsAt,endsAt:x.resource.endsAt}));
   intervals.push(...p.outsideOccupants);
   const wanted=selected.filter(x=>x.poolId===poolId);for(const w of wanted){const active=intervals.filter(x=>overlaps(x,w.resource));
    const points=[w.resource.startsAt,...active.map(x=>x.startsAt).filter(t=>Date.parse(t)>Date.parse(w.resource.startsAt)&&Date.parse(t)<Date.parse(w.resource.endsAt))];
    for(const point of points)if(new Set(active.filter(x=>Date.parse(x.startsAt)<=Date.parse(point)&&Date.parse(point)<Date.parse(x.endsAt)).map(x=>x.childId)).size>p.capacity)fail('CONFLICT');
   }
  }
 }
 async reserveInTransaction(c:BillingLedgerContext,raw:unknown){
  this.context(c);await this.authority.target(c);const offer=freeze(verifyServiceOfferBindingV4(raw)),scope=fishingSeatScopeV1(offer);if(scope.workspaceId!==this.workspaceId)fail('FORBIDDEN');
  await this.authority.access(c,offer,'reserve');const before=await this.admitted(c,offer,scope),poolIds=[...new Set(before.flatMap(a=>a.pools.map(p=>p.id)))];
  await this.lock(c,scope,poolIds,true);const a=await this.admitted(c,offer,scope);if(!same(a,before))fail('CONFLICT');
  const previous=await this.load(c,scope.quoteId),selected=claims(scope,a);
  if(previous){if(!same(previous.scope,scope)||!same(previous.admissions,a))fail('CONFLICT');}
  else if(resources(scope).some(r=>Date.parse(r.startsAt)<=Date.parse(this.now())))fail('CONFLICT');
  await this.room(c,scope,a,selected);
  const record=previous??seatReservationRecordV1Schema.parse({version:SEAT_RESERVATION_V1,purpose:'v4_service_offer',classification:'native_provisional_membership_not_paid_or_operating_authority',scope,createdAt:this.now(),admissions:a,claims:selected});
  if(!previous){const sha=this.hash(record);await c.tx.query('INSERT INTO ls_fishing_billing.seat_reservations(workspace_id,quote_id,family_id,offer_sha256,record_digest,created_at,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7)',[this.workspaceId,scope.quoteId,scope.familyId,scope.offerSha256,sha,record.createdAt,seal(JSON.stringify(record),this.aad(scope.quoteId),this.ring)]);
   for(const x of selected)await c.tx.query('INSERT INTO ls_fishing_billing.seat_reservation_claims(workspace_id,quote_id,record_digest,pool_id,child_id,resource_kind,resource_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[this.workspaceId,scope.quoteId,sha,x.poolId,x.childId,x.resource.kind,x.resource.id,x.resource.startsAt,x.resource.endsAt]);
  }
  await this.authority.target(c);await this.authority.access(c,offer,'current');if(!same(await this.admitted(c,offer,scope),a)||!same(await this.load(c,scope.quoteId),record)||
   !previous&&resources(scope).some(r=>Date.parse(r.startsAt)<=Date.parse(this.now())))fail('CONFLICT');
  return freeze({reference:this.ref(record),record,replayed:previous!==null});
 }
 async validateInTransaction(c:BillingLedgerContext,raw:unknown,reference:unknown,mode:'current'|'history'){
  z.enum(['current','history']).parse(mode);
  this.context(c);await this.authority.target(c);const offer=freeze(verifyServiceOfferBindingV4(raw)),scope=fishingSeatScopeV1(offer),expected=sourceReferenceSchema.parse(reference);
  if(scope.workspaceId!==this.workspaceId)fail('FORBIDDEN');await this.authority.access(c,offer,mode);
  const before=await this.load(c,scope.quoteId);if(!before||!same(before.scope,scope)||!same(this.ref(before),expected))fail('FORBIDDEN');
  await this.lock(c,scope,[...new Set(before.claims.map(x=>x.poolId))],false);const r=await this.load(c,scope.quoteId);if(!r||!same(r,before))fail();
  if(mode==='current'){const a=await this.admitted(c,offer,scope);if(!same(a,r.admissions))fail('CONFLICT');await this.room(c,scope,a,r.claims);}
  await this.authority.target(c);await this.authority.access(c,offer,mode);
  if(mode==='current'&&!same(await this.admitted(c,offer,scope),r.admissions))fail('CONFLICT');
  return freeze({reference:this.ref(r),record:r});
 }
}
