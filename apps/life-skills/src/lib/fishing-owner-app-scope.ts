import {z} from 'zod';
import {AppError} from './errors.ts';
import {configuredFishingOwnerBinding,type FishingOwnerEnvironment} from './fishing-owner-binding.ts';

export const FISHING_OWNER_APP_SCOPE_V1='JLFA-FISHING-OWNER-APP-SCOPE-v1' as const;
const id=z.uuid().refine(v=>v===v.toLowerCase());
const selected=z.object({version:z.literal(FISHING_OWNER_APP_SCOPE_V1),workspaceId:id,ownerAccountId:id}).strict();
/** Explicit trusted server selection, never a role, title, host guess or
 * browser query. Absent means this NEW integration is not selected. Once
 * selected, malformed/mismatched scope fails closed, without legacy fallback.
 * Parsing config does not initialize/cut over a CRM or authorize deployment. */
export function configuredFishingOwnerAppScope(workspaceId:string,env:FishingOwnerEnvironment){
 const raw=env.LS_FISHING_OWNER_APP_SCOPE_JSON;if(raw===undefined)return null;
 try{const scope=selected.parse(JSON.parse(raw)),binding=configuredFishingOwnerBinding(workspaceId,env);
  if(scope.workspaceId!==binding.workspaceId||scope.ownerAccountId!==binding.accountId)throw new Error();
  return Object.freeze({version:FISHING_OWNER_APP_SCOPE_V1,kind:'fishing_owner' as const,binding});
 }catch{throw new AppError('UNAVAILABLE');}
}
export type FishingOwnerAppScope=NonNullable<ReturnType<typeof configuredFishingOwnerAppScope>>;
const read=new Set(['GET','HEAD']);
const pages=new Set(['group-applications','clients','prospects','fishing-groups','marketing','settings']);
const apiMethods:Readonly<Record<string,readonly string[]>>=Object.freeze({
 '/api/private/group-applications':['GET','HEAD','POST'],
 '/api/private/people':['GET','HEAD'],
 '/api/prospects':['GET','HEAD','POST'],
 '/api/private/contact-profiles':['GET','HEAD','POST'],
 '/api/private/contact-lead-command':['POST'],
 '/api/private/contact-acquisition':['GET','HEAD','POST'],
 '/api/private/contact-inbound':['GET','HEAD','POST'],
 '/api/private/whatsapp-group-roster':['GET','HEAD'],
 '/api/private/fishing-group-preparations':['GET','HEAD','POST'],
 '/api/private/fishing-inquiry-family-proposals':['GET','HEAD','POST'],
 '/api/private/fishing-program-sources':['GET','HEAD','POST'],
 '/api/private/fishing-marketing':['GET','HEAD','POST'],
});
const identityMethods:Readonly<Record<string,readonly string[]>>=Object.freeze({
 '/api/identity/csrf':['GET'],
 '/api/identity/login':['POST'],
 '/api/identity/reset/request':['POST'],
 '/api/identity/reset/complete':['POST'],
 '/api/identity/email/confirm':['POST'],
 '/api/identity/session':['GET'],
 '/api/identity/logout':['POST'],
 '/api/identity/logout-all':['POST'],
 '/api/identity/contacts':['GET'],
 '/api/identity/contacts/email':['POST'],
 '/api/identity/contacts/phone':['PUT'],
});
/** Purpose-specific owner credential maintenance; never invites, clinical
 * preferences, cases, guardian/account administration or learner accounts. */
export function fishingOwnerIdentityRoute(pathname:string,method:string):boolean{
 return identityMethods[pathname]?.includes(method)===true;
}
/** Called ONLY for a path already classified as private by the existing
 * perimeter. Public inquiry/confirmation/guest/provider purposes keep their
 * separate guards. An allowed path still needs fresh owner/session, CSRF,
 * native business/source and action-specific authorization in its handler. */
export function fishingOwnerPrivateRoute(pathname:string,method:string):
 {kind:'allow'}|{kind:'deny'}|{kind:'redirect';pathname:string}{
 if(pathname.includes('?')||pathname.includes('#')||pathname.includes('%')||pathname.includes('\\'))return {kind:'deny'};
 const page=/^\/(en|he)(?:\/(.*?))?\/?$/.exec(pathname);
 if(page&&read.has(method)){
  const locale=page[1]!,path=(page[2]??'').replace(/\/$/,'');
  if(path===''||path==='app'||path==='app/calendar')return {kind:'redirect',pathname:`/${locale}/app/group-applications`};
  if(path==='login')return {kind:'allow'};
  if(path.startsWith('app/')&&pages.has(path.slice(4)))return {kind:'allow'};
 }
 if(apiMethods[pathname]?.includes(method)||fishingOwnerIdentityRoute(pathname,method))return {kind:'allow'};
 // Future guest/financial/service endpoints are not enabled by a broad prefix.
 return {kind:'deny'};
}
