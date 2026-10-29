import "server-only";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import type {WorkspaceId} from "../../lib/ids.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import type {IdentityStore} from "../identity/store.ts";
import {systemClock,type Actor,type IdentityClock} from "../identity/types.ts";
import {privateDigest} from "../contact-ops/server/digests.ts";
import {fishingMarketingSnapshotSchema,type FishingMarketingSnapshot} from "./contract.ts";
type Row={generatedAt:Date;receivedAt:Date;payloadDigest:string;payloadCiphertext:string;ownerId:string};
const aad=(workspace:string)=>`ls_service_interest/fishing-marketing-snapshot/v1/${workspace}`;
/** Latest encrypted projection. The scheduler remains the source for delivery history. */
export class FishingMarketingStore {
 constructor(private readonly db:IdentityStore,private readonly workspace:WorkspaceId,private readonly ring:Keyring,
  private readonly digestKey:string,private readonly ownerId:string,private readonly clock:IdentityClock=systemClock){
  if(!z.string().uuid().safeParse(ownerId).success)throw new AppError("UNAVAILABLE");
 }
 private digest(snapshot:FishingMarketingSnapshot){return privateDigest({domain:"fishing-marketing-snapshot/v1",workspace:this.workspace,snapshot},this.digestKey);}
 async save(input:unknown){const parsed=fishingMarketingSnapshotSchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const snapshot=parsed.data,generated=new Date(snapshot.generatedAt),now=this.clock.now();
  if(generated.getTime()>now.getTime()+300_000)throw new AppError("INVALID_REQUEST");
  const digest=this.digest(snapshot),cipher=seal(JSON.stringify(snapshot),aad(this.workspace),this.ring);
  return this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);
   const owner=await tx.query<{id:string}>("SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active'",[this.workspace,this.ownerId]);
   if(owner.length!==1)throw new AppError("UNAVAILABLE");
   const existing=await tx.query<Row>(`SELECT generated_at AS "generatedAt",received_at AS "receivedAt",payload_digest AS "payloadDigest",payload_ciphertext AS "payloadCiphertext",owner_account_id AS "ownerId" FROM ls_service_interest.fishing_marketing_snapshot WHERE workspace_id=$1`,[this.workspace]);
   if(existing.length){const old=existing[0]!;if(old.ownerId!==this.ownerId)throw new AppError("FORBIDDEN");
    if(generated.getTime()<old.generatedAt.getTime())throw new AppError("CONFLICT");
    if(generated.getTime()===old.generatedAt.getTime()){
     if(digest!==old.payloadDigest)throw new AppError("CONFLICT");
     return {replayed:true,receivedAt:old.receivedAt.toISOString()};
    }}
   const rows=await tx.query<{receivedAt:Date}>(`INSERT INTO ls_service_interest.fishing_marketing_snapshot(workspace_id,owner_account_id,generated_at,payload_digest,payload_ciphertext)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id) DO UPDATE SET owner_account_id=EXCLUDED.owner_account_id,generated_at=EXCLUDED.generated_at,payload_digest=EXCLUDED.payload_digest,payload_ciphertext=EXCLUDED.payload_ciphertext,received_at=clock_timestamp() RETURNING received_at AS "receivedAt"`,[this.workspace,this.ownerId,generated,digest,cipher]);
   return {replayed:false,receivedAt:rows[0]!.receivedAt.toISOString()};});
 }
 async read(actor:Actor){if(actor.workspaceId!==this.workspace||actor.id!==this.ownerId)throw new AppError("NOT_FOUND");
  return this.db.transaction(async tx=>{await tx.query("SET TRANSACTION READ ONLY");const current=await freshActor(tx,actor,this.clock.now());
   if(current.role!=="practitioner"||current.state!=="active")throw new AppError("NOT_FOUND");
   const rows=await tx.query<Row>(`SELECT generated_at AS "generatedAt",received_at AS "receivedAt",payload_digest AS "payloadDigest",payload_ciphertext AS "payloadCiphertext",owner_account_id AS "ownerId" FROM ls_service_interest.fishing_marketing_snapshot WHERE workspace_id=$1`,[this.workspace]);
   if(!rows.length)return null;const row=rows[0]!;
   try{const snapshot=fishingMarketingSnapshotSchema.parse(JSON.parse(unseal(row.payloadCiphertext,aad(this.workspace),this.ring)));
    if(row.ownerId!==this.ownerId||this.digest(snapshot)!==row.payloadDigest||new Date(snapshot.generatedAt).getTime()!==row.generatedAt.getTime())throw Error();
    return {snapshot,receivedAt:row.receivedAt.toISOString()};
   }catch{throw new AppError("UNAVAILABLE");}});
 }
}
