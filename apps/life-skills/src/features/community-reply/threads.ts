import 'server-only';
import {AppError} from '../../lib/errors.ts';
import {requirePractitioner} from '../cases/policy.ts';
import {civilDate} from '../calendar/time.ts';
import type {Actor} from '../identity/types.ts';
import type {InternalTaskService} from '../calendar/tasks.ts';
import {pendingCommunityResponses,acknowledgeCommunityTask} from './threads-bridge.ts';
/** The server reads captured receipts for the authenticated owner. Client
 * supplied comment text/IDs never create tasks. Stable command receipts make
 * a lost Scout acknowledgement safe to retry without a second Calendar task. */
export async function projectCommunityTasks(actor:Actor,tasks:InternalTaskService,deps={pending:pendingCommunityResponses,acknowledge:acknowledgeCommunityTask}){
 requirePractitioner(actor);
 const page=await deps.pending(actor.id);let linked=0;
 if(page.responses.length>25)throw new AppError('UNAVAILABLE');
 for(const response of page.responses){
  const task=await tasks.create(actor,'community_response_'+response.id,{caseId:null,title:'Community / קהילה: review captured response',note:null,sourcePath:'/he/app/marketing?section=community&threadId='+response.threadId,dueDate:civilDate(response.capturedAt),dueTime:null});
  await deps.acknowledge(actor.id,response.id,task.id);linked++;
 }
 return {linked,more:page.more};
}
