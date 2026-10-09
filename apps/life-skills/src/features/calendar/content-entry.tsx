import type {Locale} from '../../lib/locale.ts';
import {calendarContentHref,type CalendarContent} from './content.ts';
const channels={whatsapp_status:{en:'WhatsApp Status',he:'סטטוס WhatsApp'},facebook_page:{en:'Facebook feed',he:'פיד Facebook'},instagram:{en:'Instagram',he:'Instagram'},facebook_group_manual:{en:'Facebook group · manual',he:'קבוצת Facebook · ידני'},whatsapp_group_manual:{en:'WhatsApp group · manual',he:'קבוצת WhatsApp · ידני'}};
export function CalendarContentEntry({item,locale,compact=false}:{item:CalendarContent;locale:Locale;compact?:boolean}){
 return <article className="ls-cal-content" data-publication-id={item.id}>
  <span>{locale==='he'?'תוכן':'Content'}{!compact&&` · ${channels[item.channel][locale]}`}{item.locale?` · ${item.locale==='he'?(locale==='he'?'עברית':'Hebrew'):(locale==='he'?'אנגלית':'English')}`:''}</span>
  <strong>{item.title|| (locale==='he'?'פריט מקור ללא נכס תואם':'Source record without a matched asset')}</strong>
  <time dateTime={item.at}><bdi>{!compact&&`${item.date} · `}{item.localTime}</bdi></time>
  <span>{item.status[locale]}</span>
  {!item.assetAvailable&&<span>{locale==='he'?'גרסת הנכס המדויקת אינה זמינה':'Exact asset revision is unavailable'}</span>}
  {item.errorCode&&<p role="alert">{locale==='he'?'דורש טיפול':'Attention needed'}: {item.errorCode}</p>}
  {compact&&<details><summary>{locale==='he'?'ערוץ התוכן':'Content channel'}</summary><span>{channels[item.channel][locale]}</span></details>}
  <a href={calendarContentHref(item,locale)}>{locale==='he'?'פתיחת רשומת התוכן':'Open content record'}</a>
 </article>;
}
