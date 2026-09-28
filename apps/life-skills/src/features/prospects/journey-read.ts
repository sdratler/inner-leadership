import type {IdentityStore,SqlSession} from "../identity/store.ts";

export type ProspectJourneyState={journeyState:string;paymentVerified:boolean;bookingConfirmed:boolean};

/** Drizzle binds a JavaScript array as a scalar, not a PostgreSQL text[] literal.
 * Pass JSON text and expand it inside PostgreSQL so the existing CRM read remains
 * parameterized without depending on driver-specific array serialization.
 */
export async function readProspectJourneys(store:IdentityStore,workspaceId:string,leadIds:readonly string[]):Promise<Map<string,ProspectJourneyState>>{
 if(!leadIds.length)return new Map();
 return store.transaction(tx=>readProspectJourneysFromTx(tx,workspaceId,leadIds));
}

/** Native directory paging uses one repeatable read snapshot, including journey
 * facts. It must not open a second transaction halfway through that snapshot. */
export async function readProspectJourneysFromTx(tx:SqlSession,workspaceId:string,leadIds:readonly string[]):Promise<Map<string,ProspectJourneyState>>{
 if(!leadIds.length)return new Map();
 if(leadIds.some(id=>typeof id!=="string"))throw new Error("INVALID_CRM_LEAD_IDS");
 const rows=await tx.query<{leadId:string;state:string;paymentVerified:boolean;bookingConfirmed:boolean}>(
  `SELECT j.stable_lead_ref AS "leadId",j.state,
    EXISTS (
      WITH RECURSIVE linked AS (
        SELECT id,status FROM ls_calendar.appointments
        WHERE workspace_id=j.workspace_id AND id=j.confirmed_appointment_id
        UNION
        SELECT replacement.id,replacement.status FROM ls_calendar.appointments replacement
        JOIN linked prior ON replacement.original_id=prior.id
        WHERE replacement.workspace_id=j.workspace_id
      )
      SELECT 1 FROM linked WHERE status IN ('scheduled','completed')
    ) AS "bookingConfirmed",
    EXISTS(SELECT 1 FROM ls_onboarding.payment_allocations a
      WHERE a.workspace_id=j.workspace_id AND a.order_id=j.first_session_order_id
      AND NOT EXISTS(SELECT 1 FROM ls_onboarding.payment_reversals r
        WHERE r.workspace_id=a.workspace_id AND r.provider_account_id=a.provider_account_id AND r.transaction_id=a.transaction_id)) AS "paymentVerified"
    FROM ls_onboarding.prospect_journeys j
    WHERE j.workspace_id=$1 AND j.stable_lead_ref IN (SELECT jsonb_array_elements_text($2::jsonb))`,
  [workspaceId,JSON.stringify(leadIds)]);
 return new Map(rows.map(row=>[row.leadId,{journeyState:row.state,paymentVerified:Boolean(row.paymentVerified),bookingConfirmed:row.bookingConfirmed===true}]));
}
