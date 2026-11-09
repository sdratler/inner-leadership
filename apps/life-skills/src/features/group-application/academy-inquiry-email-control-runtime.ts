import 'server-only';
import type {IdentityStore} from '../identity/store.ts';
import type {IdentityClock,WorkspaceId} from '../identity/types.ts';
import type {Keyring} from '../identity/crypto.ts';
import {InquiryEmailControlVerification} from './academy-inquiry-email-verification.ts';
import {InquiryEmailControlOutbox} from './academy-inquiry-email-control-outbox.ts';
import {inquiryEmailControlSecurityLifetimeMs} from './academy-inquiry-email-control-admission.ts';

type Runtime={store:IdentityStore;clock:IdentityClock;config:{workspaceId:WorkspaceId;keyring:Keyring;lookupKey:Buffer}};
/** Construction is not send permission. The dedicated outbox revalidates its
 * exact source/target/population/payload admission before any provider call. */
export function inquiryEmailControlRuntime(r:Runtime,env:Readonly<Record<string,string|undefined>>){
 if(env.LS_ACADEMY_INQUIRY_EMAIL_CONTROL_ENABLED!=='true')return null;
 const securityLifetimeMs=inquiryEmailControlSecurityLifetimeMs(env);if(securityLifetimeMs===null)return null;
 const verification=new InquiryEmailControlVerification(r.store,{workspaceId:r.config.workspaceId,keyring:r.config.keyring,lookupKey:r.config.lookupKey,requestDigestKey:r.config.lookupKey.toString('hex'),securityLifetimeMs},r.clock);
 const outbox=new InquiryEmailControlOutbox({store:r.store,workspaceId:r.config.workspaceId,keyring:r.config.keyring,requestDigestKey:r.config.lookupKey.toString('hex'),clock:r.clock,verification});
 return {verification,outbox};
}
export const publicInquiryEmailState=(state:'held'|'queued'|'unknown'|'sent')=>state==='held'?'not_requested' as const:state;
