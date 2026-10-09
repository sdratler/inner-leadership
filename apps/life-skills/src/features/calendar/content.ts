import {AppError} from '../../lib/errors.ts';
import type {Locale} from '../../lib/locale.ts';
import type {MarketingSnapshot,Publication} from '../marketing-overview/contracts.ts';
import {registeredCreativeRevision,validateMarketingSnapshot} from '../marketing-overview/read-model.ts';
import {publicationDisplayTime,publicationStatusText} from '../marketing-overview/calendar-model.ts';
import {civilDate,localMinute,ms} from './time.ts';
export type CalendarContent={id:string;assetId:string;revision:number;digest:string;title:string;locale:Locale|null;channel:Publication['channel'];state:Publication['state'];at:string;date:string;localTime:string;status:{en:string;he:string};assetAvailable:boolean;errorCode:string|null};
export type CalendarContentRead={fetchedAt:string|null;partial:boolean;items:CalendarContent[];undated:number};
export function calendarContentRange(from:string,to:string){
 const start=ms(from),end=ms(to);if(end<=start||end-start>63*86_400_000)throw new AppError('INVALID_REQUEST');return{start,end};
}
/** A projection of existing Marketing IDs/times only. No calendar events,
 * booking capacity, approval, publication or task/source mutation. */
export function calendarContent(snapshot:MarketingSnapshot,from:string,to:string):CalendarContentRead{
 const {start,end}=calendarContentRange(from,to);
 try{validateMarketingSnapshot(snapshot);}catch{throw new AppError('UNAVAILABLE');}
 if(snapshot.source==='synthetic'||snapshot.fetchedAt===null)throw new AppError('UNAVAILABLE');
 const seen=new Set<string>(),items:CalendarContent[]=[],assets=new Map(snapshot.creatives.map(a=>[`${a.assetId}:${a.revision}:${a.contentDigest}`,a]));let undated=0;
 for(const p of snapshot.publications){
  if(seen.has(p.id)||p.id.length>200)throw new AppError('UNAVAILABLE');seen.add(p.id);
  const at=publicationDisplayTime(p);if(!at){undated++;continue;}
  const instant=ms(at);if(instant<start||instant>=end)continue;
  const asset=assets.get(`${p.assetId}:${p.creativeRevision}:${p.creativeDigest}`);
  items.push({id:p.id,assetId:p.assetId,revision:p.creativeRevision,digest:p.creativeDigest,title:asset?.title||p.assetId,locale:asset?.locale??null,channel:p.channel,state:p.state,at,date:civilDate(at),localTime:localMinute(at).slice(11),status:{en:publicationStatusText(p,snapshot.creatives,'en'),he:publicationStatusText(p,snapshot.creatives,'he')},assetAvailable:Boolean(asset&&registeredCreativeRevision(asset)),errorCode:p.errorCode});
 }
 items.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id));
 return{fetchedAt:snapshot.fetchedAt,partial:snapshot.inventory?.partial??true,items,undated};
}
export function calendarContentHref(item:CalendarContent,locale:Locale):string{
 return `/${locale}/app/marketing?`+new URLSearchParams({section:'content_calendar',publication:item.id,date:item.date,month:item.date.slice(0,7),layout:'agenda'});
}
