import "server-only";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import type {IdentityStore,SqlSession} from "../../identity/store.ts";
import {freshActor} from "../../identity/data.ts";
import {unseal,type Keyring} from "../../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../../identity/types.ts";
import {requirePractitioner} from "../../cases/policy.ts";
import {readProspectJourneysFromTx,type ProspectJourneyState} from "../../prospects/journey-read.ts";
import {crmProfileAad,crmProfileSchema} from "./native-store.ts";
import {dateOnly} from "../core/validation.ts";
import type {PeopleView,Page} from "../core/types.ts";
import type {Prospect} from "../../prospects/bridge.ts";
import {contactSuppressed,contactArchived as archived} from "../../prospects/native-edit.ts";
import {MAX_NATIVE_CONTACTS,MAX_OPERATIONAL_PROSPECTS} from "../core/limits.ts";
import {normalizePhone} from "../core/contact-resolution.ts";
import type {InboundActivity} from "../core/inbound-projection.ts";

const sourceSchema=z.object({sourceRow:z.number().int().min(2),payload:z.object({
 displayName:z.string(),language:z.string(),stageText:z.string(),sourceFields:z.record(z.string(),z.string())})});
const querySchema=z.object({view:z.enum(["all","prospects","paid","active","archived"]),
 search:z.string().max(200),stage:z.string().max(120).optional(),locale:z.enum(["he","en"]).optional(),
 due:z.enum(["any","today","overdue"]).optional(),today:z.string().refine(dateOnly),
 filter:z.enum(["all","today","new","intake","payment","booking","archived"]).optional(),
 page:z.number().int().min(1).max(100000),pageSize:z.number().int().min(1).max(100),
 mode:z.enum(["live","demo"]).optional(),personId:z.string().uuid().optional(),
 leadId:z.string().regex(/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]{1,80}$/).optional()}).strict();
export type NativeContactQuery=z.infer<typeof querySchema>;
export type NativeContactReference={leadId:string;phone:string;email:string;language:string;
 source:string;campaign:string;outcome:string;owner?:string;sourceDoNotContact?:boolean;messageReceipt:string;
 /** Original spreadsheet values are claims/history, never payment/booking authority. */
 paymentClaim:string;bookingClaim:string;formSentClaim:string;formSubmittedClaim:string;
 sourceFileId:string|null;sourceSheetId:number|null;sourceRevision:string|null;journey:ProspectJourneyState;
 /** Native origin has no invented workbook, sheet, revision or imported claim. */
  nativeOrigin?:"native_manual"|"native_whatsapp";nativeCreatedAt?:string};
export type NativeContactRow={personId:string;displayName:string;identityKind:"adult"|"minor";
 stage:string;nextAction:string|null;followUpDate:string|null;notes:string;version:number|null;
  mode:"live"|"demo";archived:boolean;doNotContact:boolean;references:NativeContactReference[];inboundActivity?:InboundActivity;
 /** Real assigned cases, joined by canonical person UUID. Never phone/name matching. */
 caseLinks?:{caseId:string;state:string}[]};
type StoredProfile={personId:string;kind:"adult"|"minor";personCiphertext:string;profileCiphertext:string;
 version:number;recordMode:"live"|"demo";demoBatchId:string|null;markerBatchId:string|null;persistedArchived:boolean};
type StoredLink={personId:string;sourceFileId:string;sourceSheetId:number;sourceRevision:string;
 leadId:string;snapshotCiphertext:string};
const BATCH=100,MAX_CONTACTS=MAX_NATIVE_CONTACTS;
const emptyJourney=():ProspectJourneyState=>({journeyState:"prospect",paymentVerified:false,bookingConfirmed:false});
// Historic Sheet statuses are descriptive, not an enum. Preserve the existing
// conservative archive/opt-out protection even when a reason follows the marker.
const suppressed=contactSuppressed;
function contactLocale(language:string):"he"|"en"|null{
 const value=language.trim().toLocaleLowerCase();
 return ["he","hebrew","עברית"].includes(value)?"he":["en","english"].includes(value)?"en":null;
}
function field(fields:Record<string,string>,name:string):string{
 return Object.entries(fields).find(([header])=>header.trim()===name)?.[1]??"";
}
/** Only genuine same-person, practitioner-assigned case links are eligible.
 * Historical Sheet claims neither grant access nor select an ambiguous case. */
