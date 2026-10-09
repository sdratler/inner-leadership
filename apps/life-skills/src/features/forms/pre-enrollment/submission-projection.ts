import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {AppError} from "../../../lib/errors.ts";
import type {IdentityStore} from "../../identity/store.ts";
import type {RequestContext} from "../../identity/types.ts";
import type {IntakeReceipt} from "./service.ts";
import {isSyntheticIntakeReceipt} from "./synthetic-fixture.ts";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const suppressionKind="intake_projection_suppressed_before_bridge/v1";
function suppressionEventId(workspace:string,operation:string,receipt:string,request:string):string{
 const bytes=createHash("sha256").update(JSON.stringify([suppressionKind,workspace,operation,receipt,request])).digest().subarray(0,16);
 bytes[6]=(bytes[6]!&15)|128;bytes[8]=(bytes[8]!&63)|128;
 const hex=bytes.toString("hex");return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function suppressionAction(operationId:string,receiptId:string):string{
 return JSON.stringify({kind:suppressionKind,operationId,receiptId});
}
function projectionContext(value:RequestContext|undefined):RequestContext{
 const context=value??{requestId:randomUUID(),now:new Date()};
 if(!uuid.test(context.requestId)||!(context.now instanceof Date)||!Number.isFinite(context.now.getTime()))throw new AppError("UNAVAILABLE");
 return context;
}

/** No browser flag, name or lead prefix can select suppression. Failure never dispatches. */
export async function projectSubmittedIntake(store:IdentityStore,workspace:string,receipt:IntakeReceipt,
 project:(lead:string,fields:Record<string,string>)=>Promise<boolean>,request?:RequestContext):Promise<boolean>{
 const context=projectionContext(request);
 const synthetic=await store.transaction(async tx=>{
  if(!await isSyntheticIntakeReceipt(tx,workspace,receipt.receiptId,receipt.stableLeadId))return false;
  const roots=await tx.query<{sourceKey:string}>(`SELECT m.source_key AS "sourceKey" FROM ls_intake.pre_enrollment_receipts r
   JOIN ls_demo.records m ON m.workspace_id=r.workspace_id AND m.entity_kind='form' AND m.entity_key=r.invitation_id::text
   WHERE r.workspace_id=$1 AND r.receipt_id=$2`,[workspace,receipt.receiptId]);
  if(roots.length!==1||typeof roots[0]!.sourceKey!=="string"||!roots[0]!.sourceKey.startsWith("intake-fixture:v1:"))throw new AppError("UNAVAILABLE");
  const operationId=roots[0]!.sourceKey.slice("intake-fixture:v1:".length);
  if(!uuid.test(operationId)||!uuid.test(receipt.receiptId)||!uuid.test(workspace))throw new AppError("UNAVAILABLE");
  const id=suppressionEventId(workspace,operationId,receipt.receiptId,context.requestId),action=suppressionAction(operationId,receipt.receiptId);
  await tx.query(`INSERT INTO ls_identity.action_history(id,workspace_id,actor_account_id,request_id,action,occurred_at)
   VALUES($1,$2,NULL,$3,$4,$5) ON CONFLICT(id) DO NOTHING`,[id,workspace,context.requestId,action,context.now]);
  const rows=await tx.query<{id:string;workspaceId:string;actorAccountId:string|null;requestId:string;action:string;fullMatch:boolean}>(`SELECT
   id,workspace_id AS "workspaceId",actor_account_id AS "actorAccountId",request_id AS "requestId",action,
   (id=$1::uuid AND workspace_id=$2::uuid AND actor_account_id IS NULL AND request_id=$3::uuid AND action=$4::text AND occurred_at=$5::timestamptz) AS "fullMatch"
   FROM ls_identity.action_history WHERE id=$1 FOR UPDATE`,[id,workspace,context.requestId,action,context.now]);
  const row=rows[0];
  if(rows.length!==1||row?.fullMatch!==true||row.id!==id||row.workspaceId!==workspace||row.actorAccountId!==null||row.requestId!==context.requestId||row.action!==action)throw new AppError("UNAVAILABLE");
  return true;
 });
 if(synthetic)return false;
 return project(receipt.stableLeadId,{formSubmitted:receipt.receivedAt,stage:"Intake submitted / awaiting payment",
  updateProvenance:"private-app:intake-submitted"});
}
