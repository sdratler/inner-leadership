import {
 BILLING_DTO_VERSION,reminderPolicySchema,reminderIntentSchema,billingInstant,
 type BillingBalance,type ReminderIntent,type ReminderPolicy,
} from './contracts.ts';
import {requireBilling} from './domain.ts';

export type ReminderAudience={
 guardianId:string;channel:'email'|'whatsapp';audience:'individual';locale:'en'|'he';
 verified:boolean;consented:boolean;active:boolean;
};
/** Integrator supplies current consent/access/window/approval in the SAME native
 * transaction. Missing observance/window dependencies must return false. */
export type DispatchPermission={
 audience:ReminderAudience;sendWindowOpen:boolean;ownerEnabled:boolean;policyCurrent:boolean;
};
function instantKey(value:string):string{
 requireBilling(billingInstant.safeParse(value).success&&Number.isFinite(Date.parse(value)));
 return new Date(Date.parse(value)).toISOString();
}
export function reminderSuppression(balance:BillingBalance,permission:DispatchPermission):string|null{
 if(balance.missingPolicy.length)return 'policy_not_ready';
 if(balance.cancelled)return 'cancelled';
 if(balance.paused||!permission.ownerEnabled)return 'owner_paused';
 if(balance.state==='no_debt')return 'no_obligation';
 if(balance.remainingMinor===0)return 'paid';
 if(balance.state==='review_required'||balance.excessMinor>0)return 'financial_review';
 const a=permission.audience;
 if(a.audience!=='individual'||a.active!==true||a.verified!==true||a.consented!==true)return 'audience_not_permitted';
 if(!permission.policyCurrent)return 'policy_changed';
 if(!permission.sendWindowOpen)return 'send_window_closed';
 return null;
}
/** A family-level intent groups only this family's lines at the same approved
 * due instant. No defaults for due dates/offsets and no transport or group send. */
export function planPaymentReminders(input:{
 balance:BillingBalance;policy:ReminderPolicy;audience:ReminderAudience;newId:()=>string;
}):ReminderIntent[]{
 const p=reminderPolicySchema.parse(input.policy),b=input.balance,a=input.audience;
 if(reminderSuppression(b,{audience:a,ownerEnabled:true,sendWindowOpen:true,policyCurrent:true}))return [];
 const dueDates=[...new Set(b.lines.filter(l=>l.remainingMinor>0).map(l=>{
  requireBilling(l.dueAt!==null);return instantKey(l.dueAt!);
 }))];
 const intents:ReminderIntent[]=[];
 for(const dueAt of dueDates){
  for(let sequence=0;sequence<p.offsetsMinutes.length;sequence++){
   const scheduledAt=new Date(Date.parse(dueAt)+p.offsetsMinutes[sequence]!*60000).toISOString();
   const key=[BILLING_DTO_VERSION,b.quoteId,a.guardianId,a.channel,p.id,p.revision,dueAt,sequence].join('|');
   intents.push(reminderIntentSchema.parse({
    version:BILLING_DTO_VERSION,id:input.newId(),key,quoteId:b.quoteId,familyId:b.familyId,
    guardianId:a.guardianId,channel:a.channel,audience:'individual',locale:a.locale,
    policyId:p.id,policyRevision:p.revision,sequence,dueAt,scheduledAt,state:'queued',dispatchId:null,providerId:null,reason:null,
   }));
  }
 }
 return intents;
}
export function checkReminderDispatch(intent:ReminderIntent,balance:BillingBalance,permission:DispatchPermission,now:string){
 const i=reminderIntentSchema.parse(intent);
 const observedAt=instantKey(now);
 requireBilling(i.quoteId===balance.quoteId&&i.familyId===balance.familyId,'FORBIDDEN');
 requireBilling(i.guardianId===permission.audience.guardianId&&i.channel===permission.audience.channel&&
  i.locale===permission.audience.locale&&permission.audience.audience==='individual','FORBIDDEN');
 if(i.state!=='queued')return {eligible:false as const,reason:'already_reserved'};
 if(Date.parse(i.scheduledAt)>Date.parse(observedAt))return {eligible:false as const,reason:'not_due'};
 const suppression=reminderSuppression(balance,permission);
 if(suppression)return {eligible:false as const,reason:suppression};
 const dueKey=instantKey(i.dueAt);
 const lines=balance.lines.filter(l=>l.dueAt!==null&&instantKey(l.dueAt)===dueKey&&l.remainingMinor>0);
 if(!lines.length)return {eligible:false as const,reason:'obsolete_due_date'};
 return {eligible:true as const,lines,remainingMinor:lines.reduce((s,l)=>s+l.remainingMinor,0)};
}