export function canonicalProspectCase(links:NativeContactRow["caseLinks"],orderCaseId:string|null):string{
 const allowed=[...new Set((links??[]).map(c=>c.caseId))];
 if(allowed.length===1)return allowed[0]!;
 return orderCaseId&&allowed.includes(orderCaseId)?orderCaseId:"";
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
  if(!querySchema.safeParse(input).success)throw new AppError("INVALID_REQUEST");
  return this.db.transaction(async tx=>{
   // The unactivated shadow read model retains its own isolated snapshot.
   await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
   return this.listInTransaction(tx,actor,input);
  });
 }
 /** Internal composition only: the authority adapter owns this read-only
  * transaction and contact-write fence. Never start another transaction or
  * change its isolation after the epoch check. Journey facts are observations,
  * not permission to bill, book, activate or send.
  */
 async listInTransaction(tx:SqlSession,actor:Actor,input:NativeContactQuery):Promise<Page<NativeContactRow>>{
  const parsed=querySchema.safeParse(input);
  if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const q=parsed.data;
  const {rows}=await this.readAllInTransaction(tx,actor);
  return selectNativeContacts(rows,q);
 }
 /** Matching an unverified/shared endpoint never grants identity or case access.
  * Creation refuses every existing endpoint claim for explicit owner resolution;
  * only the exact original operation is automatically replayed.
  */
 async hasPhoneClaimInTransaction(tx:SqlSession,actor:Actor,phone:string):Promise<boolean>{
  const normalized=normalizePhone(phone);if(!normalized)throw new AppError("INVALID_REQUEST");
  const {rows}=await this.readAllInTransaction(tx,actor);
  if(rows.length>=MAX_CONTACTS)throw new AppError("UNAVAILABLE");
  if(rows.some(row=>row.references.some(ref=>normalizePhone(ref.phone)===normalized)))return true;
  // Accounts can belong to case-only people or share a household endpoint with
  // no CRM profile/reference. Every workspace account claim blocks creation;
  // verification, role or state must not turn this into an identity merge.
  // The caller holds the same workspace lock used by identity phone mutations.
  const accounts=await tx.query<{id:string;phoneCiphertext:string}>(`SELECT id,phone_ciphertext AS "phoneCiphertext"
   FROM ls_identity.accounts WHERE workspace_id=$1 AND phone_ciphertext IS NOT NULL
   ORDER BY id LIMIT $2`,[actor.workspaceId,MAX_CONTACTS+1]);
  if(accounts.length>MAX_CONTACTS)throw new AppError("UNAVAILABLE");
  for(const account of accounts){
   let claim:string|null;
   try{claim=normalizePhone(unseal(account.phoneCiphertext,`phone:${actor.workspaceId}:${account.id}`,this.keyring));}
   catch{throw new AppError("UNAVAILABLE");}
   if(!claim)throw new AppError("UNAVAILABLE");
   if(claim===normalized)return true;
  }
  return false;
 }
 async nativeInquiryPersonInTransaction(tx:SqlSession,actor:Actor,leadId:string):Promise<string|null>{
  const {rows}=await this.readAllInTransaction(tx,actor);
  const matches=rows.filter(row=>row.references.some(ref=>ref.leadId===leadId));
  if(matches.length>1)throw new AppError("CONFLICT");
  const row=matches[0];
   return row?.references.some(ref=>ref.leadId===leadId&&Boolean(ref.nativeOrigin))?row.personId:null;
 }
 /** Server-only compatibility projection for existing operational consumers.
  * Read all bounded rows in the caller's ONE authority-locked transaction;
  * never paginate separate transactions, expose unmapped history, or send.
  */
 async prospectsInTransaction(tx:SqlSession,actor:Actor,expectedEpoch:number):Promise<Prospect[]>{
  if(!Number.isSafeInteger(expectedEpoch)||expectedEpoch<0)throw new AppError("INVALID_REQUEST");
  const {rows,sourceFields}=await this.readAllInTransaction(tx,actor),seen=new Set<string>();
  const leadIds=rows.filter(r=>r.mode==="live").flatMap(r=>r.references.map(ref=>ref.leadId));
  if(leadIds.length>MAX_OPERATIONAL_PROSPECTS)throw new AppError("UNAVAILABLE");
  const orders=leadIds.length?await tx.query<{leadId:string;caseId:string}>(`SELECT j.stable_lead_ref AS "leadId",o.case_id AS "caseId"
   FROM ls_onboarding.prospect_journeys j JOIN ls_onboarding.first_session_orders o
    ON o.workspace_id=j.workspace_id AND o.order_id=j.first_session_order_id
   WHERE j.workspace_id=$1 AND j.stable_lead_ref IN (SELECT jsonb_array_elements_text($2::jsonb))`,
   [actor.workspaceId,JSON.stringify(leadIds)]):[];
  if(new Set(orders.map(o=>o.leadId)).size!==orders.length)throw new AppError("CONFLICT");
  const orderCases=new Map(orders.map(o=>[o.leadId,o.caseId]));
  const result:Prospect[]=[];
  for(const row of rows){
   if(row.mode!=="live")continue;
   for(const ref of row.references){
    if(seen.has(ref.leadId))throw new AppError("CONFLICT");seen.add(ref.leadId);
    const fields=sourceFields.get(ref.leadId);if(!fields&&!ref.nativeOrigin)throw new AppError("UNAVAILABLE");
    const get=(name:string)=>field(fields??{},name);
    result.push({leadId:ref.leadId,name:row.displayName,phone:ref.phone,email:ref.email,language:ref.language,
     receivedAt:ref.nativeCreatedAt??get("Date received"),source:ref.source,campaign:ref.campaign,
     stage:row.doNotContact?"Do not contact":row.archived?"Archived":row.stage,
      lastContact:(ref.nativeOrigin==="native_whatsapp"?row.inboundActivity?.lastInboundAt:undefined)??get("Last contact"),nextAction:row.nextAction??"",dueDate:row.followUpDate??"",
     outcome:ref.outcome,notes:row.notes,
     // Missing/stale Sheet claims must not unlink a genuine canonical client.
     // Multiple cases need the exact real journey/order relation, not a guess.
     caseId:canonicalProspectCase(row.caseLinks,orderCases.get(ref.leadId)??null),
     formSent:ref.formSentClaim,formSubmitted:ref.formSubmittedClaim,paymentLinkSent:get("Payment link sent"),
     paymentMethod:get("Payment method"),paymentStatus:ref.paymentClaim,paymentAllocation:get("Payment allocation"),
      bookingStatus:ref.bookingClaim,messageReceipt:(ref.nativeOrigin==="native_whatsapp"?row.inboundActivity?.lastMessageKey:undefined)??ref.messageReceipt,updateProvenance:get("Update provenance"),
      firstInboundAt:(ref.nativeOrigin==="native_whatsapp"?row.inboundActivity?.firstInboundAt:undefined)??get("First inbound at"),
      lastInboundAt:(ref.nativeOrigin==="native_whatsapp"?row.inboundActivity?.lastInboundAt:undefined)??get("Last inbound at"),owner:ref.owner??get("Response owner"),...ref.journey,
     ...(row.version===null?{}:{nativeEdit:{personId:row.personId,profileVersion:row.version,authorityEpoch:expectedEpoch}})});
   }
  }
  return result.sort((a,b)=>a.leadId.localeCompare(b.leadId));
 }
 private async readAllInTransaction(tx:SqlSession,actor:Actor):Promise<{rows:NativeContactRow[];sourceFields:Map<string,Record<string,string>>}>{
   requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const rows:NativeContactRow[]=[];
   const sourceFields=new Map<string,Record<string,string>>();
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
    // Read the current profile first so real native inquiry IDs join the same
    // authoritative form/payment/booking facts as genuine legacy inquiry IDs.
    const decoded=new Map(profiles.map(p=>[p.personId,parse(crmProfileSchema,p.profileCiphertext,crmProfileAad(actor.workspaceId,p.personId),this.keyring)]));
     const inquiryIds=profiles.flatMap(p=>{const profile=decoded.get(p.personId)!;return [profile.nativeInquiry?.leadId,profile.whatsappInquiry?.leadId].filter((id):id is string=>Boolean(id));});
    const journeys=await readProspectJourneysFromTx(tx,actor.workspaceId,[...new Set([...links.map(l=>l.leadId),...inquiryIds])]);
    for(const p of profiles){
     if(!Number.isSafeInteger(p.version)||p.version<1||
      !["live","demo"].includes(p.recordMode)||
      (p.recordMode==="demo"?(!p.demoBatchId||p.markerBatchId!==p.demoBatchId):p.demoBatchId!==null||p.markerBatchId!==null))throw new AppError("UNAVAILABLE");
     const profile=decoded.get(p.personId)!;
     const person=parse(z.object({displayName:z.string().max(120)}),p.personCiphertext,`person:${actor.workspaceId}:${p.personId}`,this.keyring);
     if(profile.personId!==p.personId)throw new AppError("UNAVAILABLE");
     const personLinks=links.filter(l=>l.personId===p.personId);
     if(new Set(personLinks.map(l=>l.leadId)).size!==personLinks.length||
      [...profile.legacyIds].sort().join("\0")!==personLinks.map(l=>l.leadId).sort().join("\0"))throw new AppError("UNAVAILABLE");
     const references:NativeContactReference[]=personLinks.map(l=>{
      const source=parse(sourceSchema,l.snapshotCiphertext,
       `ls_contact_ops/legacy/v1/${actor.workspaceId}/${l.sourceFileId}/${l.sourceSheetId}/${l.leadId}`,this.keyring);
      if(field(source.payload.sourceFields,"Lead ID").trim()!==l.leadId)throw new AppError("UNAVAILABLE");
      const f=source.payload.sourceFields;
      if(sourceFields.has(l.leadId))throw new AppError("CONFLICT");
      sourceFields.set(l.leadId,f);
      return {leadId:l.leadId,phone:field(f,"Phone"),email:field(f,"Email"),language:source.payload.language,
       source:field(f,"Lead source"),campaign:field(f,"Campaign"),outcome:profile.leadUpdates?.[l.leadId]?.outcome??field(f,"Outcome"),
       owner:profile.leadUpdates?.[l.leadId]?.owner??field(f,"Response owner"),
       sourceDoNotContact:suppressed(field(f,"Outcome"))||suppressed(source.payload.stageText),
       messageReceipt:field(f,"Message receipt"),paymentClaim:field(f,"Payment status"),bookingClaim:field(f,"Booking status"),
       formSentClaim:field(f,"Form sent"),formSubmittedClaim:field(f,"Form submitted"),
       sourceFileId:l.sourceFileId,sourceSheetId:l.sourceSheetId,sourceRevision:l.sourceRevision,
       journey:journeys.get(l.leadId)??emptyJourney()};
     });
      for(const inquiry of [profile.nativeInquiry,profile.whatsappInquiry]){if(!inquiry)continue;
      references.push({leadId:inquiry.leadId,phone:inquiry.phone,email:"",language:inquiry.language,
       source:inquiry.source,campaign:"",outcome:profile.leadUpdates?.[inquiry.leadId]?.outcome??"",
       owner:profile.leadUpdates?.[inquiry.leadId]?.owner??"",messageReceipt:inquiry.origin==="native_whatsapp"?profile.inboundActivity?.lastMessageKey??"":"",paymentClaim:"",bookingClaim:"",
       formSentClaim:"",formSubmittedClaim:"",sourceFileId:null,sourceSheetId:null,sourceRevision:null,
       nativeOrigin:inquiry.origin,nativeCreatedAt:inquiry.createdAt,journey:journeys.get(inquiry.leadId)??emptyJourney()});
     }
     rows.push({personId:p.personId,displayName:p.recordMode==="demo"&&!person.displayName.startsWith("DEMO — ")?`DEMO — ${person.displayName}`:person.displayName,
      identityKind:p.kind,stage:profile.stage,nextAction:profile.nextAction,followUpDate:profile.followUpDate,
      // A closed historical inquiry cannot archive another open inquiry for the
      // same canonical person. Explicit profile archival remains authoritative.
      notes:profile.notes,version:p.version,mode:p.recordMode,archived:p.persistedArchived||archived(profile.stage)||(references.length>0&&references.every(r=>archived(r.outcome))),
      doNotContact:profile.doNotContact===true||suppressed(profile.stage)||references.some(r=>r.sourceDoNotContact||suppressed(r.outcome)),references,
      ...(profile.inboundActivity?{inboundActivity:profile.inboundActivity}:{})});
    }
    after=profiles.at(-1)!.personId;
   }
   // Retain authorized clients without a CRM profile. They are not fabricated
   // prospects: a null version explicitly prevents administrative profile edits.
   // No clinical note, score, family membership or other practitioner's case is read.
   const cases=await tx.query<{personId:string;caseId:string;state:string;kind:"adult"|"minor";
    personCiphertext:string;demoBatchId:string|null;markerBatchId:string|null}>(`SELECT p.id AS "personId",c.id AS "caseId",c.state,p.kind,
    p.profile_ciphertext AS "personCiphertext",c.demo_batch_id AS "demoBatchId",d.batch_id AS "markerBatchId"
    FROM ls_cases.cases c JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id
    JOIN ls_identity.people p ON p.workspace_id=cl.workspace_id AND p.id=cl.person_id
    LEFT JOIN ls_demo.cases d ON d.workspace_id=c.workspace_id AND d.case_id=c.id
    WHERE c.workspace_id=$1 AND c.practitioner_account_id=$2 ORDER BY p.id,c.id LIMIT $3`,
    [actor.workspaceId,actor.id,MAX_CONTACTS+1]);
   if(cases.length>MAX_CONTACTS)throw new AppError("UNAVAILABLE");
   const byPerson=new Map(rows.map(r=>[r.personId,r]));
   for(const c of cases){
    if(c.demoBatchId!==c.markerBatchId)throw new AppError("UNAVAILABLE");
    const mode=c.demoBatchId?"demo":"live";
    let row=byPerson.get(c.personId);
    if(row&&(row.mode!==mode||row.identityKind!==c.kind))throw new AppError("UNAVAILABLE");
    if(!row){
     const p=parse(z.object({displayName:z.string().max(120)}),c.personCiphertext,`person:${actor.workspaceId}:${c.personId}`,this.keyring);
     row={personId:c.personId,displayName:mode==="demo"&&!p.displayName.startsWith("DEMO — ")?`DEMO — ${p.displayName}`:p.displayName,
      identityKind:c.kind,stage:c.state,nextAction:null,followUpDate:null,notes:"",version:null,mode,
      archived:archived(c.state)||/discharged|revoked/i.test(c.state),doNotContact:false,references:[],caseLinks:[]};
     rows.push(row);byPerson.set(c.personId,row);
     if(rows.length>MAX_CONTACTS)throw new AppError("UNAVAILABLE");
    }
   (row.caseLinks??=[]).push({caseId:c.caseId,state:c.state});
   }
   // A person may have both an archived case and an active case. Canonical
   // grouping must not classify them from whichever UUID was encountered first.
   for(const row of rows)if(row.caseLinks?.length){
    const activeCase=row.caseLinks.some(c=>c.state==="active");
    // Assigned clinical access survives archived marketing history. This is a
    // projection, not an unarchive or permission to contact an opted-out person.
    if(activeCase)row.archived=false;
    if(row.version===null){
     row.stage=activeCase?"active":row.caseLinks[0]!.state;
     row.archived=row.caseLinks.every(c=>["completed","archived"].includes(c.state));
    }
   }
   return {rows,sourceFields};
 }
}

