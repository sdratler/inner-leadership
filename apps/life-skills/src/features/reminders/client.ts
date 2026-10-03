import {z} from 'zod';
import {IdentityClientError,sessionInfo} from '../identity/client.ts';
import type {ReminderItem,ReminderPage} from './service.ts';
const instant=z.string().max(40).refine(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value);
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value);
const timezone=z.string().min(1).max(80).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}});
const item=z.object({id:z.string().uuid(),caseId:z.string().uuid(),occursOn:day,dueAt:instant,timezone,
 channel:z.enum(['in_app','email','push','whatsapp']),purpose:z.enum(['self','support','remind_child']),state:z.enum(['available','blocked']),
 reason:z.enum(['provider_not_configured','channel_not_verified','do_not_disturb','opted_out','completed','cancelled','stale_source','revoked','inactive','expired','demo_external_denied']).nullable(),readAt:instant.nullable()}).strict()
 .refine(row=>row.state==='available'?row.channel==='in_app'&&row.reason===null:row.channel!=='in_app'&&row.reason!==null)
 .refine(row=>row.readAt===null||row.channel==='in_app');
const page=z.object({items:z.array(item).max(40),nextCursor:z.string().regex(/^[A-Za-z0-9_-]{1,160}$/).nullable(),morePending:z.boolean(),externalDeliveryActive:z.literal(false)}).strict()
 .refine(data=>new Set(data.items.map(row=>row.id)).size===data.items.length);
const read=z.object({id:z.string().uuid(),readAt:instant}).strict();
/** No browser storage, alternate auth or optimistic delivery acknowledgement. */
async function request(path:string,init:RequestInit):Promise<unknown>{
 let response:Response,body:unknown;
 try{response=await fetch(path,{...init,credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});body=await response.json();}catch{throw new IdentityClientError('UNAVAILABLE');}
 if(!body||typeof body!=='object')throw new IdentityClientError('UNAVAILABLE');
 const value=body as {ok?:unknown;data?:unknown;error?:{code?:unknown}};
 if(response.ok&&value.ok===true&&Object.hasOwn(value,'data'))return value.data;
 const codes=['INVALID_REQUEST','UNAUTHENTICATED','FORBIDDEN','NOT_FOUND','CONFLICT','RATE_LIMITED','UNAVAILABLE','INTERNAL'];
 throw new IdentityClientError(codes.includes(String(value.error?.code))?value.error!.code as IdentityClientError['code']:'UNAVAILABLE');
}
export async function readReminders(cursor:string|null=null):Promise<ReminderPage>{
 if(cursor!==null&&!/^[A-Za-z0-9_-]{1,160}$/.test(cursor))throw new IdentityClientError('INVALID_REQUEST');
 const parsed=page.safeParse(await request('/api/notifications'+(cursor===null?'':'?'+new URLSearchParams({cursor})),{method:'GET'}));
 if(!parsed.success)throw new IdentityClientError('UNAVAILABLE');return parsed.data as ReminderPage;
}
export async function markReminderRead(id:string):Promise<{id:string;readAt:string}>{
 if(!z.string().uuid().safeParse(id).success)throw new IdentityClientError('INVALID_REQUEST');
 const session=await sessionInfo(),parsed=read.safeParse(await request(`/api/notifications/${id}/read`,{method:'PATCH',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:'{}'}));
 if(!parsed.success||parsed.data.id!==id)throw new IdentityClientError('UNAVAILABLE');return parsed.data;
}
export function reminderWasRead(items:readonly ReminderItem[],id:string,expectedAt?:string):boolean{
 const found=items.find(row=>row.id===id);return !!found&&found.channel==='in_app'&&found.state==='available'&&found.readAt!==null&&(expectedAt===undefined||found.readAt===expectedAt);
}
