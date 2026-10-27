import {academyExactCopy,academyExactCurriculum,academyExactStates} from './academy-exact-copy.ts';
import type {CampaignSnapshot} from './academy-campaign-contract.ts';
import {academyPath,type AcademyRouteMode} from "./academy-routing.ts";
import type {Locale} from "../../lib/locale.ts";


const names={en:"South Florida Jewish Leadership Fishing Academy",he:"האקדמיה לדיג ולמנהיגות יהודית בדרום פלורידה"};
const socialNames={en:"Jewish Leadership Fishing Academy",he:"האקדמיה לדיג ולמנהיגות יהודית"};
/** Current serving URLs only. The requested BNA host route is not activated by
 * metadata: switch canonicals only with the verified host-routing release. */
export function academyMetadata(locale:Locale,path="",title?:string,mode:AcademyRouteMode="legacy",campaign:CampaignSnapshot|null=null){
 const pre=campaign?.phase==='PRE_REGISTRATION',copy=academyExactCopy[locale].metadata;
 const stage=academyExactCurriculum.stages.find(item=>path===`/stages/${item.slug}`);
 const description=path==='/confirm-interest'?academyExactStates[locale].confirmation.text:path==='/apply'?(pre?copy.formDescriptionA:copy.formDescriptionB):path==='/pricing'?copy.pricingDescription:stage?.introduction[locale]??(pre?copy.landingDescriptionA:copy.landingDescriptionB);
 const url=(language:Locale)=>(mode==="bna"?"https://bneineviimacademy.org":"https://life-skills.bneineviimacademy.org")+academyPath(language,path,mode);
 // The client frame omits an explicit title. Resolve only registered page
 // identities so hydration and campaign refresh preserve server metadata.
 const routeTitle=path==='/confirm-interest'?academyExactStates[locale].confirmation.heading+' | '+copy.landingTitle:path==='/pricing'?copy.pricingTitle:path==='/apply'?(pre?copy.formTitleA:copy.formTitleB):stage?copy.curriculumTitle.replace('{stage_title}',stage.title[locale]):path===''?copy.landingTitle:undefined;
 const logo=new URL("/groups/brand/jlfa-logo-locked-v1.png",url(locale)).href;
 const displayTitle=routeTitle??(title?`${title} | ${names[locale]}`:copy.landingTitle);
 const socialTitle=socialNames[locale],socialDescription=academyExactCopy[locale].hero.pillars;
 return {title:displayTitle,description,
  alternates:{canonical:url(locale),languages:{en:url("en"),he:url("he")}},
  openGraph:{title:socialTitle,description:socialDescription,url:url(locale),locale:locale==="he"?"he_IL":"en_US",alternateLocale:locale==="he"?["en_US"]:["he_IL"],type:"website" as const,images:[{url:logo,alt:names[locale]}]},
  twitter:{card:"summary" as const,title:socialTitle,description:socialDescription,images:[logo]},
  icons:{icon:[{url:logo,type:"image/png"}],apple:[{url:logo,type:"image/png"}]},
  robots:{index:false,follow:false}};
}
