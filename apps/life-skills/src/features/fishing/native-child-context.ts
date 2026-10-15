import "server-only";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import {asId} from "../../lib/ids.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {unseal,type Keyring} from "../identity/crypto.ts";
import {one,type IdentityStore,type SqlSession} from "../identity/store.ts";
import {systemClock,type Actor,type IdentityClock,type PersonId} from "../identity/types.ts";

export const educationalChildContextLimit=100;
export type EducationalChildContext=Readonly<{learnerId:PersonId;displayName:string}>;
export type EducationalChildContexts=Readonly<{
 children:readonly EducationalChildContext[];selectedLearnerId:PersonId|null;
}>;
const person=z.uuid(),profile=z.object({displayName:z.string().min(1).max(160).refine(value=>value.trim().length>0)});

/** Existing native relationship only. This is NOT enrollment, a case, a lesson
 * grant or child-account enablement. Null selection never picks the first child.
 * The same supplied transaction may be used by MAIN's native integration; it
 * independently verifies the ordinary session rather than trusting hook facts.
 */
export async function readEducationalChildContexts(tx:SqlSession,actor:Actor,ring:Keyring,now:Date,
 selectedLearnerId:string|null=null):Promise<EducationalChildContexts>{
 try{
  if(!Number.isFinite(now.valueOf()))throw new AppError("UNAVAILABLE");
  const selection=selectedLearnerId===null?null:person.safeParse(selectedLearnerId);
  if(selection&&!selection.success)throw new AppError("INVALID_REQUEST");
  const selected=selection?.success?selection.data.toLowerCase():null;
  await lockWorkspace(tx,actor.workspaceId);
  const session=await one(tx,`SELECT s.account_id FROM ls_identity.sessions s
   JOIN ls_identity.accounts a ON a.workspace_id=s.workspace_id AND a.id=s.account_id
   JOIN ls_identity.account_subjects b ON b.workspace_id=a.workspace_id AND b.account_id=a.id
   WHERE s.workspace_id=$1 AND s.account_id=$2 AND s.token_digest=$3 AND s.revoked_at IS NULL
    AND s.expires_at>GREATEST($4::timestamptz,clock_timestamp()) AND a.state='active'
   FOR SHARE OF s,a,b`,[actor.workspaceId,actor.id,actor.sessionDigest,now]);
  if(!session)throw new AppError("UNAUTHENTICATED");
  const current=await freshActor(tx,actor,now);
  if(current.role!=="parent")throw new AppError("FORBIDDEN");
  if(!(current.emailVerifiedAt instanceof Date)||!Number.isFinite(current.emailVerifiedAt.valueOf())||current.emailVerifiedAt.valueOf()>now.valueOf())throw new AppError("UNAUTHENTICATED");
  const rows=await tx.query<{id:string;ciphertext:string}>(`SELECT p.id,p.profile_ciphertext AS ciphertext
   FROM ls_education.guardian_authorities g
   JOIN ls_identity.people p ON p.workspace_id=g.workspace_id AND p.id=g.learner_id
   JOIN ls_identity.accounts verifier ON verifier.workspace_id=g.workspace_id AND verifier.id=g.verified_by
   WHERE g.workspace_id=$1 AND g.account_id=$2 AND g.active AND g.verified_at<=clock_timestamp()
    AND length(btrim(g.source_reference))>0 AND p.kind='minor' AND verifier.role='practitioner'
    AND NOT EXISTS(SELECT 1 FROM ls_education.access_revocations r WHERE r.workspace_id=g.workspace_id
     AND (r.account_id IS NULL OR r.account_id=g.account_id) AND (r.learner_id IS NULL OR r.learner_id=g.learner_id)
     AND r.module_id IS NULL AND r.version IS NULL)
   ORDER BY p.id LIMIT 101 FOR SHARE OF g,p,verifier`,[current.workspaceId,current.id]);
  if(rows.length>educationalChildContextLimit)throw new AppError("UNAVAILABLE");
  const children=rows.map(row=>{
   const learnerId=asId(person.parse(row.id),"person");
   const label=profile.parse(JSON.parse(unseal(row.ciphertext,`person:${current.workspaceId}:${learnerId}`,ring))).displayName;
   return Object.freeze({learnerId,displayName:label});
  });
  if(selected!==null&&!children.some(child=>child.learnerId===selected))throw new AppError("NOT_FOUND");
  return Object.freeze({children:Object.freeze(children),selectedLearnerId:selected===null?null:asId(selected,"person")});
 }catch(error){
  if(error instanceof AppError)throw error;
  // Do not return SQL, ciphertext, decrypted profile fields or validation input.
  throw new AppError("UNAVAILABLE");
 }
}

/** No env/connection discovery, importer, grant writer, implicit fallback or
 * request-supplied role. MAIN supplies the existing native store and keyring.
 */
export class NativeEducationalChildContexts {
 constructor(private readonly db:IdentityStore,private readonly ring:Keyring,private readonly clock:IdentityClock=systemClock){}
 async read(actor:Actor,selectedLearnerId:string|null=null):Promise<EducationalChildContexts>{
  try{return await this.db.transaction(tx=>readEducationalChildContexts(tx,actor,this.ring,this.clock.now(),selectedLearnerId));}
  catch(error){if(error instanceof AppError)throw error;throw new AppError("UNAVAILABLE");}
 }
}
