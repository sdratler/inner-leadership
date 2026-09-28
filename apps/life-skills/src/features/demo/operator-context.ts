import {AppError} from '../../lib/errors.ts';
import {accountById} from '../identity/data.ts';
import {one,type SqlSession} from '../identity/store.ts';
import type {AccountId,CaseId,WorkspaceId} from '../identity/types.ts';
import {requirePractitioner} from '../cases/policy.ts';

/** Internal one-shot capability, never an HTTP principal or a forged session.
 * Recheck the real practitioner and immutable DEMO ancestry before every write
 * and replay. A DEMO display name, client-supplied marker or mailbox is no proof.
 */
export async function demoOperatorContext(tx:SqlSession,workspace:WorkspaceId,practitionerId:AccountId,
 caseId:CaseId,batchId:string,permission:boolean){
 if(permission!==true)throw new AppError('FORBIDDEN');
 if(!/^ls-owner-[0-9]{8}$/.test(batchId))throw new AppError('INVALID_REQUEST');
 const account=await accountById(tx,workspace,practitionerId);
 if(!account||account.state!=='active'||!account.emailVerifiedAt)throw new AppError('FORBIDDEN');
 requirePractitioner(account);
 if(await one(tx,'SELECT account_id FROM ls_demo.accounts WHERE workspace_id=$1 AND account_id=$2',[workspace,practitionerId]))throw new AppError('FORBIDDEN');
 const item=await one<{state:string;matched:boolean}>(tx,`SELECT c.state,
  (c.demo_batch_id=$4 AND d.batch_id=$4 AND b.created_by=$2 AND c.practitioner_account_id=$2
   AND EXISTS(SELECT 1 FROM ls_demo.records r WHERE r.workspace_id=c.workspace_id AND r.batch_id=$4 AND r.case_id=c.id AND r.entity_kind='person' AND r.entity_key=cl.person_id::text)
   AND EXISTS(SELECT 1 FROM ls_demo.records r WHERE r.workspace_id=c.workspace_id AND r.batch_id=$4 AND r.case_id=c.id AND r.entity_kind='client' AND r.entity_key=cl.id::text)
   AND EXISTS(SELECT 1 FROM ls_demo.records r WHERE r.workspace_id=c.workspace_id AND r.batch_id=$4 AND r.case_id=c.id AND r.entity_kind='family' AND r.entity_key=c.family_id::text)) AS matched
  FROM ls_cases.cases c JOIN ls_demo.cases d ON d.workspace_id=c.workspace_id AND d.case_id=c.id
  JOIN ls_demo.batches b ON b.workspace_id=d.workspace_id AND b.batch_id=d.batch_id
  JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id
  WHERE c.workspace_id=$1 AND c.id=$3`,[workspace,practitionerId,caseId,batchId]);
 if(!item?.matched)throw new AppError('NOT_FOUND');
 if(!['invited','intake','active'].includes(item.state))throw new AppError('CONFLICT');
 return account;
}
