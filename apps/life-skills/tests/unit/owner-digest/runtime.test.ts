import {expect,it,vi} from 'vitest';
import type {IdentityStore} from '../../../src/features/identity/store.ts';
import type {Actor} from '../../../src/features/identity/types.ts';
import type {Prospect} from '../../../src/features/prospects/bridge.ts';
vi.mock('server-only',()=>({}));
import {readIntakeFacts} from '../../../src/features/owner-digest/runtime.ts';
const actor={id:'DEMO-owner',workspaceId:'DEMO-workspace',role:'practitioner',state:'active',sessionDigest:'DEMO-session'} as Actor;
it.each(['opt out','opted-out','OPT_OUT','do_not_contact','Do-Not-Contact'])('excludes %s before both actual intake and journey queries',async value=>{
 const rows=[{leadId:'LS-LEAD-stage',stage:value,outcome:''},{leadId:'LS-LEAD-outcome',stage:'Prospect',outcome:value},{leadId:'LS-LEAD-archive',stage:'Archived',outcome:''},{leadId:'LS-LEAD-allowed',stage:'Prospect',outcome:''}] as Prospect[];
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
