import 'server-only';
import { createHmac,randomUUID,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../lib/errors.ts';
import { failureResponse,readJson,successResponse } from '../../lib/http/json.ts';
import { asId } from '../../lib/ids.ts';
import { opaqueToken,seal,unseal } from '../identity/crypto.ts';
import { freshActor,lockWorkspace } from '../identity/data.ts';
import { one } from '../identity/store.ts';
import type { Actor } from '../identity/types.ts';
import { tripCommandSchema } from './contract.ts';
import type { IndividualTripStore } from './store.ts';

const grantInput=z.object({callerId:z.string().regex(/^[A-Za-z0-9:_-]{8,160}$/),minutes:z.number().int().min(1).max(30),write:z.boolean()}).strict();
const signed=z.object({grantId:z.uuid(),callerId:grantInput.shape.callerId,nonce:z.uuid(),timestamp:z.number().int().positive(),action:z.enum(['read','command']),command:tripCommandSchema.optional()}).strict();
export type SignedTripChatInput=z.infer<typeof signed>;
function canonical(value:unknown):string{
 if(!value||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>JSON.stringify(key)+':'+canonical(value)).join(',')+'}';
}
export function tripChatSignature(secret:string,input:SignedTripChatInput):string{return createHmac('sha256',secret).update(canonical(signed.parse(input))).digest('base64url');}
type Grant={ownerId:string;callerId:string;secret:string;scopes:string[];sessionDigest:string;actorExpiresAt:Date;expiresAt:Date;revokedAt:Date|null;personId:string;locale:'en'|'he';};
/** An exact caller grant is issued by the authenticated owner, expires with
 * that owner's native session, and records durable single-use nonces. Both
 * interfaces call the same native service; this module holds no trip ledger. */
export class IndividualTripOwnerChat {
 constructor(private readonly trips:IndividualTripStore){}
 async grant(actor:Actor,raw:unknown){
  const input=grantInput.safeParse(raw);if(!input.success)throw new AppError('INVALID_REQUEST');
  await this.trips.read(actor);if(actor.id!==this.trips.config.ownerAccountId||actor.role!=='practitioner')throw new AppError('NOT_FOUND');
  return this.trips.database.transaction(async tx=>{
   await lockWorkspace(tx,this.trips.identity.workspaceId);await freshActor(tx,actor,this.trips.clock.now());
   const id=randomUUID(),secret=opaqueToken(),now=this.trips.clock.now(),expiresAt=new Date(Math.min(actor.expiresAt,now.getTime()+input.data.minutes*60000));
   if(expiresAt<=now)throw new AppError('UNAUTHENTICATED');
   await tx.query('INSERT INTO ls_individual_trips.chat_grants(workspace_id,id,owner_account_id,caller_id,secret_ciphertext,scopes,session_digest,actor_expires_at,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6::text[],$7,$8,$9,$10)',[actor.workspaceId,id,actor.id,input.data.callerId,seal(secret,`trip-chat:${actor.workspaceId}:${id}`,this.trips.identity.keyring),input.data.write?'{read,command}':'{read}',actor.sessionDigest,new Date(actor.expiresAt),now,expiresAt]);
   return{id,secret,callerId:input.data.callerId,expiresAt:expiresAt.toISOString(),endpoint:this.trips.config.origin+'/api/individual-trips/chat'};
  });
 }
 async revoke(actor:Actor,id:string){
  if(!z.uuid().safeParse(id).success)throw new AppError('INVALID_REQUEST');
  await this.trips.read(actor);if(actor.id!==this.trips.config.ownerAccountId||actor.role!=='practitioner')throw new AppError('NOT_FOUND');
  await this.trips.database.transaction(async tx=>{await lockWorkspace(tx,actor.workspaceId);await freshActor(tx,actor,this.trips.clock.now());await tx.query('UPDATE ls_individual_trips.chat_grants SET revoked_at=$3 WHERE workspace_id=$1 AND id=$2 AND owner_account_id=$4',[actor.workspaceId,id,this.trips.clock.now(),actor.id]);});
  return{revoked:true};
 }
 async execute(raw:unknown,signature:string|null){
  const parsed=signed.safeParse(raw);if(!parsed.success||!signature||!TOKEN_SIGNATURE.test(signature))throw new AppError('UNAUTHENTICATED');
  const input=parsed.data;
  if(Math.abs(this.trips.clock.now().getTime()-input.timestamp)>60000||input.action==='read'&&input.command||input.action==='command'&&!input.command)throw new AppError('UNAUTHENTICATED');
  const actor=await this.trips.database.transaction(async tx=>{
   await lockWorkspace(tx,this.trips.identity.workspaceId);
   const grant=await one<Grant>(tx,`SELECT g.owner_account_id AS "ownerId",g.caller_id AS "callerId",g.secret_ciphertext AS secret,g.scopes,g.session_digest AS "sessionDigest",g.actor_expires_at AS "actorExpiresAt",g.expires_at AS "expiresAt",g.revoked_at AS "revokedAt",s.person_id AS "personId",a.locale
    FROM ls_individual_trips.chat_grants g JOIN ls_identity.accounts a ON a.workspace_id=g.workspace_id AND a.id=g.owner_account_id JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id
    WHERE g.workspace_id=$1 AND g.id=$2 FOR UPDATE OF g`,[this.trips.config.workspaceId,input.grantId]);
   if(!grant||grant.ownerId!==this.trips.config.ownerAccountId||grant.callerId!==input.callerId||grant.revokedAt||new Date(grant.expiresAt)<=this.trips.clock.now()||!grant.scopes.includes(input.action))throw new AppError('UNAUTHENTICATED');
   const secret=unseal(grant.secret,`trip-chat:${this.trips.config.workspaceId}:${input.grantId}`,this.trips.identity.keyring),expected=tripChatSignature(secret,input);
   if(!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw new AppError('UNAUTHENTICATED');
   const actor:Actor={id:asId(grant.ownerId,'account'),workspaceId:this.trips.identity.workspaceId,personId:asId(grant.personId,'person'),role:'practitioner',state:'active',locale:grant.locale,sessionDigest:grant.sessionDigest,expiresAt:new Date(grant.actorExpiresAt).getTime()};
   await freshActor(tx,actor,this.trips.clock.now());
   const nonce=await tx.query('INSERT INTO ls_individual_trips.chat_nonces(workspace_id,grant_id,nonce,used_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING nonce',[actor.workspaceId,input.grantId,input.nonce,this.trips.clock.now()]);
   if(nonce.length!==1)throw new AppError('CONFLICT');return actor;
  });
  // Grant revocation shares the native workspace lock. Recheck inside the same
  // transaction as the subsequent read/write, including operation replays.
  const guard=async(tx:import('../identity/store.ts').SqlSession)=>{
   const grant=await one(tx,'SELECT id FROM ls_individual_trips.chat_grants WHERE workspace_id=$1 AND id=$2 AND owner_account_id=$3 AND caller_id=$4 AND revoked_at IS NULL AND expires_at>GREATEST($5::timestamptz,clock_timestamp()) AND $6=ANY(scopes) FOR UPDATE',[actor.workspaceId,input.grantId,actor.id,input.callerId,this.trips.clock.now(),input.action]);
   if(!grant)throw new AppError('UNAUTHENTICATED');
  };
  if(input.action==='read')return this.trips.read(actor,guard);
  // Internal verification and invoice attachment retain their dedicated owner
  // adapters; a caller grant never turns browser-provided status into proof.
  if(input.command!.type==='invoice.attach')throw new AppError('FORBIDDEN');
  return this.trips.executeGuarded(actor,input.command!,guard);
 }
 async handle(request:Request):Promise<Response>{
  const id=randomUUID();try{
   if(request.method!=='POST'||new URL(request.url).origin!==this.trips.config.origin||new URL(request.url).search)throw new AppError('NOT_FOUND');
   return successResponse(await this.execute(await readJson(request,signed),request.headers.get('x-fishing-signature')),id);
  }catch(error){return failureResponse(error,id);}
 }
}
const TOKEN_SIGNATURE=/^[A-Za-z0-9_-]{43}$/;
