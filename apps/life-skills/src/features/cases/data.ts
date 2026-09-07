import { one } from "../identity/store.ts";
import type { SqlSession } from "../identity/store.ts";
import type { CaseId,WorkspaceId,AudienceId } from "../identity/types.ts";
import type { CaseFacts, GuardianFacts, AudienceFacts } from "./policy.ts";
export const CASE_SELECT=`SELECT c.id,c.workspace_id AS "workspaceId",cl.person_id AS "clientPersonId",c.practitioner_account_id AS "practitionerAccountId",
 p.kind,c.state FROM ls_cases.cases c JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id
 JOIN ls_identity.people p ON p.workspace_id=cl.workspace_id AND p.id=cl.person_id`;
export function loadCase(tx:SqlSession,workspace:WorkspaceId,id:CaseId):Promise<CaseFacts|null> {
 return one<CaseFacts>(tx,CASE_SELECT+" WHERE c.workspace_id=$1 AND c.id=$2",[workspace,id]);
}
export function loadGuardians(tx:SqlSession,workspace:WorkspaceId,id:CaseId):Promise<GuardianFacts[]> {
 return tx.query<GuardianFacts>("SELECT workspace_id AS \"workspaceId\",case_id AS \"caseId\",account_id AS \"accountId\",(revoked_at IS NOT NULL) AS revoked FROM ls_cases.case_guardians WHERE workspace_id=$1 AND case_id=$2",[workspace,id]);
}
export async function loadAudience(tx:SqlSession,workspace:WorkspaceId,caseId:CaseId,id:AudienceId):Promise<AudienceFacts|null> {
 const item=await one<Omit<AudienceFacts,'accountIds'>>(tx,"SELECT id,workspace_id AS \"workspaceId\",case_id AS \"caseId\",visibility,published FROM ls_cases.audiences WHERE workspace_id=$1 AND case_id=$2 AND id=$3",[workspace,caseId,id]);
 if (!item) return null;
 const grants=await tx.query<{accountId:AudienceFacts['accountIds'][number]}>("SELECT account_id AS \"accountId\" FROM ls_cases.audience_accounts WHERE workspace_id=$1 AND case_id=$2 AND audience_id=$3 AND revoked_at IS NULL ORDER BY account_id",[workspace,caseId,id]);
 return {...item,accountIds:grants.map(x=>x.accountId)};
}
