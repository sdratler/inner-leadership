import { randomUUID } from 'node:crypto';
import { asId } from '../../../src/lib/ids.ts';
import { approvedOffer,POLICY_VERSION,type MerchantBinding } from '../../../src/features/fishing-payments/domain.ts';
import type { ApprovedOffer,FishingPurchaseLine } from '../../../src/features/fishing/contract.ts';
export const merchant:MerchantBinding={accountId:'acct_synthetic_fishing',livemode:false,apiVersion:'synthetic-api-v1',verifiedBindingId:'synthetic-owner-merchant-proof'};
type LegacyOffer=Omit<ApprovedOffer,'lines'>&{lines:readonly Extract<FishingPurchaseLine,{mode:'prepay'|'installments'}>[]};
export function offerFixture(mode:'prepay'|'installments'='prepay',now=Date.now()):LegacyOffer{
 const payer=asId(randomUUID(),'account');const offer=approvedOffer({id:randomUUID(),revision:1,workspaceId:asId(randomUUID(),'workspace'),program:'sunday_fishing_academy',operatorAccountId:asId(randomUUID(),'account'),householdId:randomUUID(),payerAccountId:payer,currency:'USD',policyVersion:POLICY_VERSION,sourceVersion:'synthetic-source-v1',expiresAt:new Date(now+86400000).toISOString(),terms:{version:'synthetic-reviewed-terms',acceptedBy:payer,acceptedAt:new Date(now-3600000).toISOString()},lines:[{id:randomUUID(),learnerId:asId(randomUUID(),'person'),cohortId:randomUUID(),stageId:randomUUID(),stage:1,sessions:12,mode,totalCents:mode==='prepay'?175000:195000,discountBasis:mode==='prepay'?'ordinary_primary_prepay':'three_full_rate_dues',eligibility:{kind:'ordinary',evidenceId:'synthetic-native-evidence',policyVersion:POLICY_VERSION},dues:Array.from({length:mode==='prepay'?1:3},(_,i)=>({id:randomUUID(),index:i+1,dueAt:new Date(now+i*31*86400000).toISOString(),currency:'USD',amountCents:mode==='prepay'?175000:65000,state:'pending',paidCents:0})),capacity:{reservationId:randomUUID(),revision:1,expiresAt:new Date(now+2*86400000).toISOString()}}]});
 return {...offer,lines:offer.lines.map(line=>{if(line.mode==='monthly_block')throw Error('LEGACY_FIXTURE_MODE');return line;})};
}
