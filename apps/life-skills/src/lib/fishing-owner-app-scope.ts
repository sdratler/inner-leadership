import 'server-only';
import {z} from 'zod';
import {AppError} from './errors.ts';
import {configuredFishingOwnerBinding,type FishingOwnerEnvironment} from './fishing-owner-boundary.ts';

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
 if(apiMethods[pathname]?.includes(method))return {kind:'allow'};
 // Identity endpoints and future guest/financial/service endpoints are NOT
 // enabled by a broad prefix. Their exact purpose/adapters must be integrated
 // and reviewed separately before this currently unmounted policy is enabled.
 return {kind:'deny'};
}
