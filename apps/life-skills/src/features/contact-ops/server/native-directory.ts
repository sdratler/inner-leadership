import "server-only";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import type {IdentityStore} from "../../identity/store.ts";
import {freshActor} from "../../identity/data.ts";
import {unseal,type Keyring} from "../../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../../identity/types.ts";
import {requirePractitioner} from "../../cases/policy.ts";
import {readProspectJourneysFromTx,type ProspectJourneyState} from "../../prospects/journey-read.ts";
import {crmProfileAad} from "./native-store.ts";
import {dateOnly} from "../core/validation.ts";
import type {PeopleView,Page} from "../core/types.ts";

const leadId=z.string().regex(/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]+$/);
const profileSchema=z.object({personId:z.string().uuid(),stage:z.string().min(1).max(120),
 nextAction:z.string().max(500).nullable(),followUpDate:z.string().refine(dateOnly).nullable(),
 notes:z.string().max(5000),legacyIds:z.array(leadId).max(100).refine(ids=>new Set(ids).size===ids.length)});
const sourceSchema=z.object({sourceRow:z.number().int().min(2),payload:z.object({
 displayName:z.string(),language:z.string(),stageText:z.string(),sourceFields:z.record(z.string(),z.string())})});
const querySchema=z.object({view:z.enum(["all","prospects","paid","active","archived"]),
 search:z.string().max(200),stage:z.string().max(120).optional(),locale:z.enum(["he","en"]).optional(),
 due:z.enum(["any","today","overdue"]).optional(),today:z.string().refine(dateOnly),
 page:z.number().int().min(1).max(100000),pageSize:z.number().int().min(1).max(100),
 mode:z.enum(["live","demo"]).optional()}).strict();
export type NativeContactQuery=z.infer<typeof querySchema>;
export type NativeContactReference={leadId:string;phone:string;email:string;language:string;
 source:string;campaign:string;outcome:string;messageReceipt:string;
 /** Original spreadsheet values are claims/history, never payment/booking authority. */
 paymentClaim:string;bookingClaim:string;formSentClaim:string;formSubmittedClaim:string;
 sourceFileId:string;sourceSheetId:number;sourceRevision:string;journey:ProspectJourneyState};
export type NativeContactRow={personId:string;displayName:string;identityKind:"adult"|"minor";
 stage:string;nextAction:string|null;followUpDate:string|null;notes:string;version:number;
 mode:"live"|"demo";archived:boolean;doNotContact:boolean;references:NativeContactReference[]};
type StoredProfile={personId:string;kind:"adult"|"minor";personCiphertext:string;profileCiphertext:string;
 version:number;recordMode:"live"|"demo";demoBatchId:string|null;markerBatchId:string|null;persistedArchived:boolean};
type StoredLink={personId:string;sourceFileId:string;sourceSheetId:number;sourceRevision:string;
 leadId:string;snapshotCiphertext:string};
const BATCH=100,MAX_CONTACTS=10000;
const emptyJourney=():ProspectJourneyState=>({journeyState:"prospect",paymentVerified:false,bookingConfirmed:false});
// Historic Sheet statuses are descriptive, not an enum. Preserve the existing
// conservative archive/opt-out protection even when a reason follows the marker.
const archived=(stage:string)=>/archive|\b(?:closed|not interested|no fit)\b/i.test(stage);
const suppressed=(stage:string)=>/do[ _-]?not[ _-]?contact|\bopt(?:ed)?[ _-]?out\b/i.test(stage);
function contactLocale(language:string):"he"|"en"|null{
 const value=language.trim().toLocaleLowerCase();
 return ["he","hebrew","עברית"].includes(value)?"he":["en","english"].includes(value)?"en":null;
}
function field(fields:Record<string,string>,name:string):string{
 return Object.entries(fields).find(([header])=>header.trim()===name)?.[1]??"";
}
function parse<T>(schema:z.ZodType<T>,ciphertext:string,aad:string,keyring:Keyring):T{
 try{return schema.parse(JSON.parse(unseal(ciphertext,aad,keyring)));}
 catch{throw new AppError("UNAVAILABLE");}
}

