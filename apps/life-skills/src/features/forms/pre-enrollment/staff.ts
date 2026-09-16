import { AppError } from "../../../lib/errors.ts";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { requirePractitioner } from "../../cases/policy.ts";
import { freshActor } from "../../identity/data.ts";
import { unseal, seal, type Keyring } from "../../identity/crypto.ts";
import type { IdentityStore } from "../../identity/store.ts";
import type { Actor } from "../../identity/types.ts";
import { digestPreEnrollment, parsePreEnrollment, type PreEnrollmentInput } from "./schema.ts";

/** Practitioner-only private read/edit path. Original responses are immutable; edits append amendments. */
export class PreEnrollmentStaffService {
  constructor(private readonly store:IdentityStore,private readonly ring:Keyring,private readonly now:()=>Date=()=>new Date()){}
  async history(actor:Actor,receiptId:string):Promise<readonly PreEnrollmentInput[]>{return this.store.transaction(async tx=>{const current=await freshActor(tx,actor,this.now());requirePractitioner(current);const rows=await tx.query<{payload:string;id:string;lead:string}>(`SELECT r.payload_ciphertext AS payload,r.receipt_id AS id,i.stable_lead_ref AS lead FROM ls_intake.pre_enrollment_receipts r JOIN ls_intake.pre_enrollment_invitations i ON i.workspace_id=r.workspace_id AND i.invitation_id=r.invitation_id WHERE r.workspace_id=$1 AND r.receipt_id=$2 UNION ALL SELECT a.payload_ciphertext AS payload,a.amendment_id AS id,i.stable_lead_ref AS lead FROM ls_intake.pre_enrollment_amendments a JOIN ls_intake.pre_enrollment_receipts r ON r.workspace_id=a.workspace_id AND r.receipt_id=a.receipt_id JOIN ls_intake.pre_enrollment_invitations i ON i.workspace_id=r.workspace_id AND i.invitation_id=r.invitation_id WHERE a.workspace_id=$1 AND a.receipt_id=$2 ORDER BY id`,[current.workspaceId,receiptId]);if(!rows.length)throw new AppError("NOT_FOUND");return rows.map(row=>parsePreEnrollment(JSON.parse(unseal(row.payload,`pre-enrollment:${row.lead}:${receiptId}`,this.ring))));});}
  async amend(actor:Actor,receiptId:string,input:unknown):Promise<void>{const value=parsePreEnrollment(input);await this.store.transaction(async tx=>{const current=await freshActor(tx,actor,this.now());requirePractitioner(current);const row=await tx.query<{lead:string}>(`SELECT i.stable_lead_ref AS lead FROM ls_intake.pre_enrollment_receipts r JOIN ls_intake.pre_enrollment_invitations i ON i.workspace_id=r.workspace_id AND i.invitation_id=r.invitation_id WHERE r.workspace_id=$1 AND r.receipt_id=$2`,[current.workspaceId,receiptId]);if(!row[0])throw new AppError("NOT_FOUND");const amendmentId=randomUUID();await tx.query(`INSERT INTO ls_intake.pre_enrollment_amendments(workspace_id,amendment_id,receipt_id,actor_account_id,payload_ciphertext,payload_digest,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,[current.workspaceId,amendmentId,receiptId,current.id,seal(JSON.stringify(value),`pre-enrollment:${row[0].lead}:${receiptId}`,this.ring),digestPreEnrollment(value),this.now()]);});}
}
  async issue(actor:Actor,stableLeadRef:string,childCount:number):Promise<{token:string;expiresAt:string}>{
    if(!/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]+$/.test(stableLeadRef)||!Number.isInteger(childCount)||childCount<1||childCount>8)throw new AppError("INVALID_REQUEST");
    const token=randomBytes(32).toString("base64url"), tokenDigest=createHash("sha256").update(token).digest("hex"), now=this.now(), expiresAt=new Date(now.getTime()+7*24*60*60*1000), slots=Array.from({length:childCount},()=>randomUUID());
    await this.store.transaction(async tx=>{const current=await freshActor(tx,actor,now);requirePractitioner(current);await tx.query(`INSERT INTO ls_intake.pre_enrollment_invitations(workspace_id,invitation_id,token_digest,stable_lead_ref,child_slots,expires_at,created_at,created_by_account_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,[current.workspaceId,randomUUID(),tokenDigest,stableLeadRef,JSON.stringify(slots),expiresAt,now,current.id]);});
    return {token,expiresAt:expiresAt.toISOString()};
  }
