import { parseIdentityConfig } from '../identity/config.ts';
import { tripRuntimeConfig } from './config.ts';
import { currentTripPublicConfig } from './public-photo.ts';
const identityPaths=new Set(['/api/identity/csrf','/api/identity/login','/api/identity/session','/api/identity/logout','/api/identity/logout-all','/api/identity/invites/accept','/api/identity/reset/request','/api/identity/reset/complete']);
export function individualTripReleasePath(path:string,env:Record<string,string|undefined>):boolean{
 const landing=/^\/(en|he)\/florida\/trips\/?$/.exec(path);
 if(landing)return currentTripPublicConfig(landing[1] as 'en'|'he',env)!==null;
 if(!(/^\/(en|he)\/trips(?:\/owner)?\/?$/.test(path)||/^\/api\/individual-trips(?:\/|$)/.test(path)||/^\/(en|he)\/login\/?$/.test(path)||identityPaths.has(path)))return false;
 try{tripRuntimeConfig(env,parseIdentityConfig(env));return true;}catch{return false;}
}
export function individualTripPublicAsset(path:string,method:string,env:Record<string,string|undefined>):boolean{
 if(method!=='GET'&&method!=='HEAD')return false;
 const current=currentTripPublicConfig('en',env);
 return current!==null&&new URL(current.photo.src).pathname===path;
}
