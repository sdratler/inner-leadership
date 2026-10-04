import {expect,it,vi} from 'vitest';
import type {IdentityStore} from '../../../src/features/identity/store.ts';
import type {Actor} from '../../../src/features/identity/types.ts';
import type {Prospect} from '../../../src/features/prospects/bridge.ts';
vi.mock('server-only',()=>({}));
const prospectsRead=vi.hoisted(()=>vi.fn());
vi.mock('../../../src/features/contact-ops/server/authoritative-prospects.ts',()=>({readAuthoritativeProspects:prospectsRead}));
import {readIntakeFacts,loadOwnerDigest} from '../../../src/features/owner-digest/runtime.ts';
import {AppError} from '../../../src/lib/errors.ts';
import {MAX_OPERATIONAL_PROSPECTS} from '../../../src/features/contact-ops/core/limits.ts';
import type {MarketingSnapshot} from '../../../src/features/marketing-overview/contracts.ts';
const actor={id:'DEMO-owner',workspaceId:'DEMO-workspace',role:'practitioner',state:'active',sessionDigest:'DEMO-session'} as Actor;
it.each(['intake_submitted','awaiting_payment','payment_verified','awaiting_booking','active','hold'])('counts pending forms only for unsubmitted leads, not canonical %s journeys',async state=>{
 const rows=['pending','submitted'].map(key=>({leadId:'LS-LEAD-'+key,stage:'Prospect',outcome:'',nextAction:'',dueDate:''})) as Prospect[];
 let formIds:unknown;
 const store:IdentityStore={transaction:async work=>work({query:async<T extends object>(sql:string,args:readonly unknown[]=[])=>{
  if(sql.includes('SELECT a.id FROM ls_identity.sessions'))return [{id:actor.id}] as T[];
  if(sql.includes('FROM ls_identity.accounts a JOIN'))return [actor] as T[];
  if(sql.includes('FROM ls_onboarding.prospect_journeys'))return [{leadId:'LS-LEAD-submitted',state,paymentVerified:false,bookingConfirmed:false}] as T[];
  if(sql.includes('COUNT(DISTINCT i.stable_lead_ref)')){formIds=JSON.parse(String(args[2]));return [{total:String((formIds as string[]).length)}] as T[];}
  if(sql.startsWith('SET TRANSACTION'))return [] as T[];
  throw Error('UNEXPECTED_QUERY');
 }})};
 const facts=await readIntakeFacts(store,actor,rows,new Date('2026-10-04T12:00:00Z'));
 expect(formIds).toEqual(['LS-LEAD-pending']);expect(facts.awaitingForm).toBe(1);
 expect(facts.journeys.get('LS-LEAD-submitted')?.journeyState).toBe(state);
 expect(rows.map(row=>row.leadId)).toEqual(['LS-LEAD-pending','LS-LEAD-submitted']);
});
it.each(['opt out','opted-out','OPT_OUT','do_not_contact','Do-Not-Contact','Closed','Not interested','No fit','CLOSED','Closed — older inquiry'])('excludes %s before both actual intake and journey queries',async value=>{
 const rows=[{leadId:'LS-LEAD-stage',stage:value,outcome:''},{leadId:'LS-LEAD-outcome',stage:'Prospect',outcome:value},{leadId:'LS-LEAD-archive',stage:'Archived',outcome:''},{leadId:'LS-LEAD-allowed',stage:'Prospect',outcome:''}].map(row=>({...row,nextAction:'',dueDate:''})) as Prospect[];
 const facts:(readonly unknown[])[]=[];
 const store:IdentityStore={transaction:async work=>work({query:async<T extends object>(sql:string,args:readonly unknown[]=[])=>{
  if(sql.includes('SELECT a.id FROM ls_identity.sessions'))return [{id:actor.id}] as T[];
  if(sql.includes('FROM ls_identity.accounts a JOIN'))return [actor] as T[];
  if(sql.includes('FROM ls_onboarding.prospect_journeys')){facts.push(args);return [] as T[];}
  if(sql.includes('COUNT(DISTINCT i.stable_lead_ref)')){facts.push(args);return [{total:'1'}] as T[];}
  if(sql.startsWith('SET TRANSACTION'))return [] as T[];
  throw Error('UNEXPECTED_QUERY');
 }})};
 const result=await readIntakeFacts(store,actor,rows,new Date('2026-10-04T12:00:00Z'));
 expect(result.awaitingForm).toBe(1);expect(facts).toHaveLength(2);
 expect(facts[0]![1]).toBe('["LS-LEAD-allowed"]');expect(facts[1]![2]).toBe('["LS-LEAD-allowed"]');
 expect(rows[0]!.stage).toBe(value);expect(rows[1]!.outcome).toBe(value);
});
const now=new Date('2026-10-04T12:00:00Z');
const prospect={leadId:'LS-LEAD-allowed',stage:'Prospect',outcome:'',nextAction:'Synthetic follow-up',dueDate:'2026-10-04'} as Prospect;
const marketing:MarketingSnapshot={source:'registry_only',fetchedAt:null,creatives:[],publications:[],ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:'unbound'},inventory:{files:0,concepts:0,publishablePosts:0,heStatusReady:0,heFeedReady:0,enFeedReady:0,adEligible:0,inLiveAds:null,queued:0,published:0,needsApproval:0,needsResizeOrCaption:0,heldMissing:0,partial:false,asOf:now.toISOString()}};
function digestRuntime(finalFailure?:'UNAUTHENTICATED'|'FORBIDDEN',queries:string[]=[]){
 let accountReads=0;
 const store:IdentityStore={transaction:async work=>work({query:async<T extends object>(sql:string)=>{
  queries.push(sql);
  if(sql.includes('SELECT a.id FROM ls_identity.sessions'))return [{id:actor.id}] as T[];
  if(sql.includes('FROM ls_identity.accounts a JOIN')){accountReads++;if(finalFailure&&accountReads===3)throw new AppError(finalFailure);return [actor] as T[];}
  if(sql.includes('FROM ls_calendar.tasks'))return [{due:'2',overdue:'1',future:'0'}] as T[];
  if(sql.includes('COUNT(DISTINCT i.stable_lead_ref)'))return [{total:'1'}] as T[];
  if(sql.startsWith('SET TRANSACTION')||sql.includes('FROM ls_demo.records')||sql.includes('FROM ls_onboarding.prospect_journeys'))return [] as T[];
  throw Error('UNEXPECTED_QUERY');
 }})};
 return {store,clock:{now:()=>now}} as Parameters<typeof loadOwnerDigest>[1];
}
const invalidProjections=[
 ['duplicate IDs',[prospect,{...prospect}]],
 ['malformed ID',[{...prospect,leadId:'not-a-lead'}]],
 ['excessively long ID',[{...prospect,leadId:'LS-LEAD-'+'a'.repeat(81)}]],
 ['more than the unchanged operational bound',Array.from({length:MAX_OPERATIONAL_PROSPECTS+1},(_,i)=>({...prospect,leadId:`LS-LEAD-${i}`}))],
 ...(['stage','outcome','nextAction','dueDate'] as const).flatMap(key=>[
  [`null ${key}`,[{...prospect,[key]:null} as unknown as Prospect]] as const,
  [`missing ${key}`,[Object.fromEntries(Object.entries(prospect).filter(([field])=>field!==key)) as Prospect]] as const,
  [`nonstring ${key}`,[{...prospect,[key]:123} as unknown as Prospect]] as const,
 ]),
] as const;
it.each(invalidProjections)('keeps tasks and content when CRM has %s, without converting it to zero or truncating it',async(_label,rows)=>{
 const originalLead=rows[0]!.leadId;
 prospectsRead.mockResolvedValueOnce(rows);
 const digest=await loadOwnerDigest(actor,digestRuntime(),marketing,'en');
 expect(digest.followups).toBeNull();expect(digest.actions).toContain('crm_unavailable');
 expect(digest.tasks?.data).toEqual({due:2,overdue:1,future:0});expect(digest.content.available).toBe(true);
 expect(digest.actions).not.toContain('tasks_unavailable');expect(rows[0]!.leadId).toBe(originalLead);
});
it.each(invalidProjections)('rejects %s before demo, journey and invitation queries while preserving independent facts',async(_label,rows)=>{
 prospectsRead.mockResolvedValueOnce(rows);const queries:string[]=[];
 const digest=await loadOwnerDigest(actor,digestRuntime(undefined,queries),marketing,'en');
 expect(queries.some(sql=>sql.includes('SELECT entity_key AS id FROM ls_demo.records'))).toBe(false);
 expect(queries.some(sql=>sql.includes('FROM ls_onboarding.prospect_journeys'))).toBe(false);
 expect(queries.some(sql=>sql.includes('COUNT(DISTINCT i.stable_lead_ref)'))).toBe(false);
 expect(digest.followups).toBeNull();expect(digest.actions).toContain('crm_unavailable');
 expect(digest.actions).toContain('journeys_unavailable');expect(digest.tasks?.data.due).toBe(2);
 expect(digest.content.available).toBe(true);
});
it.each(invalidProjections)('rejects direct intake %s before its ledger queries',async(_label,rows)=>{
 const queries:string[]=[],runtime=digestRuntime(undefined,queries);
 await expect(readIntakeFacts(runtime.store,actor,rows,now)).rejects.toThrow('INVALID_DIGEST_PROSPECTS');
 expect(queries.some(sql=>sql.includes('FROM ls_onboarding.prospect_journeys')||sql.includes('COUNT(DISTINCT i.stable_lead_ref)'))).toBe(false);
});
it('preserves the accepted ID length boundary, stable keys and unknown text without mutation',async()=>{
 const row={...prospect,leadId:'LS-WAPI-'+'a'.repeat(80),stage:'constructor',outcome:'owner-defined label'},queries:string[]=[];
 prospectsRead.mockResolvedValueOnce([row]);
 const digest=await loadOwnerDigest(actor,digestRuntime(undefined,queries),marketing,'he');
 expect(digest.followups?.data).toMatchObject({prospects:1,due:1,awaitingForm:1});
 expect(queries.some(sql=>sql.includes('SELECT entity_key AS id FROM ls_demo.records'))).toBe(true);
 expect(row).toEqual({...prospect,leadId:'LS-WAPI-'+'a'.repeat(80),stage:'constructor',outcome:'owner-defined label'});
});
it('retains the valid actual intake and task projections',async()=>{
 prospectsRead.mockResolvedValueOnce([prospect]);
 const digest=await loadOwnerDigest(actor,digestRuntime(),marketing,'he');
 expect(digest.followups?.data).toMatchObject({prospects:1,due:1,awaitingForm:1});
 expect(digest.tasks?.data.due).toBe(2);expect(digest.actions).not.toContain('crm_unavailable');
});
it.each(['UNAUTHENTICATED','FORBIDDEN'] as const)('does not hide a final fresh-actor %s behind the unavailable CRM projection',async code=>{
 prospectsRead.mockResolvedValueOnce([{...prospect,leadId:'not-a-lead'}]);
 await expect(loadOwnerDigest(actor,digestRuntime(code),marketing,'en')).rejects.toMatchObject({code});
});