/** Read model for the existing encrypted native shadow/cutover store. No network,
 * imports, sends, identity merge, or Sheet fallback. It is not an authority switch.
 * A calling operational route must separately prove the current cutover epoch.
 */
export class NativeContactDirectory {
 constructor(private readonly db:IdentityStore,private readonly keyring:Keyring,
  private readonly clock:IdentityClock=systemClock){}
 async list(actor:Actor,input:NativeContactQuery):Promise<Page<NativeContactRow>>{
  const parsed=querySchema.safeParse(input);
  if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const q=parsed.data;
  return this.db.transaction(async tx=>{
   // Keyset pages and actual payment/booking facts share one immutable snapshot.
   await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
   requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const rows:NativeContactRow[]=[];
   let after:string|null=null;
   for(;;){
    const profiles:StoredProfile[]=await tx.query<StoredProfile>(`SELECT p.person_id AS "personId",i.kind,
     i.profile_ciphertext AS "personCiphertext",p.payload_ciphertext AS "profileCiphertext",
     p.version,p.record_mode AS "recordMode",p.demo_batch_id AS "demoBatchId",d.batch_id AS "markerBatchId",
     (p.archived_at IS NOT NULL) AS "persistedArchived"
     FROM ls_contact_ops.profiles p JOIN ls_identity.people i ON i.workspace_id=p.workspace_id AND i.id=p.person_id
     LEFT JOIN ls_demo.records d ON d.workspace_id=p.workspace_id AND d.entity_kind='person' AND d.entity_key=p.person_id::text
     WHERE p.workspace_id=$1 AND ($2::uuid IS NULL OR p.person_id>$2::uuid)
     ORDER BY p.person_id LIMIT $3`,[actor.workspaceId,after,BATCH]);
    if(!profiles.length)break;
    if(rows.length+profiles.length>MAX_CONTACTS)throw new AppError("UNAVAILABLE");
    if(profiles.length>BATCH||profiles.some((r,i)=>i>0&&r.personId<=profiles[i-1]!.personId)||
     after!==null&&profiles[0]!.personId<=after)throw new AppError("UNAVAILABLE");
    const links=await tx.query<StoredLink>(`SELECT person_id AS "personId",source_file_id AS "sourceFileId",
     source_sheet_id AS "sourceSheetId",source_revision AS "sourceRevision",legacy_lead_id AS "leadId",
     snapshot_ciphertext AS "snapshotCiphertext" FROM ls_contact_ops.legacy_links
     WHERE workspace_id=$1 AND person_id IN (SELECT value::uuid FROM jsonb_array_elements_text($2::jsonb))
     ORDER BY person_id,legacy_lead_id,source_file_id,source_sheet_id`,
     [actor.workspaceId,JSON.stringify(profiles.map(p=>p.personId))]);
    const journeys=await readProspectJourneysFromTx(tx,actor.workspaceId,[...new Set(links.map(l=>l.leadId))]);
    for(const p of profiles){
     if(!Number.isSafeInteger(p.version)||p.version<1||
      !["live","demo"].includes(p.recordMode)||
      (p.recordMode==="demo"?(!p.demoBatchId||p.markerBatchId!==p.demoBatchId):p.demoBatchId!==null||p.markerBatchId!==null))throw new AppError("UNAVAILABLE");
     const profile=parse(profileSchema,p.profileCiphertext,crmProfileAad(actor.workspaceId,p.personId),this.keyring);
     const person=parse(z.object({displayName:z.string().max(120)}),p.personCiphertext,`person:${actor.workspaceId}:${p.personId}`,this.keyring);
     if(profile.personId!==p.personId)throw new AppError("UNAVAILABLE");
     const personLinks=links.filter(l=>l.personId===p.personId);
     if(new Set(personLinks.map(l=>l.leadId)).size!==personLinks.length||
      [...profile.legacyIds].sort().join("\0")!==personLinks.map(l=>l.leadId).sort().join("\0"))throw new AppError("UNAVAILABLE");
     const references=personLinks.map(l=>{
      const source=parse(sourceSchema,l.snapshotCiphertext,
       `ls_contact_ops/legacy/v1/${actor.workspaceId}/${l.sourceFileId}/${l.sourceSheetId}/${l.leadId}`,this.keyring);
      if(field(source.payload.sourceFields,"Lead ID").trim()!==l.leadId)throw new AppError("UNAVAILABLE");
      const f=source.payload.sourceFields;
      return {leadId:l.leadId,phone:field(f,"Phone"),email:field(f,"Email"),language:source.payload.language,
       source:field(f,"Lead source"),campaign:field(f,"Campaign"),outcome:field(f,"Outcome"),
       messageReceipt:field(f,"Message receipt"),paymentClaim:field(f,"Payment status"),bookingClaim:field(f,"Booking status"),
       formSentClaim:field(f,"Form sent"),formSubmittedClaim:field(f,"Form submitted"),
       sourceFileId:l.sourceFileId,sourceSheetId:l.sourceSheetId,sourceRevision:l.sourceRevision,
       journey:journeys.get(l.leadId)??emptyJourney()};
     });
     rows.push({personId:p.personId,displayName:p.recordMode==="demo"&&!person.displayName.startsWith("DEMO — ")?`DEMO — ${person.displayName}`:person.displayName,
      identityKind:p.kind,stage:profile.stage,nextAction:profile.nextAction,followUpDate:profile.followUpDate,
      notes:profile.notes,version:p.version,mode:p.recordMode,archived:p.persistedArchived||archived(profile.stage)||references.some(r=>archived(r.outcome)),
      doNotContact:suppressed(profile.stage)||references.some(r=>suppressed(r.outcome)),references});
    }
    after=profiles.at(-1)!.personId;
   }
   return selectNativeContacts(rows,q);
  });
 }
}

