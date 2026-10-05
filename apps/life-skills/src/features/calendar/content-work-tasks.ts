import {AppError} from '../../lib/errors.ts';
import type {MarketingSnapshot} from '../marketing-overview/contracts.ts';
import {registeredCreativeRevision,validateMarketingSnapshot,publicationLabel} from '../marketing-overview/read-model.ts';
import {actionableCreative,creativeReviewState} from '../marketing-overview/creative-filters.ts';
import {administrativeTaskTitle} from './administrative-work-copy.ts';
import type {AdministrativeWorkSource} from './source-work-tasks.ts';
import {civilDate} from './time.ts';
/** Only the current registered revision is work. Templates/history, uncertain
 * duplicate revisions and missing rows cannot create approvals or resolve work.
 * Registry acceptance/scheduling/manual posting is not publication proof. */
export function contentWorkSources(snapshot:MarketingSnapshot):AdministrativeWorkSource[]{
 try{validateMarketingSnapshot(snapshot);}catch{throw new AppError('UNAVAILABLE');}
 if(snapshot.source==='synthetic'||snapshot.fetchedAt===null)throw new AppError('UNAVAILABLE');
 const sources:AdministrativeWorkSource[]=[],seen=new Set<string>();
 for(const asset of snapshot.creatives){
  if(seen.has(asset.assetId))continue;seen.add(asset.assetId);
  const family=snapshot.creatives.filter(row=>row.assetId===asset.assetId),revision=Math.max(...family.map(row=>row.revision));
  const current=family.filter(row=>row.revision===revision),row=current[0]!;
  if(new Set(current.map(item=>JSON.stringify([item.contentDigest,item.review,item.approvedDigest,item.registeredRevision,item.libraryState]))).size!==1||!registeredCreativeRevision(row))continue;
  const state=creativeReviewState(row),active=actionableCreative(row,snapshot.creatives);
  if(!active&&!['approved','retired','rejected'].includes(state))continue;
  sources.push({kind:'creative_approval',sourceId:row.assetId,caseId:null,title:administrativeTaskTitle('creative_approval',row.assetId),
   sourcePath:'/en/app/marketing?'+new URLSearchParams({section:active?'needs_approval':'creatives',search:row.assetId}),dueDate:null,active,
   revisionFacts:{revision:row.revision,digest:row.contentDigest,state}});
 }
 const publications=new Set<string>();
 for(const row of snapshot.publications){
  if(row.id.length>200||publications.has(row.id))throw new AppError('UNAVAILABLE');publications.add(row.id);
  const confirmed=row.state==='published'&&Boolean(row.confirmedAt)&&publicationLabel(row,snapshot.creatives)==='Published — provider receipt recorded';
  if(row.state!=='failed'&&!confirmed&&row.state!=='skipped')continue;
  const month=row.scheduledFor?civilDate(row.scheduledFor).slice(0,7):null;
  sources.push({kind:'publishing_failure',sourceId:row.id,caseId:null,title:administrativeTaskTitle('publishing_failure',row.assetId||row.id),
   sourcePath:'/en/app/marketing?'+new URLSearchParams({section:'content_calendar',publication:row.id,...(month?{month}:{}),layout:'agenda'}),dueDate:null,active:row.state==='failed',
   revisionFacts:{state:row.state,assetId:row.assetId,revision:row.creativeRevision,digest:row.creativeDigest,errorCode:row.errorCode,...(confirmed?{receiptId:row.providerReceiptId,confirmedAt:row.confirmedAt}: {})}});
 }
 return sources;
}
