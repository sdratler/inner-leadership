import type {Locale} from '../../lib/locale.ts';

export type FishingOwnerDestination = 'inquiries'|'family_contacts'|'groups_calendar'|'marketing'|'settings';
export type FishingOwnerUnavailableArea = 'overview'|'billing'|'communications';
export type FishingOwnerUnavailableReason = 'not_connected'|'setup_required'|'temporarily_unavailable'|'availability_unconfirmed';
export type FishingOwnerAvailability = Readonly<Partial<Record<FishingOwnerDestination,
 {readonly state:'available'}|{readonly state:'unavailable';readonly reason:FishingOwnerUnavailableReason}>>>;

/** Presentation input only. Root must derive this on the server from the actual
 * Fishing workspace, and enforce scope again on every destination and API.
 * A role, title, URL query or this menu itself never grants owner access. */
export type FishingOwnerNavigationInput = {
 readonly mode:'fishing_owner';
 readonly locale:Locale;
 readonly availability:FishingOwnerAvailability;
 readonly currentDestination?:FishingOwnerDestination;
 readonly unavailableAreas?:Readonly<Partial<Record<FishingOwnerUnavailableArea,
  {readonly state:'unavailable';readonly reason:FishingOwnerUnavailableReason}>>>;
}|{readonly mode:'unavailable';readonly locale:Locale};

export type FishingOwnerNavigationItem = {
 readonly key:FishingOwnerDestination;readonly label:string;
} & ({readonly state:'available';readonly href:string;readonly current:boolean}|
 {readonly state:'unavailable';readonly reason:string});
export type FishingOwnerNavigationArea = {
 readonly key:'families'|'groups_calendar'|'marketing'|'settings'|FishingOwnerUnavailableArea;
 readonly label:string;readonly items:readonly FishingOwnerNavigationItem[];readonly reason?:string;
};
export type FishingOwnerNavigationModel = {
 readonly locale:Locale;readonly heading:string;readonly contextLabel:string;readonly navigationLabel:string;
 readonly areas:readonly FishingOwnerNavigationArea[];
};

const destinations:Readonly<Record<FishingOwnerDestination,{path:string;en:string;he:string}>>={
 inquiries:{path:'app/group-applications',en:'Fishing inquiries',he:'פניות לדיג'},
 family_contacts:{path:'app/clients',en:'Families & contacts',he:'משפחות ואנשי קשר'},
 groups_calendar:{path:'app/fishing-groups',en:'Groups & calendar',he:'קבוצות ויומן'},
 marketing:{path:'app/marketing',en:'Marketing',he:'שיווק'},
 settings:{path:'app/settings',en:'Settings',he:'הגדרות'},
};
const areaLabels:Readonly<Record<FishingOwnerUnavailableArea,{en:string;he:string}>>={
 overview:{en:'Overview',he:'סקירה'},billing:{en:'Billing',he:'חיובים ותשלומים'},communications:{en:'Communications',he:'תקשורת'},
};
const reasons:Readonly<Record<FishingOwnerUnavailableReason,{en:string;he:string}>>={
 not_connected:{en:'This work area is not connected to Fishing yet.',he:'אזור העבודה הזה עדיין אינו מחובר לאקדמיית הדיג.'},
 setup_required:{en:'Setup is required before this work area can be opened.',he:'יש להשלים את ההגדרה לפני פתיחת אזור העבודה הזה.'},
 temporarily_unavailable:{en:'This work area is temporarily unavailable.',he:'אזור העבודה הזה אינו זמין כרגע.'},
 availability_unconfirmed:{en:'Availability has not been confirmed for this Fishing workspace.',he:'הזמינות באזור הניהול של אקדמיית הדיג טרם אומתה.'},
};
function record(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value);}
function own(value:unknown,key:string):unknown{return record(value)&&Object.hasOwn(value,key)?value[key]:undefined;}
function reason(value:unknown,locale:Locale):string{
 return typeof value==='string'&&Object.hasOwn(reasons,value)?reasons[value as FishingOwnerUnavailableReason][locale]:reasons.availability_unconfirmed[locale];
}

/** Fixed existing routes only; callers cannot supply paths or enable unfinished
 * Overview/Billing/Communications routes. Missing/malformed availability is closed. */
export function fishingOwnerNavigation(input:FishingOwnerNavigationInput):FishingOwnerNavigationModel|null{
 const raw:unknown=input,locale=own(raw,'locale');
 if(own(raw,'mode')!=='fishing_owner'||(locale!=='en'&&locale!=='he'))return null;
 const availability=own(raw,'availability'),current=own(raw,'currentDestination');
 const item=(key:FishingOwnerDestination):FishingOwnerNavigationItem=>{
  const definition=destinations[key],capability=own(availability,key),base={key,label:definition[locale]};
  return own(capability,'state')==='available'?{...base,state:'available',href:`/${locale}/${definition.path}`,current:current===key}:
   {...base,state:'unavailable',reason:reason(own(capability,'state')==='unavailable'?own(capability,'reason'):undefined,locale)};
 };
 const areas:FishingOwnerNavigationArea[]=[];
 const unavailable=(key:FishingOwnerUnavailableArea)=>{
  const capability=own(own(raw,'unavailableAreas'),key),code=own(capability,'reason');
  // Optional future areas are shown only with a real, explicit unavailable reason.
  if(own(capability,'state')==='unavailable'&&typeof code==='string'&&Object.hasOwn(reasons,code)){
   areas.push({key,label:areaLabels[key][locale],items:[],reason:reason(code,locale)});
  }
 };
 unavailable('overview');
 areas.push({key:'families',label:locale==='he'?'משפחות':'Families',items:[item('inquiries'),item('family_contacts')]});
 areas.push({key:'groups_calendar',label:destinations.groups_calendar[locale],items:[item('groups_calendar')]});
 unavailable('billing');unavailable('communications');
 areas.push({key:'marketing',label:destinations.marketing[locale],items:[item('marketing')]});
 areas.push({key:'settings',label:destinations.settings[locale],items:[item('settings')]});
 return {locale,heading:locale==='he'?'אקדמיית הדיג':'Fishing Academy',contextLabel:locale==='he'?'סביבת ניהול':'Owner workspace',
  navigationLabel:locale==='he'?'אזורי העבודה של אקדמיית הדיג':'Fishing Academy work areas',areas};
}
