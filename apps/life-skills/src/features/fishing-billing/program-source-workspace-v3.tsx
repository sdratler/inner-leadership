'use client';
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {Button,Input,Select} from '../../ui/workspace/controls.tsx';
import type {ErrorCode} from '../../lib/errors.ts';
import {billingId} from './contracts.ts';
import type {ProgramSourceRecordV3} from './program-source-contract-v3.ts';
import type {ProgramSourceGroupDataV3} from './program-source-owner-contract-v3.ts';
import {
 createProgramSourceClientV3,prepareProgramLessonSaveV3,programLessonInputsV3,programSourceSavedHeadV3,ProgramLessonInputErrorV3,
 type PreparedProgramSourceSaveV3,type ProgramLessonInputsV3,type ProgramSourceReadResultV3,type ProgramSourceSaveResultV3,
} from './program-source-client-v3.ts';
import styles from './program-source-workspace-v3.module.css';

type Locale='en'|'he';
type View={key:string;active:boolean};
type ReadCompletion={view:View;run:number;controller:AbortController;result:ProgramSourceReadResultV3};
type Pending={save:PreparedProgramSourceSaveV3;uncertain:boolean};
type Message={kind:'error';code:ErrorCode}|{kind:'time';reason:'invalid'|'ambiguous'|'nonexistent'}|
 {kind:'notice';value:'unchanged'|'unconfirmed'|'confirmed'};
