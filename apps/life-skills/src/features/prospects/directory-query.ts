/** Shared bounded URL context for the existing Sheet and native directories. */
export type DirectoryFilters={query:string;stage:string;language:string;due:"any"|"today"|"overdue"};
export function oneDirectoryQuery(params:URLSearchParams,key:string):string|undefined{
 const values=params.getAll(key);return values.length===1?values[0]:undefined;
}
export function peoplePageFromQuery(params:URLSearchParams):number{
 const raw=oneDirectoryQuery(params,"page");return raw&&/^[1-9]\d{0,4}$/.test(raw)?Number(raw):1;
}
export function peopleFiltersFromQuery(params:URLSearchParams):DirectoryFilters{
 const search=oneDirectoryQuery(params,"search")??"",stage=oneDirectoryQuery(params,"stage")??"",language=oneDirectoryQuery(params,"language")??"",due=oneDirectoryQuery(params,"due")??"any";
 return {query:search.length<=200?search:"",stage:stage.length<=120?stage:"",language:language==="he"||language==="en"?language:"",due:due==="today"||due==="overdue"?due:"any"};
}
export function directoryQuery(params:URLSearchParams,filters:DirectoryFilters,page=1):URLSearchParams{
 const result=new URLSearchParams(params);
 for(const [key,value] of [["search",filters.query],["stage",filters.stage],["language",filters.language],["due",filters.due==="any"?"":filters.due],["page",page>1?String(page):""]] as const){
  result.delete(key);if(value)result.set(key,value);
 }
 return result;
}
