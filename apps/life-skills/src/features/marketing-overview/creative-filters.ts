import type {CreativeVersion} from './contracts.ts';
import {approvedCreative,registeredCreativeRevision} from './read-model.ts';

export const creativePlacements = ['all','facebook_feed','whatsapp_status','instagram_feed','other'] as const;
export const creativeApprovals = ['all','needs_approval','approved','retired','rejected','unknown'] as const;
export const creativeCollections=['current','templates','history'] as const;
export type CreativeQuery = {filter?:string|undefined;language?:string|undefined;placement?:string|undefined;approval?:string|undefined;search?:string|undefined;page?:string|undefined;collection?:string|undefined;concept?:string|undefined;cycle?:string|undefined};
export type CreativeFilters = {language:'all'|'he'|'en';placement:typeof creativePlacements[number];approval:typeof creativeApprovals[number];search:string;collection:typeof creativeCollections[number];concept:string;cycle:string};

/** Categories come from the registered surface, never image dimensions or an inferred entitlement. */
export function creativePlacement(asset:CreativeVersion):CreativeFilters['placement'] {
 const surface=asset.surface??'';
 if(/status|whatsapp/i.test(surface))return 'whatsapp_status';
 if(/instagram/i.test(surface))return 'instagram_feed';
 if(/facebook|feed/i.test(surface))return 'facebook_feed';
 return 'other';
}
export function creativeFilters(query:CreativeQuery,needsApproval=false):CreativeFilters {
 const preset=query.filter;
 const language=['all','he','en'].includes(query.language??'')?query.language as CreativeFilters['language']:preset==='he_status'||preset==='he_feed'?'he':preset==='en_feed'?'en':'all';
 const placement=creativePlacements.find(value=>value===query.placement)??(preset==='he_status'?'whatsapp_status':preset==='he_feed'||preset==='en_feed'?'facebook_feed':'all');
 const approval=needsApproval?'needs_approval':creativeApprovals.find(value=>value===query.approval)??'all';
 const search=typeof query.search==='string'&&query.search.length<=200&&!/[\u0000-\u001f\u007f]/.test(query.search)?query.search.trim():'';
 const collection=needsApproval||approval==='needs_approval'?'current':creativeCollections.find(value=>value===query.collection)??'current';
 const concept=query.concept==='unrecorded'||/^[1-9]\d{0,5}$/.test(query.concept??'')?query.concept!:'all';
 const cycle=query.cycle==='unrecorded'||typeof query.cycle==='string'&&query.cycle.startsWith('cycle:')&&query.cycle.length>6&&query.cycle.length<=126&&!/[\u0000-\u001f\u007f]/.test(query.cycle)?query.cycle!:'all';
 return {language,placement,approval,search,collection,concept,cycle};
}
export function creativeMetadataOptions(assets:readonly CreativeVersion[]){
 return {concepts:[...new Set(assets.map(asset=>asset.concept).filter((value):value is number=>typeof value==='number'))].sort((a,b)=>a-b),cycles:[...new Set(assets.map(asset=>asset.cycle).filter((value):value is string=>typeof value==='string'&&value.length>0))].sort((a,b)=>a.localeCompare(b))};
}
export function creativeReviewState(asset:CreativeVersion):'approved'|'retired'|'rejected'|'unknown'|'unapproved' {
 const library=asset.libraryState?.trim().toUpperCase();
 if(library==='REJECTED'||library==='DISCARDED'||library==='OWNER_DISCARDED')return 'rejected';
 if(asset.review==='retired'||library==='RETIRED'||library==='ARCHIVED')return 'retired';
 if(!registeredCreativeRevision(asset))return 'unknown';
 if(approvedCreative(asset))return 'approved';
 return ['draft','in_review','approved'].includes(asset.review)?'unapproved':'unknown';
}
/** A stale or contradictory current revision is not an actionable approval request. No registry writes. */
export function actionableCreative(asset:CreativeVersion,assets:readonly CreativeVersion[]):boolean {
 if(asset.collection||creativeReviewState(asset)!=='unapproved'||!Number.isSafeInteger(asset.revision)||asset.revision<1||! /^[a-f0-9]{64}$/.test(asset.contentDigest))return false;
 const family=assets.filter(item=>item.assetId===asset.assetId);
 if(family.some(item=>item.revision>asset.revision))return false;
 return !family.some(item=>item.revision===asset.revision&&item.contentDigest!==asset.contentDigest);
}
export function filterCreatives(assets:readonly CreativeVersion[],filters:CreativeFilters):readonly CreativeVersion[] {
 const search=filters.search.toLocaleLowerCase();
 return assets.filter(asset=>{
  if((asset.collection??'current')!==filters.collection)return false;
  if(filters.concept==='unrecorded'?asset.concept!=null:filters.concept!=='all'&&String(asset.concept)!==filters.concept)return false;
  if(filters.cycle==='unrecorded'?asset.cycle!=null:filters.cycle!=='all'&&asset.cycle!==filters.cycle.slice(6))return false;
  if(filters.language!=='all'&&asset.locale!==filters.language||filters.placement!=='all'&&creativePlacement(asset)!==filters.placement)return false;
  if(filters.approval==='needs_approval'&&!actionableCreative(asset,assets))return false;
  if(filters.approval!=='all'&&filters.approval!=='needs_approval'&&creativeReviewState(asset)!==filters.approval)return false;
  return !search||[asset.title,asset.caption,asset.assetId,asset.surface,asset.holdReason,asset.libraryState].filter(Boolean).join(' ').toLocaleLowerCase().includes(search);
 });
}
/** Bound original-byte transfers without modifying the owner's artwork. */
export function creativePage(assets:readonly CreativeVersion[],value:string|undefined){
 const size=12,pages=Math.max(1,Math.ceil(assets.length/size));
 const requested=value&&/^[1-9]\d{0,3}$/.test(value)?Number(value):1;
 const page=Math.min(requested,pages);
 return {items:assets.slice((page-1)*size,page*size),page,pages,total:assets.length};
}
