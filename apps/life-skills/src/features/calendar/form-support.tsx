'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Locale } from '../../lib/locale.ts';
import { Input, Select, Button } from '../../ui/workspace/controls.tsx';
import { calendarWrite, CalendarClientError } from './client.ts';
import { possibleInstants, localMinute } from './time.ts';
import { text } from './copy.ts';
import { finalizeDialogClose } from '../../ui/workspace/dialogs.tsx';
export interface WallTime {wall:string;choice:string;}
export function wallTime(instant?:string):WallTime{return {wall:instant?localMinute(instant):'',choice:instant??''};}
export function resolveWall(value:WallTime):string {
 if(!value.wall)return '';let options:string[];try{options=possibleInstants(value.wall);}catch{return '';}
 return options.length===1?options[0]!:options.includes(value.choice)?value.choice:'';
}
export function ZonedInput({id,label,value,onChange,locale,required=false}:{id:string;label:string;value:WallTime;onChange:(v:WallTime)=>void;locale:Locale;required?:boolean}){
 const t=text(locale);let options:string[]=[];try{if(value.wall)options=possibleInstants(value.wall);}catch{}
 return <div><Input id={id} label={label} type="datetime-local" step="60" value={value.wall} onChange={e=>onChange({wall:e.target.value,choice:''})} required={required} help={t.zone} error={value.wall&&options.length===0?t.gap:undefined}/>
 {options.length>1&&<Select id={id+'-fold'} label={t.fold} value={value.choice} onChange={e=>onChange({...value,choice:e.target.value})} required><option value="">{t.chooseOccurrence}</option>{options.map(o=><option value={o} key={o}>{t.offset}: {o}</option>)}</Select>}</div>;
}
export function errorText(code:string,locale:Locale){const t=text(locale);return code==='CONFLICT'?t.conflict:['FORBIDDEN','NOT_FOUND','UNAUTHENTICATED'].includes(code)?t.forbidden:code==='INVALID_REQUEST'?t.invalid:code==='UNAVAILABLE'?t.unavailable:t.saveFailed;}
type Action={path:string;body:unknown;key:string;method:'POST'|'PATCH';done:(value:unknown)=>void|Promise<void>};
export function useCalendarMutation(locale:Locale){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false),[saved,setSaved]=useState(false);
 const action=useRef<Action|null>(null),inFlight=useRef(false);
 async function execute(a:Action){
  if(inFlight.current)return;inFlight.current=true;setBusy(true);setSaved(false);setError('');
  let committed=false;
  try{const result=await calendarWrite<unknown>(a.path,a.body,a.key,a.method);committed=true;setUncertain(false);action.current=null;setSaved(true);await a.done(result);}
  catch(e){const code=e instanceof CalendarClientError?e.code:'UNAVAILABLE';setError(code);setUncertain(!committed&&['UNAVAILABLE','INTERNAL'].includes(code));if(committed)action.current=null;}
  finally{inFlight.current=false;setBusy(false);}
 }
 function run(path:string,body:unknown,done:Action['done'],method:'POST'|'PATCH'='POST'){
  if(inFlight.current||uncertain)return;
  const serialized=JSON.stringify(body),previous=action.current;
  const a:Action=previous&&previous.path===path&&JSON.stringify(previous.body)===serialized&&previous.method===method?{...previous,done}:{path,body,key:crypto.randomUUID(),method,done};
  action.current=a;void execute(a);
 }
 const feedback=<div className="ls-cal-feedback" role="status" aria-live="polite">{busy?text(locale).loading:error?errorText(error,locale):saved?text(locale).saved:null}
 {uncertain&&<><p>{text(locale).uncertain}</p><Button busy={busy} onClick={()=>{if(action.current)void execute(action.current);}}>{text(locale).retry}</Button></>}</div>;
 function clearFeedback(){if(inFlight.current||uncertain)return;action.current=null;setError('');setSaved(false);}
 return {run,busy,error,uncertain,locked:busy||uncertain,feedback,clearFeedback};
}
/** Extend shared native-dialog behavior without editing its owner: confirm unsaved close, block close while outcome is uncertain. */
export function guardCalendarDialogEscape(event:Pick<KeyboardEvent,'key'|'preventDefault'|'stopPropagation'>,requestClose:()=>void):boolean{
 if(event.key!=='Escape')return false;
 // Prevent the browser's close request BEFORE opening a blocking confirmation.
 // A later close-watcher cancel event can be noncancelable, losing the draft.
 event.preventDefault();event.stopPropagation();requestClose();return true;
}
export function useDialogGuard(id:string,dirty:boolean,locked:boolean,locale:Locale,onClosed?:()=>void){
 const current=useRef({dirty,locked,locale,onClosed});
 useLayoutEffect(()=>{current.current={dirty,locked,locale,onClosed};},[dirty,locked,locale,onClosed]);
 useEffect(()=>{const dialog=document.getElementById(id);if(!(dialog instanceof HTMLDialogElement))return;
  const requestClose=()=>{const value=current.current;if(!value.locked&&(!value.dirty||window.confirm(text(value.locale).dirty)))dialog.close();};
  const key=(e:KeyboardEvent)=>{if(dialog.open)guardCalendarDialogEscape(e,requestClose);};
  const cancel=(e:Event)=>{e.preventDefault();requestClose();};
  const click=(e:MouseEvent)=>{const target=e.target instanceof Element?e.target.closest('button'):null;if(target===dialog.querySelector(':scope > header button')){e.preventDefault();e.stopPropagation();requestClose();}};
  const closed=()=>finalizeDialogClose(dialog,()=>current.current.onClosed?.());dialog.addEventListener('keydown',key,true);dialog.addEventListener('cancel',cancel);dialog.addEventListener('click',click,true);dialog.addEventListener('close',closed);
  return()=>{dialog.removeEventListener('keydown',key,true);dialog.removeEventListener('cancel',cancel);dialog.removeEventListener('click',click,true);dialog.removeEventListener('close',closed);};
 },[id]);
}
