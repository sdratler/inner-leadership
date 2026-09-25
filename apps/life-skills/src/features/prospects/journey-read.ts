import type {IdentityStore} from "../identity/store.ts";

export type ProspectJourneyState={journeyState:string;paymentVerified:boolean};

/** Drizzle binds a JavaScript array as a scalar, not a PostgreSQL text[] literal.
 * Pass JSON text and expand it inside PostgreSQL so the existing CRM read remains
 * parameterized without depending on driver-specific array serialization.
 */
export async function readProspectJourneys(store:IdentityStore,workspaceId:string,leadIds:readonly string[]):Promise<Map<string,ProspectJourneyState>>{
 if(!leadIds.length)return new Map();
 if(leadIds.some(id=>typeof id!=="string"))throw new Error("INVALID_CRM_LEAD_IDS");
 const rows=await store.transaction(tx=>tx.query<{leadId:string;state:string;paymentVerified:boolean}>(
  `SELECT j.stable_lead_ref AS "leadId",j.state,
    EXISTS(SELECT 1 FROM ls_onboarding.payment_allocations a
      WHERE a.workspace_id=j.workspace_id AND a.order_id=j.first_session_order_id
      AND NOT EXISTS(SELECT 1 FROM ls_onboarding.payment_reversals r
        WHERE r.workspace_id=a.workspace_id AND r.provider_account_id=a.provider_account_id AND r.transaction_id=a.transaction_id)) AS "paymentVerified"
    FROM ls_onboarding.prospect_journeys j
    WHERE j.workspace_id=$1 AND j.stable_lead_ref IN (SELECT jsonb_array_elements_text($2::jsonb))`,
  [workspaceId,JSON.stringify(leadIds)]));
 return new Map(rows.map(row=>[row.leadId,{journeyState:row.state,paymentVerified:Boolean(row.paymentVerified)}]));
}