type Editor={key:string;record:ProgramSourceRecordV3|null;inputs:ProgramLessonInputsV3};
export function retainProgramSourceOperationV3(pending:Pending,result:ProgramSourceSaveResultV3):Pending|null{
 return result.state==='saved'?null:result.state==='unknown'||pending.uncertain?{save:pending.save,uncertain:true}:null;
}
export function programSourceErrorV3(code:ErrorCode,locale:Locale){
 const text={
  UNAUTHENTICATED:['Your session ended. Sign in again, then reload or retry the same save.','פג תוקף החיבור. יש להתחבר מחדש ואז לרענן או לנסות שוב את אותה שמירה.'],
  FORBIDDEN:['This account cannot access the saved Fishing schedule.','לחשבון הזה אין גישה ללוח הזמנים השמור של קבוצות הדיג.'],
  NOT_FOUND:['The saved schedule is not available.','לוח הזמנים השמור אינו זמין.'],
  CONFLICT:['The schedule changed or a lesson overlaps another lesson. Reload before making a new edit.','לוח הזמנים השתנה או ששיעור חופף לשיעור אחר. יש לרענן לפני עריכה חדשה.'],
  INVALID_REQUEST:['Check the lesson number, status and Florida start and end times.','יש לבדוק את מספר השיעור, מצבו וזמני ההתחלה והסיום בפלורידה.'],
  RATE_LIMITED:['Too many requests. Wait a moment, then reload or retry the same save.','בוצעו בקשות רבות מדי. המתינו מעט ואז רעננו או נסו שוב את אותה שמירה.'],
  UNAVAILABLE:['The schedule could not be confirmed. This does not mean there are no lessons.','לא ניתן לאמת את לוח הזמנים. אין פירוש הדבר שאין שיעורים.'],
  INTERNAL:['The request could not be confirmed. Reload or check the original save.','לא ניתן לאמת את הבקשה. יש לרענן או לבדוק את השמירה המקורית.'],
  PAYLOAD_TOO_LARGE:['The save could not be accepted. Review the entered details.','לא ניתן לקבל את השמירה. יש לבדוק את הפרטים שהוזנו.'],
  UNSUPPORTED_MEDIA_TYPE:['The save could not be accepted. Reload before editing again.','לא ניתן לקבל את השמירה. יש לרענן לפני עריכה נוספת.'],
 } satisfies Record<ErrorCode,readonly[string,string]>;
 return text[code][locale==='he'?1:0];
}
function time(value:string,locale:Locale){return new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-US',{
 timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short',
}).format(new Date(value));}
function readiness(value:string,locale:Locale){
 const t=(en:string,he:string)=>locale==='he'?he:en;
 switch(value){
  case 'needs_foundation':return t('Needs the foundation lessons','נדרשים שיעורי הבסיס');
  case 'foundation_one_complete':return t('First foundation lesson complete','שיעור הבסיס הראשון הושלם');
  case 'foundation_complete':return t('Foundation lessons complete','שיעורי הבסיס הושלמו');
  case 'verified_catchup':return t('Catch-up verified','השלמת הפערים אומתה');
  default:throw new Error('INVALID_READINESS');
 }
}
export function ProgramSourceLessonsV3({data,locale,edit,limit=25}:{data:ProgramSourceGroupDataV3;locale:Locale;edit?:((record:ProgramSourceRecordV3)=>void)|undefined;limit?:number}){
 const t=(en:string,he:string)=>locale==='he'?he:en;
 const lessons=[...data.lessons].sort((a,b)=>{
  const x=a.record.command,y=b.record.command;if(x.kind!=='lesson'||y.kind!=='lesson')throw new Error('INVALID_LESSONS');
  return Date.parse(x.fields.startsAt)-Date.parse(y.fields.startsAt)||x.id.localeCompare(y.id);
 });
 return <section aria-labelledby="program-lessons-title"><h3 id="program-lessons-title">{t('Saved lessons','שיעורים שמורים')}</h3>
  <p className="lsw-help">{t('All lesson times are in Florida time.','כל זמני השיעורים הם לפי שעון פלורידה.')}</p>
  {lessons.length===0?<p>{t('No lessons have been saved for this schedule.','לא נשמרו שיעורים בלוח הזמנים הזה.')}</p>:<>
   <p className="lsw-help">{t('Showing','מוצגים')} <bdi>{Math.min(limit,lessons.length)}</bdi> {t('of','מתוך')} <bdi>{lessons.length}</bdi></p>
   <ol className={styles.lessons}>{lessons.slice(0,limit).map(item=>{
    const record=item.record,c=record.command;if(c.kind!=='lesson')throw new Error('INVALID_LESSON');
    return <li key={c.id} className={styles.lesson}><div className={styles.row}><h4>{t('Lesson','שיעור')} <bdi>{c.fields.sequence}</bdi></h4>
     <span>{c.fields.state==='scheduled'?t('Scheduled','מתוכנן'):t('Cancelled','בוטל')}</span></div>
     <dl className={styles.facts}><div><dt>{t('Starts','התחלה')}</dt><dd><time dateTime={c.fields.startsAt}>{time(c.fields.startsAt,locale)}</time></dd></div>
      <div><dt>{t('Ends','סיום')}</dt><dd><time dateTime={c.fields.endsAt}>{time(c.fields.endsAt,locale)}</time></dd></div>
      <div><dt>{t('Saved revision','גרסה שמורה')}</dt><dd><bdi>{record.revision}</bdi></dd></div></dl>
     {edit&&<Button variant="secondary" onClick={()=>edit(record)}>{t('Edit lesson','עריכת השיעור')}</Button>}
    </li>;
   })}</ol>
  </>}
 </section>;
}
export function ProgramSourceSummaryV3({data,locale}:{data:ProgramSourceGroupDataV3;locale:Locale}){
 const t=(en:string,he:string)=>locale==='he'?he:en,c=data.group.record.command;
 if(c.kind!=='group')throw new Error('INVALID_GROUP_SOURCE');
 const counts=new Map<string,number>();let withdrawn=0;
 for(const item of data.progressions){const command=item.record.command;if(command.kind!=='progression')throw new Error('INVALID_PROGRESSION');
  if(command.fields.state==='withdrawn')withdrawn++;else counts.set(command.fields.readiness,(counts.get(command.fields.readiness)??0)+1);
 }
 return <>
  <dl className={styles.facts}><div><dt>{t('Schedule status','מצב לוח הזמנים')}</dt><dd>{c.fields.state==='forming'?t('In preparation','בהכנה'):t('Cancelled','בוטל')}</dd></div>
   <div><dt>{t('Saved location','המקום השמור')}</dt><dd>{c.fields.location}</dd></div>
   <div><dt>{t('Saved revision','גרסה שמורה')}</dt><dd><bdi>{data.group.record.revision}</bdi></dd></div></dl>
  <section aria-labelledby="program-readiness-title"><h3 id="program-readiness-title">{t('Saved participant readiness','מוכנות משתתפים שמורה')}</h3>
   {data.progressions.length===0?<p>{t('No participant plans have been saved for this schedule.','לא נשמרו תוכניות משתתפים בלוח הזמנים הזה.')}</p>:
    <dl className={styles.facts}>{[...counts].map(([value,count])=><div key={value}><dt>{readiness(value,locale)}</dt><dd><bdi>{count}</bdi></dd></div>)}
     {withdrawn>0&&<div><dt>{t('Withdrawn plans','תוכניות שבוטלו')}</dt><dd><bdi>{withdrawn}</bdi></dd></div>}</dl>}
  </section>
 </>;
}
/** Stays mounted while the surrounding group draft reloads; UNKNOWN belongs to
 * its original immutable operation, not to the currently selected group. */
