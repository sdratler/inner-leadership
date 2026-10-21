import 'server-only';
import {AppError} from '../../lib/errors.ts';
import type {IdentityConfig} from '../identity/config.ts';
import type {IdentityStore,SqlSession} from '../identity/store.ts';
import {systemClock,type Actor,type IdentityClock} from '../identity/types.ts';
import {digest} from '../fishing-payments/domain.ts';
import {NativeFishingProgram} from './native-program.ts';
import {FishingProgramError} from './native-program-contract.ts';
import {AcademyGroupCalendarStore} from './academy-group-calendar-store.ts';
import {academyGroupCalendarVersion,academyGroupCalendarQuerySchema,academyGroupCalendarContextSchema,academyGroupDraftCommandSchema,academyGroupEventRecordSchema,type AcademyGroupDraftCommand,type AcademyGroupEventRecord,type AcademyGroupCalendarContext} from './academy-group-calendar-contract.ts';

function requireFact(v:unknown,code:'CONFLICT'|'FORBIDDEN'|'NOT_FOUND'|'UNAVAILABLE'='CONFLICT'):asserts v{if(!v)throw new AppError(code);}
function clean(error:unknown):never{
 if(error instanceof AppError)throw error;if(error instanceof FishingProgramError)throw new AppError(error.code==='CAPACITY'||error.code==='POLICY_REQUIRED'||error.code==='APPROVAL_REQUIRED'?'CONFLICT':error.code);
 if(error&&typeof error==='object'&&'code'in error&&['23505','40001','40P01'].includes(String(error.code)))throw new AppError('CONFLICT');throw new AppError('UNAVAILABLE');
}
function authorizeSaved(record:AcademyGroupEventRecord,groups:AcademyGroupCalendarContext['groups']){
 for(const original of record.originals){const s=original.selection;requireFact(groups.some(g=>g.cohortId===s.cohortId&&g.stageId===s.stageId&&g.stage===s.stage&&g.originals.some(o=>o.selection.occurrenceId===s.occurrenceId)),'NOT_FOUND');}
}
/** The first physical-event workflow persists private prospective demand.
 * It shares native group/original identity and the existing workspace lock.
 * Publication/attendance/credit/source adoption remain separately required. */
export class AcademyGroupCalendarService{
 private program:NativeFishingProgram;
 constructor(private db:IdentityStore,private config:IdentityConfig,private clock:IdentityClock=systemClock){this.program=new NativeFishingProgram(db,config.keyring,{childAccountsEnabled:config.childAccountsEnabled===true,merchant:null},clock);}
 private async transaction<T>(actor:Actor,work:(tx:SqlSession,store:AcademyGroupCalendarStore,groups:Awaited<ReturnType<NativeFishingProgram['calendarGroupPlanningInTransaction']>>)=>Promise<T>):Promise<T>{
  try{return await this.db.transaction(async tx=>{
   // This performs the real locked session/account/role/demo/source/plan reads.
   const groups=await this.program.calendarGroupPlanningInTransaction(tx,actor),store=new AcademyGroupCalendarStore(tx,this.config.keyring),result=await work(tx,store,groups);
   await this.program.calendarGroupPlanningInTransaction(tx,actor);return result;
  });}catch(error){clean(error);}
 }
 context(actor:Actor,raw:unknown){const query=academyGroupCalendarQuerySchema.parse(raw);return this.transaction(actor,async(_tx,store,groups)=>{
  if(!await store.configured())return academyGroupCalendarContextSchema.parse({version:academyGroupCalendarVersion,availability:'not_configured',events:[],groups:[]});
  const events=await store.list(actor.workspaceId,actor.id,query.from,query.to);
  for(const event of events)authorizeSaved(event,groups);
  // Historical drafts retain their original snapshot. Current choices are
  // separate, so a later Stage edit cannot silently rebind an existing link.
  return academyGroupCalendarContextSchema.parse({version:academyGroupCalendarVersion,availability:'ready',events,groups});
 });}
 saveDraft(actor:Actor,raw:unknown){const command=academyGroupDraftCommandSchema.parse(raw);return this.transaction(actor,async(_tx,store,groups)=>{
  requireFact(await store.configured(),'UNAVAILABLE');
  const prior=await store.read(actor.workspaceId,command.eventId);
  if(prior){requireFact(prior.record.operatorId===actor.id,'NOT_FOUND');authorizeSaved(prior.record,groups);}
  const replay=await store.replay(actor.workspaceId,actor.id,command);
  if(replay){const saved=await store.read(actor.workspaceId,replay.eventId,replay.revision);requireFact(saved,'UNAVAILABLE');authorizeSaved(saved.record,groups);return {receipt:{...replay,replayed:true}};}
  requireFact((prior?.record.revision??0)===command.expectedRevision);
  requireFact(!prior||prior.record.calendarMonth===command.calendarMonth);
  if(!prior)requireFact((await store.list(actor.workspaceId,actor.id,command.calendarMonth,command.calendarMonth)).length===0);
  const originals=command.originals.map(selection=>{
   const group=groups.find(g=>g.cohortId===selection.cohortId&&g.stageId===selection.stageId&&g.stage===selection.stage),original=group?.originals.find(o=>o.selection.occurrenceId===selection.occurrenceId);
   requireFact(original,'NOT_FOUND');requireFact(digest(original.selection)===digest(selection));return original;
  });
  const record=academyGroupEventRecordSchema.parse({version:academyGroupCalendarVersion,workspaceId:actor.workspaceId,eventId:command.eventId,operatorId:actor.id,kind:'monthly_core_keys',calendarMonth:command.calendarMonth,
   revision:command.expectedRevision+1,previousSha256:prior?.sha256??null,label:command.label,placement:command.placement,state:command.placement.kind==='needs_placement'?'needs_placement':'review_required',originals,
   operationId:command.operationId,recordedAt:this.clock.now().toISOString()});
  const receipt=await store.append(record,command);return {receipt:{...receipt,replayed:false}};
 });}
}
export type AcademyGroupDraftResult=Awaited<ReturnType<AcademyGroupCalendarService['saveDraft']>>;
export type {AcademyGroupDraftCommand};
