import {academyPath,type AcademyRouteMode} from "./academy-routing.ts";
import type {Locale} from "../../lib/locale.ts";
import bilingual from "./academy-bilingual-copy.json";

const names={en:"South Florida Jewish Leadership Fishing Academy",he:"האקדמיה לדיג ולמנהיגות יהודית בדרום פלורידה"};
/** Current serving URLs only. The requested BNA host route is not activated by
 * metadata: switch canonicals only with the verified host-routing release. */
export function academyMetadata(locale:Locale,path="",title?:string,mode:AcademyRouteMode="legacy"){
 const url=(language:Locale)=>(mode==="bna"?"https://bneineviimacademy.org":"https://life-skills.bneineviimacademy.org")+academyPath(language,path,mode);
 return {title:title?`${title} | ${names[locale]}`:names[locale],description:bilingual.about[locale],
  alternates:{canonical:url(locale),languages:{en:url("en"),he:url("he")}},
  openGraph:{title:title??names[locale],description:bilingual.about[locale],url:url(locale),locale:locale==="he"?"he_IL":"en_US",alternateLocale:locale==="he"?["en_US"]:["he_IL"],type:"website" as const},
  robots:{index:false,follow:false}};
}
