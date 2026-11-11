import 'server-only';
import {AppError} from '../../lib/errors.ts';
import type {WorkspaceId} from '../identity/types.ts';
import type {BillingLedgerContext} from './native.ts';
import type {BillingStripeBinding} from './card-binding.ts';
import {requireBilling} from './domain.ts';

export type NativeCardServiceAuthorityV4<Scope>={
 target(context:Readonly<BillingLedgerContext>,binding:Readonly<BillingStripeBinding>):Promise<void>;
 authorize(context:Readonly<BillingLedgerContext>,binding:Readonly<BillingStripeBinding>,scope:Scope):Promise<void>;
};
function freezeScope<T>(v:T):T{if(v&&typeof v==='object'){for(const x of Object.values(v))freezeScope(x);Object.freeze(v);}return v;}
/** Shared borrowed native permission lifetime only. The constructor-owned
 * purpose-specific native authority supplies the actual decision and locks;
 * this helper grants no service, reservation or SDK permission of its own. */
export async function guardedCardServicePermissionV4<Scope>(c:Readonly<BillingLedgerContext>,workspaceId:WorkspaceId,rawBinding:Readonly<BillingStripeBinding>,authority:NativeCardServiceAuthorityV4<Scope>|null,scope:Scope|null){
 if(!authority)throw new AppError('UNAVAILABLE');const physical=c.tx,original=physical.query,query=original.bind(physical),time=c.now,at=time.valueOf();let active=true,failed=false;
 const pending=new Set<Promise<unknown>>(),guard=()=>requireBilling(active&&c.workspaceId===workspaceId&&c.tx===physical&&physical.query===original&&c.now===time&&time.valueOf()===at&&view.now.valueOf()===at,'UNAVAILABLE');
 const tx=Object.freeze({query:<R extends object>(sql:string,v:readonly unknown[]=[])=>{const p=(async()=>{guard();const rows=await query<R>(sql,v);guard();return rows;})().catch(error=>{failed=true;throw error;});pending.add(p);void p.then(()=>pending.delete(p),()=>pending.delete(p));return p;}});
 const view=Object.freeze({workspaceId,tx,now:new Date(at)}),binding=Object.freeze({...rawBinding});
 try{
  guard();await authority.target(view,binding);guard();
  if(scope)await authority.authorize(view,binding,freezeScope(structuredClone(scope)));
  guard();requireBilling(!failed&&pending.size===0,'UNAVAILABLE');
 }finally{active=false;if(pending.size)await Promise.allSettled([...pending]);}
}
