import candidates from "./email-candidates.json";

type Locale="en"|"he";
type Binding="FIRST_NAME"|"REFERENCE"|"ARTICLES_URL"|"SUPPORT_URL"|"PREFERENCES_URL";
export const bnaEmailCandidates=candidates;

/** Plain-text review output only. Trigger descriptions do not schedule delivery. */
export function previewBnaEmailCandidate(id:string,locale:Locale,bindings:Partial<Record<Binding,string>>){
 const message=candidates.messages.find(value=>value.id===id);
 if(!message||!['en','he'].includes(locale))throw Error("BNA_EMAIL_CANDIDATE_UNKNOWN");
 const copy=message.content[locale];
 const resolve=(key:string)=>{
  if(!['FIRST_NAME','REFERENCE','ARTICLES_URL','SUPPORT_URL','PREFERENCES_URL'].includes(key))throw Error("BNA_EMAIL_BINDING_UNKNOWN");
  const value=(bindings[key as Binding]??"").trim();
  if(key==='FIRST_NAME'&&!value)return '';
  if(!value||value.length>1000||/[\r\n]|\{\{|\}\}/.test(value))throw Error("BNA_EMAIL_BINDING_INVALID");
  if(key.endsWith('_URL')){let url:URL;try{url=new URL(value);}catch{throw Error("BNA_EMAIL_URL_INVALID");}
   if(url.protocol!=='https:'||!['bneineviimacademy.org','life-skills.bneineviimacademy.org'].includes(url.hostname)||url.username||url.password||url.port||url.search||url.hash)throw Error("BNA_EMAIL_URL_INVALID");}
  return value;
 };
 const replace=(text:string)=>text.replace(/\{\{([A-Z_]+)\}\}/g,(_match,key:string)=>resolve(key));
 const body=replace(copy.body).replace(/^Hi ,/,'Hi,').replace(/^שלום ,/,'שלום,');
 return {id:message.id,status:'review_candidate' as const,locale,subject:replace(copy.subject),body,trigger:message.trigger,
  sourceSha256:candidates.sourceSha256,copySha256:message.copySha256};
}
