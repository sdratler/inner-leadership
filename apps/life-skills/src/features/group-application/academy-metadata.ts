import type {CampaignSnapshot} from './academy-campaign-contract.ts';
import {PREREG_CREATIVE} from './academy-campaign-contract.ts';
import {academyPath,type AcademyRouteMode} from "./academy-routing.ts";
import type {Locale} from "../../lib/locale.ts";


const names={en:"South Florida Jewish Leadership Fishing Academy",he:"האקדמיה לדיג ולמנהיגות יהודית בדרום פלורידה"};
/** Current serving URLs only. The requested BNA host route is not activated by
 * metadata: switch canonicals only with the verified host-routing release. */
export function academyMetadata(locale:Locale,path="",title?:string,mode:AcademyRouteMode="legacy",campaign:CampaignSnapshot|null=null){
 const pre=campaign?.phase==='PRE_REGISTRATION';
 const description=!pre?(locale==='he'?'הרשמה לאקדמיה לדיג ולמנהיגות יהודית בדרום פלורידה. הקבוצה, מועד הפתיחה והתשלום יתואמו בנפרד.':'Register for the South Florida Jewish Leadership Fishing Academy. Group, start date and payment are arranged separately.'):locale==='he'?'הרשמה חינמית לאקדמיה לדיג ולמנהיגות יהודית בדרום פלורידה. הזדמנות לתעריף משפחה מייסדת ל־30 המשפחות הזכאיות הראשונות. אין תשלום היום; מועד הפתיחה יתואם בהמשך.':'Pre-register for free for the South Florida Jewish Leadership Fishing Academy. Founding-family rate opportunity for the first 30 qualifying families. No payment today; start date to be arranged.';
 const url=(language:Locale)=>(mode==="bna"?"https://bneineviimacademy.org":"https://life-skills.bneineviimacademy.org")+academyPath(language,path,mode);
 const displayTitle=title?(pre?title:title.replace('Free Registration','Registration').replace('הרשמה חינמית','הרשמה')):undefined;
 return {title:title?`${pre?title:title.replace('Free Registration','Registration').replace('הרשמה חינמית','הרשמה')} | ${names[locale]}`:names[locale],description,
  alternates:{canonical:url(locale),languages:{en:url("en"),he:url("he")}},
  openGraph:{title:displayTitle??names[locale],description,url:url(locale),locale:locale==="he"?"he_IL":"en_US",alternateLocale:locale==="he"?["en_US"]:["he_IL"],type:"website" as const,...(pre?{images:[PREREG_CREATIVE.path]}:{})},
  robots:{index:false,follow:false}};
}
