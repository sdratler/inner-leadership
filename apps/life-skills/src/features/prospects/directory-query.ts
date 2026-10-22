/** Shared bounded URL context for the existing Sheet and native directories. */
export type DirectoryFilters={query:string;stage:string;language:string;due:"any"|"today"|"overdue";
 program?:"sunday_fishing_academy";leadStatus?:"new"|"contacted"|"interested"|"callback_requested"|"follow_up"|"closed"};
export function oneDirectoryQuery(params:URLSearchParams,key:string):string|undefined{
 const values=params.getAll(key);return values.length===1?values[0]:undefined;
}
export function peoplePageFromQuery(params:URLSearchParams):number{
 const raw=oneDirectoryQuery(params,"page");return raw&&/^[1-9]\d{0,4}$/.test(raw)?Number(raw):1;
}
export function peopleFiltersFromQuery(params:URLSearchParams):DirectoryFilters{
 const search=oneDirectoryQuery(params,"search")??"",stage=oneDirectoryQuery(params,"stage")??"",language=oneDirectoryQuery(params,"language")??"",due=oneDirectoryQuery(params,"due")??"any";
 const program=oneDirectoryQuery(params,"program"),status=oneDirectoryQuery(params,"leadStatus"),academy=program==="sunday_fishing_academy";
 const leadStatus=status&&["new","contacted","interested","callback_requested","follow_up","closed"].includes(status)?status as DirectoryFilters["leadStatus"]:undefined;
 return {query:search.length<=200?search:"",stage:academy?"":stage.length<=120?stage:"",language:language==="he"||language==="en"?language:"",due:due==="today"||due==="overdue"?due:"any",
  ...(academy?{program,...(leadStatus?{leadStatus}:{})}:{})};
}
export function directoryQuery(params:URLSearchParams,filters:DirectoryFilters,page=1):URLSearchParams{
 const result=new URLSearchParams(params);
 for(const [key,value] of [["search",filters.query],["stage",filters.program?"":filters.stage],["language",filters.language],["due",filters.due==="any"?"":filters.due],["page",page>1?String(page):""],["program",filters.program??""],["leadStatus",filters.program?filters.leadStatus??"":""]] as const){
  result.delete(key);if(value)result.set(key,value);
 }
 if(filters.program){result.delete("filter");result.set("section","all");}
 return result;
}
