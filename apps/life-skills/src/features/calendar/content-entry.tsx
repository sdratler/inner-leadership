import type {Locale} from '../../lib/locale.ts';
import {calendarContentHref,type CalendarContent} from './content.ts';
const channels={whatsapp_status:{en:'WhatsApp Status',he:'סטטוס WhatsApp'},facebook_page:{en:'Facebook feed',he:'פיד Facebook'},instagram:{en:'Instagram',he:'Instagram'},facebook_group_manual:{en:'Facebook group · manual',he:'קבוצת Facebook · ידני'},whatsapp_group_manual:{en:'WhatsApp group · manual',he:'קבוצת WhatsApp · ידני'}};
export function CalendarContentEntry({item,locale}:{item:CalendarContent;locale:Locale}){
 return <article className="ls-cal-content" data-publication-id={item.id}>
  <span>{locale==='he'?'תוכן':'Content'} · {channels[item.channel][locale]}{item.locale?` · ${item.locale==='he'?(locale==='he'?'עברית':'Hebrew'):(locale==='he'?'אנגלית':'English')}`:''}</span>
  <strong>{item.title|| (locale==='he'?'פריט מקור ללא נכס תואם':'Source record without a matched asset')}</strong>
  <time dateTime={item.at}><bdi>{item.date} · {item.localTime}</bdi></time>
  <span>{item.status[locale]}</span>
  {!item.assetAvailable&&<span>{locale==='he'?'גרסת הנכס המדויקת אינה זמינה':'Exact asset revision is unavailable'}</span>}
  {item.errorCode&&<p role="alert">{locale==='he'?'דורש טיפול':'Attention needed'}: {item.errorCode}</p>}
  <a href={calendarContentHref(item,locale)}>{locale==='he'?'פתיחת רשומת התוכן':'Open content record'}</a>
 </article>;
}
