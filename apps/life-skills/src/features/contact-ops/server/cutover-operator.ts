import 'server-only';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {z} from 'zod';
import {SHADOW_ATTESTATION_PUBLIC_KEY} from './shadow-attestation.ts';
import {canonical,requireThat} from '../core/validation.ts';
import {blindEmail,unseal,type Keyring} from '../../identity/crypto.ts';
import {demoAccountBatch} from '../../demo/provenance.ts';
import type {SqlSession} from '../../identity/store.ts';
import type {Actor} from '../../identity/types.ts';
import {asId} from '../../../lib/ids.ts';

export type CutoverPrincipal=Pick<Actor,'id'|'workspaceId'>;
const sha=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().uuid();
export const cutoverOperatorEnvelopeSchema=z.object({
 version:z.literal('ls-contact-cutover-operator-v1'),
 action:z.enum(['preflight','prepare','freeze','delta','switch_native','prepare_rollback','finish_rollback']),
 workspaceId:uuid,ownerAccountId:uuid,deploymentId:uuid,reviewedMainSha:z.string().regex(/^[a-f0-9]{40}$/),
 sourceTreeSha256:sha,operatorSha256:sha,payloadSha256:sha,databaseBindingSha256:sha,integrityKeySha256:sha,
 issuedAt:z.string().datetime(),expiresAt:z.string().datetime(),
}).strict();
export type CutoverOperatorEnvelope=z.infer<typeof cutoverOperatorEnvelopeSchema>;
export function cutoverOperatorMessage(envelope:CutoverOperatorEnvelope){return Buffer.from(canonical(cutoverOperatorEnvelopeSchema.parse(envelope)),'utf8');}
export function verifyCutoverOperatorEnvelope(envelope:unknown,signature:string,now:Date,publicKey=SHADOW_ATTESTATION_PUBLIC_KEY):envelope is CutoverOperatorEnvelope{
 const parsed=cutoverOperatorEnvelopeSchema.safeParse(envelope);if(!parsed.success||!/^[A-Za-z0-9+/]{86}==$/.test(signature))return false;
 const issued=Date.parse(parsed.data.issuedAt),expires=Date.parse(parsed.data.expiresAt);
 if(!Number.isFinite(now.getTime())||issued>now.getTime()+5000||expires<=now.getTime()||expires<=issued||expires-issued>15*60_000)return false;
 try{return verify(null,cutoverOperatorMessage(parsed.data),createPublicKey({key:Buffer.from(publicKey,'base64'),format:'der',type:'spki'}),Buffer.from(signature,'base64'));}catch{return false;}
}
export function cutoverOperatorAdmitted(env:Record<string,string|undefined>,entry:string|undefined){return env.LS_NATIVE_SHADOW_IMPORT_APPROVED==='true'&&
 env.RAILWAY_PROJECT_ID==='3b756632-1f66-4f75-a016-eabc37aa0d67'&&env.RAILWAY_ENVIRONMENT_ID==='dd91bd71-57cc-45e6-a75b-8c858491d7c7'&&
 env.RAILWAY_SERVICE_ID==='0267d061-f3ce-4a0a-82d4-ce133e4501e9'&&/(?:^|[\\/])scripts[\\/]contact-cutover-operator\.ts$/.test(entry??'');}
const permits=new WeakSet<object>();
export type CutoverOperatorPermit=Readonly<{envelope:CutoverOperatorEnvelope;signature:string}>;
export function assertCutoverOperatorPayload(permit:CutoverOperatorPermit,payload:unknown,integrityKey:string){requireThat(permits.has(permit)&&
 createHash('sha256').update(canonical(payload)).digest('hex')===permit.envelope.payloadSha256&&
 createHash('sha256').update(integrityKey).digest('hex')===permit.envelope.integrityKeySha256,'CUTOVER_OPERATOR_PAYLOAD_MISMATCH');}
/** Process-local, expiring, signed action capability. Never a session or HTTP principal. */
export function admitCutoverOperator(envelope:unknown,signature:string,now=new Date()):CutoverOperatorPermit{
 requireThat(cutoverOperatorAdmitted(process.env,process.argv[1])&&verifyCutoverOperatorEnvelope(envelope,signature,now),'CUTOVER_OPERATOR_NOT_ADMITTED');
 const value=cutoverOperatorEnvelopeSchema.parse(envelope);
 requireThat(value.workspaceId===process.env.LS_IDENTITY_WORKSPACE_ID&&value.deploymentId===process.env.RAILWAY_DEPLOYMENT_ID,'CUTOVER_OPERATOR_TARGET_MISMATCH');
 const permit=Object.freeze({envelope:Object.freeze(value),signature});permits.add(permit);return permit;
}
export async function authorizeCutoverOperator(tx:SqlSession,keyring:Keyring,lookupKey:Buffer,permit:CutoverOperatorPermit,actions:readonly CutoverOperatorEnvelope['action'][],now=new Date()):Promise<CutoverPrincipal>{
 requireThat(permits.has(permit)&&cutoverOperatorAdmitted(process.env,process.argv[1])&&verifyCutoverOperatorEnvelope(permit.envelope,permit.signature,now),'CUTOVER_OPERATOR_NOT_ADMITTED');
 const e=permit.envelope;
 requireThat(actions.includes(e.action)&&e.workspaceId===process.env.LS_IDENTITY_WORKSPACE_ID&&e.deploymentId===process.env.RAILWAY_DEPLOYMENT_ID,'CUTOVER_OPERATOR_ACTION_MISMATCH');
 const rows=await tx.query<{id:string;emailVerifiedAt:Date|null;emailCiphertext:string;emailBlind:string}>(`SELECT id,email_verified_at AS "emailVerifiedAt",email_ciphertext AS "emailCiphertext",email_blind AS "emailBlind"
 FROM ls_identity.accounts WHERE workspace_id=$1 AND role='practitioner' AND state='active'`,[e.workspaceId]);
 const owner=rows[0];requireThat(rows.length===1&&owner?.id===e.ownerAccountId&&Boolean(owner.emailVerifiedAt),'CUTOVER_OPERATOR_OWNER_INVALID');
 requireThat(await demoAccountBatch(tx,e.workspaceId,e.ownerAccountId)===null,'CUTOVER_OPERATOR_DEMO_FORBIDDEN');
 try{requireThat(lookupKey.length===32&&JSON.parse(owner!.emailCiphertext).kid===keyring.activeKeyId,'CUTOVER_OPERATOR_KEYS_INVALID');
  const email=unseal(owner!.emailCiphertext,`email:${e.workspaceId}:${e.ownerAccountId}`,keyring);
  requireThat(blindEmail(email,lookupKey)===owner!.emailBlind,'CUTOVER_OPERATOR_KEYS_INVALID');
 }catch{throw Error('CUTOVER_OPERATOR_KEYS_INVALID');}
 return {id:asId(e.ownerAccountId,'account'),workspaceId:asId(e.workspaceId,'workspace')};
}
