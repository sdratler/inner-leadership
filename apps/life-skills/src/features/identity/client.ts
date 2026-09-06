/** Browser bridge only. No credential or session is persisted in local/session storage. */
export type IdentityClientErrorCode='INVALID_REQUEST'|'UNAUTHENTICATED'|'FORBIDDEN'|'NOT_FOUND'|'CONFLICT'|'RATE_LIMITED'|'UNAVAILABLE'|'INTERNAL';
export class IdentityClientError extends Error {
 constructor(readonly code:IdentityClientErrorCode){super(code);this.name='IdentityClientError';}
}
export type AuthTokenMode='invite'|'reset'|'verify-email';
export function takeAuthTokenFragment(location:Pick<Location,'hash'|'pathname'>,history:Pick<History,'replaceState'>):string|null {
 // Call before analytics or any third-party script. Auth pages must contain neither.
 const raw=location.hash;history.replaceState(null,'',location.pathname);
 if(raw.length>100) return null;
 const values=new URLSearchParams(raw.startsWith('#')?raw.slice(1):raw);
 if([...values.keys()].length!==1 || !values.has('token')) return null;
 const token=values.get('token');return token && /^[A-Za-z0-9_-]{43}$/.test(token)?token:null;
}
async function request<T>(path:string,init:RequestInit):Promise<T>{
 let response:Response;
 try{response=await fetch(path,{...init,credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});}catch{throw new IdentityClientError('UNAVAILABLE');}
 let body:unknown;try{body=await response.json();}catch{throw new IdentityClientError('UNAVAILABLE');}
 if(!body || typeof body!=='object' || !('ok' in body)) throw new IdentityClientError('UNAVAILABLE');
 if(body.ok===true && response.ok && 'data' in body) return body.data as T;
 const value=body as {error?:{code?:unknown}};const codes=['INVALID_REQUEST','UNAUTHENTICATED','FORBIDDEN','NOT_FOUND','CONFLICT','RATE_LIMITED','UNAVAILABLE','INTERNAL'];
 throw new IdentityClientError(codes.includes(String(value.error?.code)) ? value.error!.code as IdentityClientErrorCode:'INTERNAL');
}
export async function publicAuthAction<T>(action:'login'|'reset/request'|'reset/complete'|'invites/accept'|'email/confirm',body:unknown):Promise<T>{
 const csrf=await request<{csrfToken:string}>('/api/identity/csrf',{method:'GET'});
 return request<T>('/api/identity/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf.csrfToken},body:JSON.stringify(body)});
}
export async function sessionInfo(){return request<{accountId:string;role:'practitioner'|'parent'|'adult_client';locale:'en'|'he';expiresAt:string;csrfToken:string}>('/api/identity/session',{method:'GET'});}
export async function accountAction<T>(action:'logout'|'logout-all'|'preferences'|'contacts/email'|'contacts/phone'|'cases'|'cases/state'|'invites/parent'|'invites/adult'|'guardians/revoke'|'accounts/revoke'|'engagements'|'audiences',method:'POST'|'PUT'|'PATCH',body:unknown):Promise<T>{
 const session=await sessionInfo();return request<T>('/api/identity/'+action,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify(body)});
}
export async function accountRead<T>(resource:'contacts'|'preferences'|'cases'):Promise<T>{return request<T>('/api/identity/'+resource,{method:'GET'});}
