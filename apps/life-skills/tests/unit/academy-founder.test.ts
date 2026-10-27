import {campaignSnapshotSchema,ACADEMY_CAMPAIGN} from '../../src/features/group-application/academy-campaign-contract.ts';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {floridaCalendarDays,founderPrice,occupiesFounder,FOUNDER_REMINDER_DEFAULTS} from '../../src/features/group-application/academy-founder-contract.ts';
import {founderEmailContent,type FounderMail} from '../../src/features/group-application/academy-founder-email.ts';
import {founderPublicHttp} from '../../src/features/group-application/academy-founder-http.ts';
import {inspectInquiryEmailSetup} from '../../src/features/group-application/inquiry-email-setup.ts';
const origin='https://academy.example.invalid';
it('uses Florida calendar days across spring and autumn DST and keeps the two windows independent',()=>{
 expect(floridaCalendarDays(new Date('2026-10-30T14:00:00Z'),7).toISOString()).toBe('2026-11-06T15:00:00.000Z');
 expect(floridaCalendarDays(new Date('2027-03-10T15:00:00Z'),7).toISOString()).toBe('2027-03-17T14:00:00.000Z');
 expect(FOUNDER_REMINDER_DEFAULTS).toEqual([3,6]);for(const s of ['provisional','confirmed','scheduling_hold','offered','redeemed'] as const)expect(occupiesFounder(s)).toBe(true);for(const s of ['interest_list','expired','withdrawn','pending_verification'] as const)expect(occupiesFounder(s)).toBe(false);
});
it('never discounts650 blocks or later ordinary prices',()=>{for(const founder of [true,false])for(const sibling of [true,false])expect(founderPrice('monthly_block',founder,sibling)).toBe(650);expect([founderPrice('prepay',true,false),founderPrice('prepay',true,true),founderPrice('prepay',false,false),founderPrice('prepay',false,true)]).toEqual([1650,1550,1750,1650]);});
it('localized standard emails omit the internal scheduling exception, disclose actual reservation status and use fragment-only opaque action tokens',()=>{
 for(const locale of ['en','he'] as const)for(const kind of ['interest','ack','interest_reminder','offer','payment_reminder'] as const){const p:FounderMail={familyId:'synthetic',reference:'synthetic-reference',generation:1,kind,locale,...(kind==='payment_reminder'?{reminderDate:'2026-10-26',unpaidLines:[{childId:'synthetic',offerId:'synthetic',revision:1,name:'Synthetic Child',unpaidCents:65000,deadline:'2026-10-30T14:00:00.000Z'}]}:{}),to:'synthetic@example.invalid',status:'reserved',token:'a'.repeat(43),deadline:'2026-10-30T14:00:00Z',offer:{group:'Synthetic group',firstSession:'2026-12-01T15:00:00Z',children:[{name:'Synthetic child',amount:1650}],paymentUrl:origin+'/synthetic-payment',terms:'Synthetic terms'}};const copy=founderEmailContent(p,origin);expect(copy.text).not.toMatch(/scheduling.hold|later suitable group keeps|המתנה פנימית/);if(kind==='interest'){expect(copy.text).toContain('/'+locale+'/florida/confirm-interest#'+'a'.repeat(43));expect(copy.text).toContain(locale==='en'?'seven days to pay':'שבעה ימים לשלם');expect(copy.text).not.toContain('Confirm by:');expect(copy.text).not.toContain('synthetic@example.invalid');}if(kind==='ack')expect(copy.text).toContain(locale==='en'?'No payment is due':'אין תשלום כעת');}
});
it('GET/open/preview cannot confirm; POST requires same-origin action, valid token and enabled admission; counter failure fabricates no number',async()=>{
 const confirm=vi.fn(async()=>({confirmed:true,reference:'synthetic'})),aggregate=vi.fn(async()=>(campaignSnapshotSchema.parse({remaining:29,capacity:30,occupied:1,phase:'PRE_REGISTRATION',revision:1,firstFilledAt:null,asOf:'2026-10-23T14:00:00.000Z',version:ACADEMY_CAMPAIGN,reopeningPolicy:'PROPOSED_STICKY_REGULAR_PENDING_OWNER_CONFIRMATION'})));
 const d={enabled:true,store:{confirm,aggregate,confirmationContext:async()=>({reference:'synthetic',deadline:null,timezone:'America/New_York' as const,confirmed:false,available:false})},environment:{LS_APP_ORIGIN:origin},limits:{consume:async()=>({count:1,retryAfterMs:0})},rateKey:'synthetic-rate-limit-key-32-characters'};
 const request=(method:string,body?:unknown,extra:Record<string,string>={})=>new Request(origin+'/api/public/academy-founder',{method,headers:{host:'academy.example.invalid',origin,'sec-fetch-site':'same-origin','content-type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})});
 expect((await founderPublicHttp(request('GET'),async()=>d)).status).toBe(200);expect(confirm).not.toHaveBeenCalled();expect((await founderPublicHttp(request('POST',{action:'confirm_interest',token:'a'.repeat(43)}),async()=>d)).status).toBe(200);expect(confirm).toHaveBeenCalledTimes(1);
 expect((await founderPublicHttp(request('POST',{action:'confirm_interest',token:'a'.repeat(43)},{origin:'https://other.invalid'}),async()=>d)).status).toBe(403);expect(confirm).toHaveBeenCalledTimes(1);
 const failed=await founderPublicHttp(request('GET'),async()=>({...d,store:{...d.store,aggregate:async()=>{throw Error();}}}));expect(failed.status).toBe(503);expect(await failed.text()).not.toContain('remaining');
 expect((await founderPublicHttp(request('POST',{action:'confirm_interest',token:'a'.repeat(43)}),async()=>({...d,enabled:false}))).status).toBe(503);expect(confirm).toHaveBeenCalledTimes(1);
});
it('sender inspection never grants send authority from configured fields or queued records',()=>{expect(inspectInquiryEmailSetup({})).toMatchObject({sendPermitted:false,senderVerified:false,deliveryVerified:false,status:'SEND_DISABLED'});expect(inspectInquiryEmailSetup({LS_INQUIRY_EMAIL_SEND_ENABLED:'true'})).toMatchObject({sendPermitted:false,status:'HOLD_REQUIRED'});});

it('dispatches only after a durable explicit confirmation, never on read/open/rejected confirmation',async()=>{
 const order:string[]=[],confirm=vi.fn(async()=>{order.push('committed');return {confirmed:true,reference:'synthetic-reference'};}),afterConfirm=vi.fn(async(reference:string)=>{expect(reference).toBe('synthetic-reference');order.push('dispatch');});
 const d={enabled:true,store:{confirm,aggregate:vi.fn(),confirmationContext:async()=>({reference:'synthetic-reference',deadline:null,timezone:'America/New_York' as const,confirmed:false,available:false})},afterConfirm,environment:{LS_APP_ORIGIN:origin},limits:{consume:async()=>({count:1,retryAfterMs:0})},rateKey:'synthetic-rate-limit-key-32-characters'};
 const req=(action:string,token='a'.repeat(43))=>new Request(origin+'/api/public/academy-founder',{method:'POST',headers:{host:'academy.example.invalid',origin,'sec-fetch-site':'same-origin','content-type':'application/json'},body:JSON.stringify({action,token})});
 expect((await founderPublicHttp(req('read_confirmation'),async()=>d)).status).toBe(200);expect(order).toEqual([]);
 expect((await founderPublicHttp(req('confirm_interest'),async()=>d)).status).toBe(200);expect(order).toEqual(['committed','dispatch']);
 order.length=0;expect((await founderPublicHttp(req('confirm_interest','bad'),async()=>d)).status).toBe(400);expect(order).toEqual([]);
 confirm.mockRejectedValueOnce(Error('synthetic transaction failure'));
 expect((await founderPublicHttp(req('confirm_interest'),async()=>d)).status).toBe(503);expect(order).toEqual([]);
 afterConfirm.mockRejectedValueOnce(Error('synthetic delivery failure'));
 const saved=await founderPublicHttp(req('confirm_interest'),async()=>d);expect(saved.status).toBe(200);expect(await saved.json()).toMatchObject({data:{confirmed:true,reference:'synthetic-reference'}});
 expect(saved.headers.get('Cache-Control')).toBe('private, no-store');
});