/** Called after the entire authorized native result was read, never a client page. */
export function selectNativeContacts(rows:readonly NativeContactRow[],input:NativeContactQuery):Page<NativeContactRow>{
 const q=querySchema.parse(input),text=q.search.trim().toLocaleLowerCase(),view=q.filter==="archived"?"archived":q.filter==="booking"?"paid":q.view;
 if(q.leadId&&rows.filter(r=>r.mode===(q.mode??"live")&&r.references.some(ref=>ref.leadId===q.leadId)).length>1)throw new AppError("CONFLICT");
 const filtered=rows.filter(r=>{
  const activeCase=r.caseLinks?.some(c=>c.state==="active")??false;
  const assignedClient=Boolean(r.caseLinks?.length);
  const closed=(r.archived&&!activeCase)||r.doNotContact;
  // Synthetic records need an explicit administrative demo view. They do not
  // silently mix into the default live contact directory.
  if(r.mode!==(q.mode??"live"))return false;
  if(q.personId&&r.personId!==q.personId)return false;
  if(q.leadId&&!r.references.some(ref=>ref.leadId===q.leadId))return false;
  if(view==="archived"&&!closed)return false;
  if(view!=="all"&&view!=="archived"&&closed&&!(view==="active"&&activeCase))return false;
  const openReferences=r.references.filter(ref=>!archived(ref.outcome)&&!suppressed(ref.outcome));
  if(view==="active"&&!activeCase&&!openReferences.some(ref=>ref.journey.journeyState==="active"))return false;
  if(view==="paid"&&!openReferences.some(ref=>ref.journey.paymentVerified&&!ref.journey.bookingConfirmed&&ref.journey.journeyState!=="hold"))return false;
  if(view==="prospects"&&(r.references.length?!openReferences.some(ref=>!["active","hold"].includes(ref.journey.journeyState)):assignedClient))return false;
  // Preserve existing workflow links without promoting historic payment/booking
  // claims to verified facts. Real journey state supersedes an older form claim.
  if(q.filter==="today"&&(!r.followUpDate||r.followUpDate>q.today))return false;
  if(q.filter==="new"&&(r.version===null||(r.references.length?!openReferences.some(ref=>!ref.formSentClaim&&!ref.formSubmittedClaim&&!ref.journey.paymentVerified&&!ref.journey.bookingConfirmed&&ref.journey.journeyState==="prospect"):assignedClient)))return false;
  if(q.filter==="intake"&&!openReferences.some(ref=>ref.formSentClaim&&!ref.formSubmittedClaim&&ref.journey.journeyState==="prospect"&&!ref.journey.paymentVerified))return false;
  if(q.filter==="payment"&&!openReferences.some(ref=>(ref.formSubmittedClaim||ref.journey.journeyState==="awaiting_payment")&&!ref.journey.paymentVerified&&!["active","hold"].includes(ref.journey.journeyState)))return false;
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