/** Called after the entire authorized native result was read, never a client page. */
export function selectNativeContacts(rows:readonly NativeContactRow[],input:NativeContactQuery):Page<NativeContactRow>{
 const q=querySchema.parse(input),text=q.search.trim().toLocaleLowerCase();
 const filtered=rows.filter(r=>{
  const closed=r.archived||r.doNotContact;
  // Synthetic records need an explicit administrative demo view. They do not
  // silently mix into the default live contact directory.
  if(r.mode!==(q.mode??"live"))return false;
  if(q.view==="archived"&&!closed)return false;
  if(q.view!=="all"&&q.view!=="archived"&&closed)return false;
  const facts=r.references.map(ref=>ref.journey);
  if(q.view==="active"&&!facts.some(j=>j.journeyState==="active"))return false;
  if(q.view==="paid"&&!facts.some(j=>j.paymentVerified&&!j.bookingConfirmed&&j.journeyState!=="hold"))return false;
  if(q.view==="prospects"&&facts.length&&!facts.some(j=>!["active","hold"].includes(j.journeyState)))return false;
  if(q.stage&&q.stage!==r.stage)return false;
  if(q.locale&&!r.references.some(ref=>contactLocale(ref.language)===q.locale))return false;
  if(q.due==="today"&&(!r.followUpDate||r.followUpDate>q.today))return false;
  if(q.due==="overdue"&&(!r.followUpDate||r.followUpDate>=q.today))return false;
  return !text||[r.displayName,...r.references.flatMap(ref=>[ref.phone,ref.email,ref.leadId])].some(v=>v.toLocaleLowerCase().includes(text));
 }).sort((a,b)=>a.displayName.localeCompare(b.displayName)||a.personId.localeCompare(b.personId));
 const pages=Math.max(1,Math.ceil(filtered.length/q.pageSize)),page=Math.min(q.page,pages);
 return {items:filtered.slice((page-1)*q.pageSize,page*q.pageSize),total:filtered.length,page,pageSize:q.pageSize,pages};
}

// Keep query view aligned with the supplied one-directory interaction contract.
export const nativeContactViews:readonly PeopleView[]=["all","prospects","paid","active","archived"];
