import {z} from 'zod';
const id=z.string().uuid(),instant=z.string().max(40).refine(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value);
const nullableInstant=instant.nullable();
export type UpdateCase={id:string;displayName:string;kind:'minor'|'adult'};
export type UpdateAudience={id:string;visibility:'private'|'family_full'|'family_title_completion'};
const cases=z.array(z.object({id,displayName:z.string().min(1).max(500),kind:z.enum(['minor','adult'])})).max(500).refine(rows=>new Set(rows.map(row=>row.id)).size===rows.length);
const audiences=z.array(z.object({id,visibility:z.enum(['private','family_full','family_title_completion'])})).max(500).refine(rows=>new Set(rows.map(row=>row.id)).size===rows.length);
const practice=z.object({workspaceId:id,caseId:id,assignmentId:id,versionId:id,audienceId:id,visibility:z.literal('family_full'),publishedAt:instant,immutableSnapshotDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const report=z.object({id,workspaceId:id,caseId:id,audienceId:id,authorAccountId:id,body:z.string().min(1).max(8000),eventAt:nullableInstant,submittedAt:instant,reviewState:z.enum(['new','reviewed','replied','adapted']),reviewedByAccountId:id.nullable(),reviewedAt:nullableInstant,practice}).strict().refine(row=>row.caseId===row.practice.caseId&&row.audienceId===row.practice.audienceId&&row.workspaceId===row.practice.workspaceId);
const reply=z.object({id,reportId:id,authorAccountId:id,body:z.string().min(1).max(8000),state:z.enum(['draft','published']),createdAt:instant,publishedAt:nullableInstant,supersedesReplyId:id.nullable()}).strict().refine(row=>(row.state==='published')===(row.publishedAt!==null));
const thread=z.object({report,replies:z.array(reply).max(100),nextRepliesBefore:id.nullable().optional()}).strict().refine(row=>new Set(row.replies.map(item=>item.id)).size===row.replies.length&&row.replies.every(item=>item.reportId===row.report.id)&&(!row.nextRepliesBefore||row.replies.length===100&&row.nextRepliesBefore===row.replies[0]?.id));
export type UpdateThread=z.infer<typeof thread>;
export function parseUpdateCases(value:unknown):UpdateCase[]{return cases.parse(value);}
export function parseUpdateAudiences(value:unknown):UpdateAudience[]{return audiences.parse(value);}
export function selectedUpdateCase(rows:readonly UpdateCase[],requested:string):string{return requested?rows.some(row=>row.id===requested)?requested:'':rows[0]?.id??'';}
export function parseUpdateThreads(value:unknown,caseId:string,audienceId:string,practitioner:boolean):UpdateThread[]{
 const rows=z.array(thread).max(100).parse(value);
 if(new Set(rows.map(row=>row.report.id)).size!==rows.length||rows.some(row=>row.report.caseId!==caseId||row.report.audienceId!==audienceId||!practitioner&&row.replies.some(item=>item.state!=='published')))throw Error('UNAVAILABLE');
 return rows;
}
/** Success is a matching independent protected read, never a POST acknowledgement alone. */
export function updateSaveVerified(threads:readonly UpdateThread[],payload:Record<string,unknown>,receipt:unknown):boolean{
 if(payload.action==='reply'){
  const parsed=reply.safeParse(receipt);if(!parsed.success||parsed.data.reportId!==payload.reportId||parsed.data.body!==String(payload.body).trim()||parsed.data.state!=='published')return false;
  return threads.some(row=>row.report.id===payload.reportId&&row.replies.some(item=>item.id===parsed.data.id&&JSON.stringify(item)===JSON.stringify(parsed.data)));
 }
 const parsed=report.safeParse(receipt);if(!parsed.success)return false;
 const found=threads.find(row=>row.report.id===parsed.data.id);if(!found||JSON.stringify(found.report)!==JSON.stringify(parsed.data))return false;
 if(payload.action==='review')return parsed.data.id===payload.reportId&&parsed.data.reviewState!=='new';
 return payload.action==='submit_report'&&parsed.data.caseId===payload.caseId&&parsed.data.audienceId===payload.audienceId&&parsed.data.practice.versionId===payload.practiceVersionId&&parsed.data.body===String(payload.body).trim();
}