export function ProgramSourceWorkspaceV3({locale,groupId,groupLabel,readOnly=false,onLockChange}:{locale:Locale;groupId?:string|undefined;groupLabel?:string|undefined;
 readOnly?:boolean|undefined;onLockChange?:((locked:boolean)=>void)|undefined}){
 const t=(en:string,he:string)=>locale==='he'?he:en,key=(groupId??'')+':'+readOnly;
 const valid=!!groupId&&billingId.safeParse(groupId).success&&groupId===groupId.toLowerCase();
 const client=useMemo(()=>createProgramSourceClientV3(),[]);
 const [loaded,setLoaded]=useState<{key:string;result:ProgramSourceReadResultV3}|null>(null);
 const [pending,setPending]=useState<Pending|null>(null),[busy,setBusy]=useState(false),[editor,setEditor]=useState<Editor|null>(null);
 const [message,setMessage]=useState<Message|null>(null),[feedbackVersion,setFeedbackVersion]=useState(0),[limit,setLimit]=useState(25);
 const pendingRef=useRef<Pending|null>(null),busyRef=useRef(false),viewRef=useRef<View>({key,active:false}),serial=useRef(0),attemptRef=useRef<object|null>(null);
 const readAbort=useRef<AbortController|null>(null),saveAbort=useRef<AbortController|null>(null),feedback=useRef<HTMLElement>(null);
 const recovery=!!pending?.uncertain;
 const current=(view:View)=>viewRef.current===view&&view.active;
 const updatePending=(value:Pending|null)=>{pendingRef.current=value;setPending(value);};
 const report=(value:Message)=>{setMessage(value);setFeedbackVersion(n=>n+1);};
 useEffect(()=>{onLockChange?.(pending!==null||(editor!==null&&editor.key===key));},[pending,editor,key,onLockChange]);
 useEffect(()=>{if(message||recovery){feedback.current?.focus({preventScroll:true});feedback.current?.scrollIntoView({block:'start'});}},[message,recovery,feedbackVersion]);
 useLayoutEffect(()=>{
  const view:View={key,active:true};viewRef.current=view;
  return()=>{
   view.active=false;
   if(viewRef.current.key===key){viewRef.current.active=false;viewRef.current={...viewRef.current,active:false};}
   readAbort.current?.abort();saveAbort.current?.abort();
  };
 },[key]);
 const loseAccess=useCallback(()=>{
  viewRef.current={...viewRef.current};serial.current++;readAbort.current?.abort();setEditor(null);
 },[]);
 const requestRead=useCallback(async():Promise<ReadCompletion|undefined>=>{
  const view=viewRef.current;if(!valid||!groupId||!view.active||view.key!==key)return;
  const run=++serial.current;readAbort.current?.abort();const controller=new AbortController();readAbort.current=controller;
  const result=await client.group(groupId,controller.signal);
  return {view,run,controller,result};
 },[client,groupId,key,valid]);
 const applyRead=useCallback((completion:ReadCompletion|undefined)=>{
  if(!completion)return;
  const {view,run,controller,result}=completion;
  if(viewRef.current!==view||!view.active||run!==serial.current||controller.signal.aborted)return;
  setLoaded({key:view.key,result});setLimit(25);setEditor(null);
  if(result.state==='failed'){
   setEditor(null);
   if(result.code==='UNAUTHENTICATED'||result.code==='FORBIDDEN')loseAccess();
  }
 },[loseAccess]);
 const load=useCallback(()=>requestRead().then(applyRead),[applyRead,requestRead]);
 const beginLoad=useCallback(()=>{
  if(!viewRef.current.active||viewRef.current.key!==key)return Promise.resolve();
  setLoaded(null);return load();
 },[key,load]);
 useEffect(()=>{void requestRead().then(applyRead);},[applyRead,requestRead]);
 useEffect(()=>{
  const guard=(event:BeforeUnloadEvent)=>{if(pendingRef.current||(editor&&editor.key===key)){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);
 },[editor,key]);
 async function save(next:Pending){
  const view=viewRef.current;if(busyRef.current||!view.active||view.key!==key)return;
  const attempt={};attemptRef.current=attempt;busyRef.current=true;setBusy(true);setMessage(null);updatePending(next);
  const controller=new AbortController();saveAbort.current=controller;
  try{
   const result=await client.save(next.save,controller.signal);
   if(!viewRef.current.active||attemptRef.current!==attempt||pendingRef.current?.save!==next.save)return;
   if(!current(view)){updatePending({save:next.save,uncertain:true});report({kind:'notice',value:'unconfirmed'});return;}
   updatePending(retainProgramSourceOperationV3(next,result));
   if(result.state==='saved'){
    setEditor(null);report({kind:'notice',value:'confirmed'});await beginLoad();
   }else{
    report({kind:'error',code:result.code});
    if(result.code==='UNAUTHENTICATED'||result.code==='FORBIDDEN'){
     setLoaded({key,result:{state:'failed',code:result.code,requestId:result.requestId}});loseAccess();
    }
   }
  }finally{if(attemptRef.current===attempt){attemptRef.current=null;busyRef.current=false;if(viewRef.current.active)setBusy(false);}}
 }
 async function check(){
  const original=pendingRef.current,view=viewRef.current;if(!original||busyRef.current||!view.active||view.key!==key)return;
  const attempt={};attemptRef.current=attempt;busyRef.current=true;setBusy(true);setMessage(null);
  const run=++serial.current;readAbort.current?.abort();const controller=new AbortController();readAbort.current=controller;
  try{
   const result=await client.group(original.save.command.groupId,controller.signal);
   if(!current(view)||attemptRef.current!==attempt||pendingRef.current?.save!==original.save||run!==serial.current||controller.signal.aborted)return;
   if(result.state==='ready'&&programSourceSavedHeadV3(original.save,result.value)){
    updatePending(null);setEditor(null);report({kind:'notice',value:'confirmed'});await beginLoad();
   }else{
    report(result.state==='failed'?{kind:'error',code:result.code}:{kind:'notice',value:'unconfirmed'});
    if(result.state==='failed'&&(result.code==='UNAUTHENTICATED'||result.code==='FORBIDDEN')){
     setLoaded({key,result});loseAccess();
    }
   }
  }finally{if(attemptRef.current===attempt){attemptRef.current=null;busyRef.current=false;if(viewRef.current.active)setBusy(false);}}
 }
 const result=loaded?.key===key?loaded.result:null,data=result?.state==='ready'?result.value:null;
 const groupCommand=data?.group.record.command;
 const editing=editor?.key===key?editor:null;
 const editable=groupCommand?.kind==='group'&&groupCommand.fields.state==='forming'&&!readOnly;
 const locked=busy||pending!==null;
 function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!editing||!groupId||!data||!editable||locked)return;
  try{
   const prepared=prepareProgramLessonSaveV3(groupId,editing.record?.command.id??crypto.randomUUID(),crypto.randomUUID(),editing.inputs,editing.record??undefined,data.group.record.workspaceId);
   if(!prepared){report({kind:'notice',value:'unchanged'});return;}
   void save({save:prepared,uncertain:false});
  }catch(error){report(error instanceof ProgramLessonInputErrorV3?{kind:'time',reason:error.reason}:{kind:'error',code:'INVALID_REQUEST'});}
 }
 const messageText=message?.kind==='error'?programSourceErrorV3(message.code,locale):message?.kind==='time'?
  message.reason==='ambiguous'?t('That time occurs twice in Florida. Choose a different time.','השעה הזו מופיעה פעמיים בפלורידה. יש לבחור שעה אחרת.'):
  message.reason==='nonexistent'?t('That time does not exist in Florida because the clock changes. Choose a different time.','השעה הזו אינה קיימת בפלורידה בגלל שינוי השעון. יש לבחור שעה אחרת.'):
  t('Enter a valid Florida date and time.','יש להזין תאריך ושעה תקינים בפלורידה.'):
  message?.value==='confirmed'?t('Save confirmed. Reloading the current schedule keeps the original result.','השמירה אומתה. הרענון מציג את לוח הזמנים העדכני.'):
  message?.value==='unchanged'?t('There are no changes to save.','אין שינויים לשמירה.'):
  t('The original save is still unconfirmed. Its operation and entered values are retained.','השמירה המקורית עדיין לא אומתה. הפעולה והפרטים שהוזנו נשמרים.');
 return <section className={'lsw-card '+styles.workspace} lang={locale} dir={locale==='he'?'rtl':'ltr'} aria-labelledby="program-source-title">
  <div className={styles.row}><div><h2 id="program-source-title">{t('Schedule and readiness','לוח זמנים ומוכנות')}</h2>
   {groupId&&groupLabel&&<p>{groupLabel}</p>}</div>
   {valid&&<Button variant="quiet" disabled={locked||editing!==null||result===null} onClick={()=>void beginLoad()}>{t('Reload saved schedule','רענון לוח הזמנים השמור')}</Button>}</div>
  <p className="lsw-help">{t('Saved planning facts do not confirm payment, a reserved seat or permission to run a group.','פרטי תכנון שמורים אינם מאשרים תשלום, מקום שמור או היתר להפעלת קבוצה.')}</p>
  {(message||recovery)&&<section ref={feedback} tabIndex={-1} aria-label={t('Schedule save feedback','משוב על שמירת לוח הזמנים')} className={styles.feedback}>
   {message&&<p role={message.kind==='notice'?'status':'alert'} className={message.kind==='notice'?styles.notice:'lsw-alert'}>{messageText}</p>}
   {pending?.uncertain&&<section className={'lsw-alert '+styles.recovery} aria-labelledby="program-save-recovery"><h3 id="program-save-recovery">{t('Save not confirmed','השמירה טרם אומתה')}</h3>
    <p>{t('Keep this page open. Check or retry the original save before making another change.','יש להשאיר את הדף פתוח. בדקו או נסו שוב את השמירה המקורית לפני שינוי נוסף.')}</p>
    <div className="lsw-actions"><Button busy={busy} onClick={()=>void check()}>{t('Check saved result','בדיקת התוצאה השמורה')}</Button>
     <Button variant="secondary" disabled={busy} onClick={()=>void save(pending)}>{t('Retry the same save','ניסיון חוזר לאותה שמירה')}</Button></div></section>}
  </section>}
  {!groupId?<p>{t('Choose a saved group to view its schedule.','בחרו קבוצה שמורה כדי להציג את לוח הזמנים שלה.')}</p>:!valid?
   <p role="alert" className="lsw-alert">{t('This group selection is invalid. Open a saved group.','בחירת הקבוצה אינה תקינה. יש לפתוח קבוצה שמורה.')}</p>:result===null?
   <p role="status">{t('Loading the saved schedule…','טוען את לוח הזמנים השמור…')}</p>:result.state==='failed'?
   <section role="alert" className="lsw-alert"><p>{result.code==='NOT_FOUND'?t('No saved schedule is available for this group yet. Location and lesson details must be saved before it can be used.','עדיין אין לוח זמנים שמור זמין לקבוצה הזו. יש לשמור את פרטי המקום והשיעורים לפני השימוש בו.'):programSourceErrorV3(result.code,locale)}</p>
    <Button variant="secondary" disabled={locked} onClick={()=>void beginLoad()}>{t('Try loading again','ניסיון טעינה נוסף')}</Button></section>:data&&<>
   <ProgramSourceSummaryV3 data={data} locale={locale}/>
   {readOnly&&<p className={styles.notice}>{t('Read only while viewing a historical draft or another unfinished action.','לקריאה בלבד בזמן הצגת טיוטה היסטורית או פעולה אחרת שטרם הסתיימה.')}</p>}
   <ProgramSourceLessonsV3 data={data} locale={locale} limit={limit} edit={editable&&!locked&&!editing?record=>{setMessage(null);setEditor({key,record,inputs:programLessonInputsV3(record)});}:undefined}/>
   {data.lessons.length>limit&&<Button variant="secondary" onClick={()=>setLimit(value=>value+25)}>{t('Show more lessons','הצגת שיעורים נוספים')}</Button>}
   {editable&&!editing&&<Button variant="secondary" disabled={locked} onClick={()=>{setMessage(null);setEditor({key,record:null,inputs:programLessonInputsV3()});}}>{t('Add a lesson','הוספת שיעור')}</Button>}
   {editing&&editable&&<form className={styles.form} onSubmit={submit}><h3>{editing.record?t('Edit saved lesson','עריכת שיעור שמור'):t('Add a lesson','הוספת שיעור')}</h3>
    <fieldset disabled={locked} className={styles.fields}><legend className="lsw-visually-hidden">{t('Lesson details','פרטי השיעור')}</legend>
     <Input id="program-lesson-sequence" label={t('Lesson number','מספר השיעור')} inputMode="numeric" required value={editing.inputs.sequence} onChange={event=>setEditor({...editing,inputs:{...editing.inputs,sequence:event.target.value}})}/>
     <div className={styles.pair}><Input id="program-lesson-start" label={t('Starts · Florida time','התחלה · שעון פלורידה')} type="datetime-local" step="0.001" required value={editing.inputs.startsAt} onChange={event=>setEditor({...editing,inputs:{...editing.inputs,startsAt:event.target.value}})}/>
      <Input id="program-lesson-end" label={t('Ends · Florida time','סיום · שעון פלורידה')} type="datetime-local" step="0.001" required value={editing.inputs.endsAt} onChange={event=>setEditor({...editing,inputs:{...editing.inputs,endsAt:event.target.value}})}/></div>
     <Select id="program-lesson-state" label={t('Lesson status','מצב השיעור')} value={editing.inputs.state} onChange={event=>setEditor({...editing,inputs:{...editing.inputs,state:event.target.value==='cancelled'?'cancelled':'scheduled'}})}>
      <option value="scheduled">{t('Scheduled','מתוכנן')}</option><option value="cancelled">{t('Cancelled','בוטל')}</option></Select>
    </fieldset><p className="lsw-help">{t('Review affected families and any follow-up separately when changing a lesson.','בעת שינוי שיעור יש לבדוק בנפרד את המשפחות המושפעות ואת המשך הטיפול הנדרש.')}</p>
    <div className="lsw-actions"><Button type="submit" busy={busy} disabled={locked}>{t('Save lesson','שמירת השיעור')}</Button>
     <Button variant="quiet" disabled={locked} onClick={()=>{setEditor(null);setMessage(null);}}>{t('Discard lesson changes','ביטול שינויי השיעור')}</Button></div>
   </form>}
  </>}
 </section>;
}
