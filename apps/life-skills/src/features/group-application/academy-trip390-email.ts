import {createHash} from 'node:crypto';
import {z} from 'zod';
import copy from './academy-trip390-email-copy.json' with {type:'json'};

export const TRIP390_EMAIL_VERSION='JLFA-TRIP390-TRANSACTIONAL-20261104-02-v1' as const;
export const TRIP390_EMAIL_PURPOSES=Object.freeze({ack:'trip390_reservation_acknowledgment',group_ready:'trip390_group_ready_announcement'} as const);
const uuid=z.string().uuid();
const clean=(max:number)=>z.string().trim().min(1).max(max).refine(s=>!/[\p{Cc}\p{Cf}]/u.test(s));
const instant=z.string().datetime({offset:true});
const children=z.array(z.object({id:uuid,name:clean(100)}).strict()).min(1).max(10).refine(v=>new Set(v.map(c=>c.id)).size===v.length);
const base={version:z.literal(TRIP390_EMAIL_VERSION),reference:uuid,parentName:clean(100),children,messageLanguage:z.enum(['en','he'])};
const lesson=z.object({startsAt:instant,address:clean(240)}).strict();
const group=z.object({id:uuid,revision:z.number().int().positive(),ownerConfirmed:z.literal(true),area:clean(120),lessonOne:lesson,lessonTwo:lesson,
 trip:z.object({pickupAt:instant,pickupAddress:clean(240),returnAt:instant,returnAddress:clean(240)}).strict()}).strict();
const completion=z.object({url:z.string().max(2048),contextId:uuid,purpose:z.literal('trip390_completion'),familyId:uuid,groupId:uuid,groupRevision:z.number().int().positive(),childIds:z.array(uuid).min(1).max(10)}).strict();
const inputSchema=z.discriminatedUnion('kind',[
 z.object({...base,kind:z.literal('ack')}).strict(),
 z.object({...base,kind:z.literal('group_ready'),familyId:uuid,group,completion}).strict(),
]);
export type Trip390EmailInput=z.infer<typeof inputSchema>;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const trip390EmailCopySha256=digest(copy);
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const fill=(s:string,values:Record<string,string>)=>s.replace(/\{([a-z]+)\}/g,(_,key:string)=>{if(!(key in values))throw Error('MISSING_TRIP390_EMAIL_VALUE');return values[key]!;});
// Greeting convention only: first display token, never identity or a saved-name rewrite.
const greetingName=(display:string)=>display.trim().split(/\s+/u)[0]!;
const origins=new Set(['https://bneineviimacademy.org','https://life-skills.bneineviimacademy.org']);
function link(value:string){
 const u=new URL(value);
 if(u.protocol!=='https:'||!origins.has(u.origin)||u.username||u.password||u.search||u.pathname==='/'||!/^\/[a-z0-9/_-]+$/i.test(u.pathname)||!/^#[A-Za-z0-9_-]{32,512}$/.test(u.hash))throw Error('INVALID_TRIP390_COMPLETION_LINK');
 return u.href;
}

/** Pure content projection, not proof of group approval/token validity. Caller
 * must supply freshly authorized durable facts and an existing issued scoped
 * completion capability. This module neither mints a link nor queues/sends. */
export function trip390EmailContent(raw:unknown){
 const p=inputSchema.parse(raw);if(copy.version!==TRIP390_EMAIL_VERSION)throw Error('TRIP390_EMAIL_VERSION_MISMATCH');
 const t=copy.locales[p.messageLanguage],plural=p.children.length>1;
 const values={parent:greetingName(p.parentName),children:new Intl.ListFormat(p.messageLanguage,{style:'long',type:'conjunction'}).format(p.children.map(c=>greetingName(c.name)))};
 const paragraphs=[fill(t.greeting,values)];let subject:string;let action:{label:string;url:string;index:number}|null=null;
 if(p.kind==='ack'){
  subject=t.ack.subject;
  paragraphs.push(fill(plural?t.ack.openingPlural:t.ack.opening,values),t.ack.groups,t.ack.next,t.ack.package,plural?t.ack.paymentPlural:t.ack.payment,t.ack.closing,t.ack.signature);
 }else{
  const {group:g,completion:c}=p;
  const ids=p.children.map(v=>v.id);
  if(c.familyId!==p.familyId||c.groupId!==g.id||c.groupRevision!==g.revision||c.childIds.length!==ids.length||new Set(c.childIds).size!==ids.length||!ids.every(id=>c.childIds.includes(id)))throw Error('TRIP390_COMPLETION_SCOPE_MISMATCH');
  const times=[g.lessonOne.startsAt,g.lessonTwo.startsAt,g.trip.pickupAt,g.trip.returnAt].map(Date.parse);
  if(times.some((v,i)=>i>0&&v<=times[i-1]!))throw Error('TRIP390_GROUP_CHRONOLOGY');
  const weekday=new Intl.DateTimeFormat('en-US',{weekday:'long',timeZone:'America/New_York'});
  if([g.lessonOne.startsAt,g.lessonTwo.startsAt].some(value=>weekday.format(new Date(value))!=='Sunday'))throw Error('TRIP390_SUNDAY_LESSONS_REQUIRED');
  const date=(s:string)=>new Intl.DateTimeFormat(p.messageLanguage==='he'?'he-IL':'en-US',{dateStyle:'full',timeStyle:'short',timeZone:'America/New_York'}).format(new Date(s));
  subject=fill(t.groupReady.subject,{area:g.area});
  paragraphs.push(fill(t.groupReady.opening,values),`${t.groupReady.lessonOne} ${date(g.lessonOne.startsAt)} — ${g.lessonOne.address}\n${t.groupReady.lessonTwo} ${date(g.lessonTwo.startsAt)} — ${g.lessonTwo.address}\n${t.groupReady.trip} ${t.groupReady.pickup} ${date(g.trip.pickupAt)} — ${g.trip.pickupAddress}; ${t.groupReady.return} ${date(g.trip.returnAt)} — ${g.trip.returnAddress}`,
   fill(t.groupReady.complete,{total:String(390*p.children.length)}));
  action={label:t.groupReady.action,url:link(c.url),index:paragraphs.length};paragraphs.push(action.label+'\n'+action.url,t.groupReady.payment,t.groupReady.conduct,t.groupReady.signature);
 }
 const text=paragraphs.join('\n\n');
 const html=`<div lang="${p.messageLanguage}" dir="${p.messageLanguage==='he'?'rtl':'ltr'}">`+paragraphs.map((v,i)=>action&&i===action.index?`<p><a href="${escape(action.url)}" style="display:inline-block;box-sizing:border-box;min-height:48px;padding:14px 24px;border-radius:8px;background:#FDC844;color:#041858;font-size:16px;line-height:20px;text-decoration:none">${escape(action.label)}</a></p>`:`<p>${escape(v).replace(/\n/g,'<br>')}</p>`).join('')+'</div>';
 return {version:TRIP390_EMAIL_VERSION,purpose:TRIP390_EMAIL_PURPOSES[p.kind],messageLanguage:p.messageLanguage,subject,text,html,copySha256:trip390EmailCopySha256,contentSha256:digest({subject,text,html}),grantsSend:false as const};
}
