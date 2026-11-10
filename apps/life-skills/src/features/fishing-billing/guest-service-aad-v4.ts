import 'server-only';
import {billingId} from './contracts.ts';
/** Explicit V4 only. Consumers select the authenticated row's exact purpose
 * and material_version before decrypting. Never try V3 as a decoder fallback. */
export function serviceGuestAadV4(kind:'quote'|'operation'|'financial_acceptance'|'grant'|'owner_issue'|'owner_money',workspace:string,id:string){
 billingId.parse(workspace);billingId.parse(id);
 return kind==='grant'?`ls_fishing_billing/guest_grant/v4/${workspace}/${id}`:`ls_fishing_billing/guest/v4/${kind}/${workspace}/${id}`;
}
