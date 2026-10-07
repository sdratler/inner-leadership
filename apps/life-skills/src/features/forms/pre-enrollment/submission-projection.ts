import "server-only";
import type {IdentityStore} from "../../identity/store.ts";
import type {IntakeReceipt} from "./service.ts";
import {isSyntheticIntakeReceipt} from "./synthetic-fixture.ts";

/** No browser flag, name or lead prefix can select suppression. Failure never dispatches. */
export async function projectSubmittedIntake(store:IdentityStore,workspace:string,receipt:IntakeReceipt,
 project:(lead:string,fields:Record<string,string>)=>Promise<boolean>):Promise<boolean>{
 const synthetic=await store.transaction(tx=>isSyntheticIntakeReceipt(tx,workspace,receipt.receiptId,receipt.stableLeadId));
 if(synthetic)return false;
 return project(receipt.stableLeadId,{formSubmitted:receipt.receivedAt,stage:"Intake submitted / awaiting payment",
  updateProvenance:"private-app:intake-submitted"});
}
