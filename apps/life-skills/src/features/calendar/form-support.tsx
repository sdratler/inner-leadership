'use client';
import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../../lib/locale.ts';
import { Input, Select, Button } from '../../ui/workspace/controls.tsx';
import { calendarWrite, CalendarClientError } from './client.ts';
import { possibleInstants, localMinute } from './time.ts';
import { text } from './copy.ts';
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
 return {run,busy,error,uncertain,locked:busy||uncertain,feedback};
}
/** Extend shared native-dialog behavior without editing its owner: confirm unsaved close, block close while outcome is uncertain. */
export function useDialogGuard(id:string,dirty:boolean,locked:boolean,locale:Locale,onClosed?:()=>void){
 useEffect(()=>{const dialog=document.getElementById(id);if(!(dialog instanceof HTMLDialogElement))return;
  const shouldClose=()=>!locked&&(!dirty||window.confirm(text(locale).dirty));
  const cancel=(e:Event)=>{if(!shouldClose())e.preventDefault();};
  const click=(e:MouseEvent)=>{const target=e.target instanceof Element?e.target.closest('button'):null;if(target===dialog.querySelector(':scope > header button')&&!shouldClose()){e.preventDefault();e.stopPropagation();}};
  const closed=()=>onClosed?.();dialog.addEventListener('cancel',cancel);dialog.addEventListener('click',click,true);dialog.addEventListener('close',closed);
  return()=>{dialog.removeEventListener('cancel',cancel);dialog.removeEventListener('click',click,true);dialog.removeEventListener('close',closed);};
 },[id,dirty,locked,locale,onClosed]);
}
