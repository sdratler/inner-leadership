'use client';
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {Button,Input,Select,Checkbox} from '../../ui/workspace/controls.tsx';
import type {ErrorCode} from '../../lib/errors.ts';
import {billingId} from './contracts.ts';
import type {ProgramSourceRecordV3} from './program-source-contract-v3.ts';
import type {ProgramSourceGroupDataV3} from './program-source-owner-contract-v3.ts';
import type {NativeFamilyOwnerSource} from './native-family-owner-source-contract.ts';
import {OWNER_LOCATION_PLANNING_PREFIX} from './owner-location-planning-source.ts';
import {isTrip390Interest,type GroupApplicationRecord} from '../group-application/contract.ts';
import {
 createProgramSourceClientV3,prepareProgramLessonSaveV3,programLessonInputsV3,programSourceSavedHeadV3,ProgramLessonInputErrorV3,
 prepareNativeFamilySaveV3,nativeFamilySaveMatchesV3,prepareProgramParticipantSaveV3,
 type PreparedProgramSourceSaveV3,type ProgramLessonInputsV3,type ProgramGroupInputsV3,type ProgramSourceReadResultV3,type ProgramSourceSaveResultV3,
 type PreparedNativeFamilySaveV3,type NativeFamilySaveResultV3,type ProgramOwnerReadResultV3,
} from './program-source-client-v3.ts';
import styles from './program-source-workspace-v3.module.css';

type Locale='en'|'he';
type AccessDenial='UNAUTHENTICATED'|'FORBIDDEN';
type View={key:string;active:boolean};
type ReadCompletion={view:View;run:number;controller:AbortController;result:ProgramSourceReadResultV3};
type Pending={save:PreparedProgramSourceSaveV3;uncertain:boolean};
type Message={kind:'error';code:ErrorCode}|{kind:'time';reason:'invalid'|'ambiguous'|'nonexistent'}|
 {kind:'notice';value:'unchanged'|'unconfirmed'|'confirmed'};
type Editor={key:string;record:ProgramSourceRecordV3|null;inputs:ProgramLessonInputsV3};
type GroupEditor={key:string;record:ProgramSourceRecordV3|null;inputs:ProgramGroupInputsV3};
export function retainProgramSourceOperationV3(pending:Pending,result:ProgramSourceSaveResultV3):Pending|null{
 return result.state==='saved'?null:result.state==='unknown'||pending.uncertain?{save:pending.save,uncertain:true}:null;
}
export function programSourceErrorV3(code:ErrorCode,locale:Locale){
 const text={
  UNAUTHENTICATED:['Your session ended. Sign in again, then reload or retry the same save.','פג תוקף החיבור. יש להתחבר מחדש ואז לרענן או לנסות שוב את אותה שמירה.'],
  FORBIDDEN:['This account cannot access the saved Fishing schedule.','לחשבון הזה אין גישה ללוח הזמנים השמור של קבוצות הדיג.'],
  NOT_FOUND:['The saved schedule is not available.','לוח הזמנים השמור אינו זמין.'],
  CONFLICT:['The schedule changed or a lesson overlaps another lesson. Reload before making a new edit.','לוח הזמנים השתנה או ששיעור חופף לשיעור אחר. יש לרענן לפני עריכה חדשה.'],
  INVALID_REQUEST:['Review the entered planning details before saving.','יש לבדוק את פרטי התכנון שהוזנו לפני השמירה.'],
  RATE_LIMITED:['Too many requests. Wait a moment, then reload or retry the same save.','בוצעו בקשות רבות מדי. המתינו מעט ואז רעננו או נסו שוב את אותה שמירה.'],
  UNAVAILABLE:['The schedule could not be confirmed. This does not mean there are no lessons.','לא ניתן לאמת את לוח הזמנים. אין פירוש הדבר שאין שיעורים.'],
  INTERNAL:['The request could not be confirmed. Reload or check the original save.','לא ניתן לאמת את הבקשה. יש לרענן או לבדוק את השמירה המקורית.'],
  PAYLOAD_TOO_LARGE:['The save could not be accepted. Review the entered details.','לא ניתן לקבל את השמירה. יש לבדוק את הפרטים שהוזנו.'],
  UNSUPPORTED_MEDIA_TYPE:['The save could not be accepted. Reload before editing again.','לא ניתן לקבל את השמירה. יש לרענן לפני עריכה נוספת.'],
 } satisfies Record<ErrorCode,readonly[string,string]>;
 return text[code][locale==='he'?1:0];
}
export function nativeFamilyErrorV3(code:ErrorCode,locale:Locale){
 const t=(en:string,he:string)=>locale==='he'?he:en;
 switch(code){
  case 'FORBIDDEN':return t('This account cannot access the saved family details.','לחשבון הזה אין גישה לפרטי המשפחה השמורים.');
  case 'NOT_FOUND':return t('Family details are not available for this saved request.','פרטי משפחה אינם זמינים לפנייה השמורה הזו.');
  case 'CONFLICT':return t('The saved contact or family mapping changed. Reload before preparing a new save.','איש הקשר השמור או שיוך המשפחה השתנו. יש לרענן לפני הכנת שמירה חדשה.');
  case 'INVALID_REQUEST':return t('Review the selected request, children and confirmation before saving.','יש לבדוק את הפנייה שנבחרה, הילדים והאישור לפני השמירה.');
  case 'UNAVAILABLE':return t('The family details could not be confirmed. This is not an empty request list.','לא ניתן לאמת את פרטי המשפחה. אין פירוש הדבר שרשימת הפניות ריקה.');
  default:return programSourceErrorV3(code,locale);
 }
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
   <div><dt>{c.fields.venueSource.id.startsWith(OWNER_LOCATION_PLANNING_PREFIX)?t('Owner-proposed location','מקום מוצע על ידי המארגן'):t('Saved location','המקום השמור')}</dt><dd>{c.fields.location}</dd></div>
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
export function ProgramSourceWorkspaceV3({locale,groupId,groupLabel,workspaceId,readOnly=false,onLockChange,onAccessDenied}:{locale:Locale;groupId?:string|undefined;groupLabel?:string|undefined;workspaceId?:string|undefined;
 readOnly?:boolean|undefined;onLockChange?:((locked:boolean)=>void)|undefined;onAccessDenied?:((code:AccessDenial)=>void)|undefined}){
 const t=(en:string,he:string)=>locale==='he'?he:en,key=(groupId??'')+':'+(workspaceId??'')+':'+readOnly;
 const valid=!!groupId&&billingId.safeParse(groupId).success&&groupId===groupId.toLowerCase()&&
  (workspaceId===undefined||(billingId.safeParse(workspaceId).success&&workspaceId===workspaceId.toLowerCase()));
 const client=useMemo(()=>createProgramSourceClientV3(),[]);
 const [loaded,setLoaded]=useState<{key:string;result:ProgramSourceReadResultV3}|null>(null);
 const [pending,setPending]=useState<Pending|null>(null),[busy,setBusy]=useState(false),[editor,setEditor]=useState<Editor|null>(null);
 const [groupEditor,setGroupEditor]=useState<GroupEditor|null>(null);
 const [message,setMessage]=useState<Message|null>(null),[feedbackVersion,setFeedbackVersion]=useState(0),[limit,setLimit]=useState(25);
 const [familyLocked,setFamilyLocked]=useState(false);
 const pendingRef=useRef<Pending|null>(null),busyRef=useRef(false),viewRef=useRef<View>({key,active:false}),serial=useRef(0),attemptRef=useRef<object|null>(null);
 const readAbort=useRef<AbortController|null>(null),saveAbort=useRef<AbortController|null>(null),feedback=useRef<HTMLElement>(null);
 const recovery=!!pending?.uncertain;
 const current=(view:View)=>viewRef.current===view&&view.active;
 const updatePending=(value:Pending|null)=>{pendingRef.current=value;setPending(value);};
 const report=(value:Message)=>{setMessage(value);setFeedbackVersion(n=>n+1);};
 useEffect(()=>{onLockChange?.(pending!==null||(editor!==null&&editor.key===key)||(groupEditor!==null&&groupEditor.key===key)||familyLocked);},[pending,editor,groupEditor,key,familyLocked,onLockChange]);
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
  viewRef.current={...viewRef.current};serial.current++;readAbort.current?.abort();setEditor(null);setGroupEditor(null);
 },[]);
 const denyFromFamily=useCallback((code:AccessDenial)=>{
  setLoaded({key,result:{state:'failed',code,requestId:null}});loseAccess();onAccessDenied?.(code);
 },[key,loseAccess,onAccessDenied]);
 const requestRead=useCallback(async():Promise<ReadCompletion|undefined>=>{
  const view=viewRef.current;if(!valid||!groupId||!view.active||view.key!==key)return;
  const run=++serial.current;readAbort.current?.abort();const controller=new AbortController();readAbort.current=controller;
  let result=await client.group(groupId,controller.signal);
  if(result.state==='ready'&&workspaceId&&result.value.group.record.workspaceId!==workspaceId)result={state:'failed',code:'UNAVAILABLE',requestId:result.requestId};
  return {view,run,controller,result};
 },[client,groupId,key,valid,workspaceId]);
 const applyRead=useCallback((completion:ReadCompletion|undefined)=>{
  if(!completion)return;
  const {view,run,controller,result}=completion;
  if(viewRef.current!==view||!view.active||run!==serial.current||controller.signal.aborted)return;
  setLoaded({key:view.key,result});setLimit(25);setEditor(null);setGroupEditor(null);
  if(result.state==='failed'){
   setEditor(null);
   if(result.code==='UNAUTHENTICATED'||result.code==='FORBIDDEN'){loseAccess();onAccessDenied?.(result.code);}
  }
 },[loseAccess,onAccessDenied]);
 const load=useCallback(()=>requestRead().then(applyRead),[applyRead,requestRead]);
 const beginLoad=useCallback(()=>{
  if(!viewRef.current.active||viewRef.current.key!==key)return Promise.resolve();
  setLoaded(null);return load();
 },[key,load]);
 useEffect(()=>{void requestRead().then(applyRead);},[applyRead,requestRead]);
 useEffect(()=>{
  const guard=(event:BeforeUnloadEvent)=>{if(pendingRef.current||(editor&&editor.key===key)||(groupEditor&&groupEditor.key===key)){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);
 },[editor,groupEditor,key]);
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
    setEditor(null);setGroupEditor(null);report({kind:'notice',value:'confirmed'});await beginLoad();
   }else{
    report({kind:'error',code:result.code});
    if(result.code==='UNAUTHENTICATED'||result.code==='FORBIDDEN'){
     setLoaded({key,result:{state:'failed',code:result.code,requestId:result.requestId}});loseAccess();onAccessDenied?.(result.code);
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
    updatePending(null);setEditor(null);setGroupEditor(null);report({kind:'notice',value:'confirmed'});await beginLoad();
   }else{
    report(result.state==='failed'?{kind:'error',code:result.code}:{kind:'notice',value:'unconfirmed'});
    if(result.state==='failed'&&(result.code==='UNAUTHENTICATED'||result.code==='FORBIDDEN')){
     setLoaded({key,result});loseAccess();onAccessDenied?.(result.code);
    }
   }
  }finally{if(attemptRef.current===attempt){attemptRef.current=null;busyRef.current=false;if(viewRef.current.active)setBusy(false);}}
 }
 const result=loaded?.key===key?loaded.result:null,data=result?.state==='ready'?result.value:null;
 const groupCommand=data?.group.record.command;
 const editing=editor?.key===key?editor:null;
 const groupEditing=groupEditor?.key===key?groupEditor:null;
 const missing=result?.state==='failed'&&result.code==='NOT_FOUND';
 const editable=groupCommand?.kind==='group'&&groupCommand.fields.state==='forming'&&!readOnly;
 const locked=busy||pending!==null;
 const controlsLocked=locked||familyLocked;
 async function submitGroup(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!groupEditing||!groupId||!workspaceId||readOnly||controlsLocked||(!data&&!missing))return;
  const view=viewRef.current;if(!view.active||view.key!==key)return;
  const attempt={};attemptRef.current=attempt;busyRef.current=true;setBusy(true);setMessage(null);
  const controller=new AbortController();saveAbort.current=controller;
  try{
   const prepared=await client.prepareGroup({groupId,workspaceId,operationId:crypto.randomUUID(),inputs:groupEditing.inputs,current:groupEditing.record??undefined},controller.signal);
   if(!current(view)||attemptRef.current!==attempt)return;
   if(prepared.state==='failed'){
    report({kind:'error',code:prepared.code});
    if(prepared.code==='UNAUTHENTICATED'||prepared.code==='FORBIDDEN'){
     setLoaded({key,result:{state:'failed',code:prepared.code,requestId:prepared.requestId}});loseAccess();onAccessDenied?.(prepared.code);
    }
   }else if(!prepared.save)report({kind:'notice',value:'unchanged'});
   else{attemptRef.current=null;busyRef.current=false;setBusy(false);void save({save:prepared.save,uncertain:false});}
  }finally{if(attemptRef.current===attempt){attemptRef.current=null;busyRef.current=false;if(viewRef.current.active)setBusy(false);}}
 }
 function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!editing||!groupId||!data||!editable||controlsLocked)return;
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
  message?.value==='confirmed'?t('Save confirmed.','השמירה אומתה.'):
  message?.value==='unchanged'?t('There are no changes to save.','אין שינויים לשמירה.'):
  t('The original save is still unconfirmed. Its operation and entered values are retained.','השמירה המקורית עדיין לא אומתה. הפעולה והפרטים שהוזנו נשמרים.');
 return <section className={'lsw-card '+styles.workspace} lang={locale} dir={locale==='he'?'rtl':'ltr'} aria-labelledby="program-source-title">
  <div className={styles.row}><div><h2 id="program-source-title">{t('Schedule and readiness','לוח זמנים ומוכנות')}</h2>
   {groupId&&groupLabel&&<p>{groupLabel}</p>}</div>
   {valid&&<Button variant="quiet" disabled={controlsLocked||editing!==null||groupEditing!==null||result===null} onClick={()=>void beginLoad()}>{t('Reload saved schedule','רענון לוח הזמנים השמור')}</Button>}</div>
  <p className="lsw-help">{t('Saved planning facts do not confirm payment, a reserved seat or permission to run a group.','פרטי תכנון שמורים אינם מאשרים תשלום, מקום שמור או היתר להפעלת קבוצה.')}</p>
  {(message||recovery)&&<section ref={feedback} tabIndex={-1} aria-label={t('Schedule save feedback','משוב על שמירת לוח הזמנים')} className={styles.feedback}>
   {message&&<p role={message.kind==='notice'?'status':'alert'} className={message.kind==='notice'?styles.notice:'lsw-alert'}>{messageText}</p>}
   {message?.kind==='error'&&message.code==='CONFLICT'&&!locked&&<Button variant="secondary" onClick={()=>{
    setEditor(null);setGroupEditor(null);setMessage(null);void beginLoad();
   }}>{t('Discard changes and reload saved schedule','ביטול השינויים ורענון לוח הזמנים השמור')}</Button>}
   {pending?.uncertain&&<section className={'lsw-alert '+styles.recovery} aria-labelledby="program-save-recovery"><h3 id="program-save-recovery">{t('Save not confirmed','השמירה טרם אומתה')}</h3>
    <p>{t('Keep this page open. Check or retry the original save before making another change.','יש להשאיר את הדף פתוח. בדקו או נסו שוב את השמירה המקורית לפני שינוי נוסף.')}</p>
    <div className="lsw-actions"><Button busy={busy} onClick={()=>void check()}>{t('Check saved result','בדיקת התוצאה השמורה')}</Button>
     <Button variant="secondary" disabled={busy} onClick={()=>void save(pending)}>{t('Retry the same save','ניסיון חוזר לאותה שמירה')}</Button></div></section>}
  </section>}
  {!groupId?<p>{t('Choose a saved group to view its schedule.','בחרו קבוצה שמורה כדי להציג את לוח הזמנים שלה.')}</p>:!valid?
   <p role="alert" className="lsw-alert">{t('This group selection is invalid. Open a saved group.','בחירת הקבוצה אינה תקינה. יש לפתוח קבוצה שמורה.')}</p>:result===null?
   <p role="status">{t('Loading the saved schedule…','טוען את לוח הזמנים השמור…')}</p>:result.state==='failed'?
   <section role="alert" className="lsw-alert"><p>{result.code==='NOT_FOUND'?t('No saved schedule is available for this group yet. Location and lesson details must be saved before it can be used.','עדיין אין לוח זמנים שמור זמין לקבוצה הזו. יש לשמור את פרטי המקום והשיעורים לפני השימוש בו.'):programSourceErrorV3(result.code,locale)}</p>
    <Button variant="secondary" disabled={controlsLocked} onClick={()=>void beginLoad()}>{t('Try loading again','ניסיון טעינה נוסף')}</Button></section>:data&&<>
   <ProgramSourceSummaryV3 data={data} locale={locale}/>
   {readOnly&&<p className={styles.notice}>{t('Read only while viewing a historical draft or another unfinished action.','לקריאה בלבד בזמן הצגת טיוטה היסטורית או פעולה אחרת שטרם הסתיימה.')}</p>}
   <ProgramSourceLessonsV3 data={data} locale={locale} limit={limit} edit={editable&&!controlsLocked&&!editing&&!groupEditing?record=>{setMessage(null);setEditor({key,record,inputs:programLessonInputsV3(record)});}:undefined}/>
   {data.lessons.length>limit&&<Button variant="secondary" onClick={()=>setLimit(value=>value+25)}>{t('Show more lessons','הצגת שיעורים נוספים')}</Button>}
   {editable&&!editing&&!groupEditing&&<Button variant="secondary" disabled={controlsLocked} onClick={()=>{setMessage(null);setEditor({key,record:null,inputs:programLessonInputsV3()});}}>{t('Add a lesson','הוספת שיעור')}</Button>}
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
  {(data||missing)&&!readOnly&&!editing&&!groupEditing&&workspaceId&&<Button variant="secondary" disabled={controlsLocked} onClick={()=>{
   const record=data?.group.record??null,c=record?.command;if(c&&c.kind!=='group')return;
   setMessage(null);setGroupEditor({key,record,inputs:{location:c?.fields.location??'',state:c?.fields.state??'forming'}});
  }}>{data?t('Edit location and schedule status','עריכת המקום ומצב לוח הזמנים'):t('Set proposed location','הגדרת מקום מוצע')}</Button>}
  {(data||missing)&&groupEditing&&!readOnly&&<form className={styles.form} onSubmit={event=>void submitGroup(event)}><h3>{t('Owner-proposed location','מקום מוצע על ידי המארגן')}</h3>
   <p className="lsw-help">{t('This saves your location planning note. Venue permission and operational approval are separate.','פעולה זו שומרת את הערת תכנון המקום שלך. אישור המקום ואישור ההפעלה נבדקים בנפרד.')}</p>
   <fieldset disabled={controlsLocked} className={styles.fields}><legend className="lsw-visually-hidden">{t('Location planning','תכנון המקום')}</legend>
    <Input id="program-group-location" label={t('Proposed location','המקום המוצע')} required maxLength={200} value={groupEditing.inputs.location} onChange={event=>setGroupEditor({...groupEditing,inputs:{...groupEditing.inputs,location:event.target.value}})}/>
    <Select id="program-group-state" label={t('Schedule planning status','מצב תכנון לוח הזמנים')} value={groupEditing.inputs.state} onChange={event=>setGroupEditor({...groupEditing,inputs:{...groupEditing.inputs,state:event.target.value==='cancelled'?'cancelled':'forming'}})}>
     <option value="forming">{t('In preparation','בהכנה')}</option><option value="cancelled">{t('Cancelled','בוטל')}</option></Select>
   </fieldset><div className="lsw-actions"><Button type="submit" busy={busy} disabled={controlsLocked}>{t('Save location planning','שמירת תכנון המקום')}</Button>
    <Button variant="quiet" disabled={locked} onClick={()=>{setGroupEditor(null);setMessage(null);}}>{t('Discard location changes','ביטול שינויי המקום')}</Button></div></form>}
  <NativeFamilyRosterV3 locale={locale} viewKey={key} workspaceId={workspaceId??data?.group.record.workspaceId} data={data}
   accessBlocked={!valid||(result?.state==='failed'&&(result.code==='FORBIDDEN'||result.code==='UNAUTHENTICATED'))}
   disabled={readOnly||locked||editing!==null||groupEditing!==null} onLockChange={setFamilyLocked} onAccessDenied={denyFromFamily} saveParticipant={prepared=>{
    if(!editable||busyRef.current||pendingRef.current||!data||prepared.workspaceId!==data.group.record.workspaceId||prepared.command.groupId!==groupId||prepared.command.kind!=='progression')return false;
    void save({save:prepared,uncertain:false});return true;
   }}/>
 </section>;
}

type FamilyPending={save:PreparedNativeFamilySaveV3;uncertain:boolean};
type ParticipantEditor={key:string;applicationChildId:string;lessonId:string;state:'planned'|'withdrawn'};
export function retainNativeFamilyOperationV3(pending:FamilyPending,result:NativeFamilySaveResultV3):FamilyPending|null{
 return result.state==='saved'?null:result.state==='unknown'||pending.uncertain?{save:pending.save,uncertain:true}:null;
}
function requestLabel(record:GroupApplicationRecord,locale:Locale){
 const f=record.fields,name=isTrip390Interest(f)?f.guardianName:'parentName'in f?f.parentName:'contactName'in f?f.contactName:locale==='he'?'פנייה שמורה':'Saved request';
 return name+' · '+time(record.receivedAt,locale);
}
/** Uses saved request IDs only as opaque option values. Names never select or
 * merge a native person; each new family requires explicit owner review. */
export function NativeFamilyRosterV3({locale,viewKey,workspaceId,data,accessBlocked,disabled,saveParticipant,onLockChange,onAccessDenied}:{locale:Locale;viewKey:string;
 workspaceId?:string|undefined;data:ProgramSourceGroupDataV3|null;accessBlocked:boolean;disabled:boolean;
 saveParticipant:(save:PreparedProgramSourceSaveV3)=>boolean;onLockChange:(locked:boolean)=>void;onAccessDenied?:(code:AccessDenial)=>void}){
 const t=(en:string,he:string)=>locale==='he'?he:en,client=useMemo(()=>createProgramSourceClientV3(),[]);
 const [reference,setReference]=useState(''),[search,setSearch]=useState(''),[submittedSearch,setSubmittedSearch]=useState('');
 const key=viewKey+':'+reference+':'+accessBlocked;
 const [page,setPage]=useState<{scope:string;result:Awaited<ReturnType<typeof client.inquiries>>}|null>(null),[trail,setTrail]=useState<(string|null)[]>([null]);
 const [source,setSource]=useState<{key:string;result:ProgramOwnerReadResultV3<NativeFamilyOwnerSource>}|null>(null);
 const [listBusy,setListBusy]=useState(false),[busy,setBusy]=useState(false),[pending,setPending]=useState<FamilyPending|null>(null);
 const [reviewed,setReviewed]=useState(false),[editor,setEditor]=useState<ParticipantEditor|null>(null),[message,setMessage]=useState<'saved'|'unconfirmed'|ErrorCode|null>(null);
 const [feedbackVersion,setFeedbackVersion]=useState(0),[denied,setDenied]=useState<ErrorCode|null>(null);
 const viewRef=useRef<View>({key,active:false}),listSerial=useRef(0),sourceSerial=useRef(0),attemptRef=useRef<object|null>(null),busyRef=useRef(false),pendingRef=useRef<FamilyPending|null>(null);
 const listAbort=useRef<AbortController|null>(null),sourceAbort=useRef<AbortController|null>(null),saveAbort=useRef<AbortController|null>(null),feedback=useRef<HTMLElement>(null);
 const current=useCallback((view:View)=>viewRef.current===view&&view.active,[]);
 const loaded=source?.key===key&&!accessBlocked&&!denied?source.result:null;
 const family=loaded?.state==='ready'?loaded.value:null,editing=editor?.key===key?editor:null;
 const recovery=!!pending?.uncertain,held=busy||pending!==null;
 // A review checkbox belongs only to its currently loaded source context.
 const dirty=(reviewed&&family!==null)||editing!==null;
 const report=(value:'saved'|'unconfirmed'|ErrorCode)=>{setMessage(value);setFeedbackVersion(n=>n+1);};
 const updatePending=(value:FamilyPending|null)=>{pendingRef.current=value;setPending(value);};
 useEffect(()=>{onLockChange(pending!==null||dirty);},[pending,dirty,onLockChange]);
 useEffect(()=>{if(message||recovery){feedback.current?.focus({preventScroll:true});feedback.current?.scrollIntoView({block:'start'});}},[message,recovery,feedbackVersion]);
 useLayoutEffect(()=>{
  const view:View={key,active:true};viewRef.current=view;
  return()=>{view.active=false;if(viewRef.current.key===key){viewRef.current.active=false;viewRef.current={...viewRef.current,active:false};}
   listAbort.current?.abort();sourceAbort.current?.abort();saveAbort.current?.abort();};
 },[key]);
 const loseAccess=useCallback((code:ErrorCode)=>{
  viewRef.current={...viewRef.current};listSerial.current++;sourceSerial.current++;listAbort.current?.abort();sourceAbort.current?.abort();
  setDenied(code);setPage(null);setSource(null);setReviewed(false);setEditor(null);
  if(code==='FORBIDDEN'||code==='UNAUTHENTICATED')onAccessDenied?.(code);
 },[onAccessDenied]);
 const requestPage=useCallback((query:string,cursor:string|null,nextTrail:(string|null)[])=>{
  const view=viewRef.current;if(accessBlocked||!view.active)return Promise.resolve();
  const run=++listSerial.current;listAbort.current?.abort();const controller=new AbortController();listAbort.current=controller;
  return client.inquiries(query,cursor,controller.signal).then(result=>{
   if(!current(view)||run!==listSerial.current||controller.signal.aborted)return;
   setPage({scope:viewKey,result});setTrail(nextTrail);setSubmittedSearch(query);setListBusy(false);
   if(result.state==='failed'&&(result.code==='FORBIDDEN'||result.code==='UNAUTHENTICATED'))loseAccess(result.code);
  });
 },[accessBlocked,client,current,loseAccess,viewKey]);
 const requestFamily=useCallback(()=>{
  const view=viewRef.current;if(accessBlocked||!reference||!view.active||view.key!==key)return Promise.resolve();
  const run=++sourceSerial.current;sourceAbort.current?.abort();const controller=new AbortController();sourceAbort.current=controller;
  return client.family(reference,controller.signal).then(result=>{
   if(!current(view)||run!==sourceSerial.current||controller.signal.aborted)return;
   setSource({key,result});setReviewed(false);setEditor(null);
   if(result.state==='failed'&&(result.code==='FORBIDDEN'||result.code==='UNAUTHENTICATED'))loseAccess(result.code);
  });
 },[accessBlocked,client,current,key,loseAccess,reference]);
 useEffect(()=>{void requestPage('',null,[null]);},[requestPage]);
 useEffect(()=>{void requestFamily();},[requestFamily]);
 useEffect(()=>{
  const guard=(event:BeforeUnloadEvent)=>{if(pendingRef.current||dirty){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);
 },[dirty]);
 async function saveFamily(next:FamilyPending){
  const view=viewRef.current;if(busyRef.current||!view.active)return;
  const attempt={};attemptRef.current=attempt;busyRef.current=true;setBusy(true);setMessage(null);updatePending(next);
  const controller=new AbortController();saveAbort.current=controller;
  try{
   const result=await client.saveFamily(next.save,controller.signal);
   if(!viewRef.current.active||attemptRef.current!==attempt||pendingRef.current?.save!==next.save)return;
   if(!current(view)){updatePending({save:next.save,uncertain:true});report('unconfirmed');return;}
   updatePending(retainNativeFamilyOperationV3(next,result));
   if(result.state==='saved'){setReviewed(false);report('saved');setSource(null);await requestFamily();}
   else{report(result.code);if(result.code==='UNAUTHENTICATED'||result.code==='FORBIDDEN')loseAccess(result.code);}
  }finally{if(attemptRef.current===attempt){attemptRef.current=null;busyRef.current=false;if(viewRef.current.active)setBusy(false);}}
 }
 async function checkFamily(){
  const original=pendingRef.current,view=viewRef.current;if(!original||busyRef.current||!view.active)return;
  const attempt={};attemptRef.current=attempt;busyRef.current=true;setBusy(true);setMessage(null);
  const run=++sourceSerial.current;sourceAbort.current?.abort();const controller=new AbortController();sourceAbort.current=controller;
  try{
   const result=await client.family(original.save.command.reference,controller.signal);
   if(!current(view)||attemptRef.current!==attempt||pendingRef.current?.save!==original.save||run!==sourceSerial.current||controller.signal.aborted)return;
   if(result.state==='ready'&&result.value.association&&nativeFamilySaveMatchesV3(original.save,result.value.association)){
    updatePending(null);setReviewed(false);report('saved');setSource(null);await requestFamily();
   }else{report(result.state==='failed'?result.code:'unconfirmed');if(result.state==='failed'&&(result.code==='FORBIDDEN'||result.code==='UNAUTHENTICATED'))loseAccess(result.code);}
  }finally{if(attemptRef.current===attempt){attemptRef.current=null;busyRef.current=false;if(viewRef.current.active)setBusy(false);}}
 }
 function createFamily(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!family||!workspaceId||!reviewed||held||disabled)return;
  try{void saveFamily({save:prepareNativeFamilySaveV3(family,family.guardianName,reviewed,workspaceId),uncertain:false});}
  catch{report('INVALID_REQUEST');}
 }
 const list=page?.scope===viewKey&&!accessBlocked&&!denied?page.result:null;
 const canPlan=data?.group.record.command.kind==='group'&&data.group.record.command.fields.state==='forming';
 function choose(value:string){if(held||dirty||disabled)return;setReference(value);setSource(null);setReviewed(false);setEditor(null);setMessage(null);}
 function searchRequests(event:FormEvent<HTMLFormElement>){event.preventDefault();if(held||dirty||disabled)return;setListBusy(true);void requestPage(search,null,[null]);}
 const disabledInputs=disabled||held||listBusy;
 return <section className={styles.families} aria-labelledby="program-family-title"><h3 id="program-family-title">{t('Family and participant plans','תוכניות למשפחות ולמשתתפים')}</h3>
  {(message||recovery)&&<section ref={feedback} tabIndex={-1} aria-label={t('Family save feedback','משוב על שמירת המשפחה')} className={styles.feedback}>
   {message&&<p role={message==='saved'?'status':'alert'} className={message==='saved'?styles.notice:'lsw-alert'}>{message==='saved'?t('Family save confirmed.','שמירת המשפחה אומתה.'):
    message==='unconfirmed'?t('The original family save is still unconfirmed. Keep this page open and use the same operation.','שמירת המשפחה המקורית עדיין לא אומתה. יש להשאיר את הדף פתוח ולהשתמש באותה פעולה.'):nativeFamilyErrorV3(message,locale)}</p>}
   {message==='CONFLICT'&&!held&&<Button variant="secondary" onClick={()=>{setReviewed(false);setEditor(null);setSource(null);setMessage(null);void requestFamily();}}>
    {t('Discard review and reload family details','ביטול הבדיקה ורענון פרטי המשפחה')}</Button>}
   {pending?.uncertain&&<section className={'lsw-alert '+styles.recovery}><h4>{t('Family save not confirmed','שמירת המשפחה טרם אומתה')}</h4>
    <p>{t('Checking or retrying uses the same original request. Do not create another family for this request.','בדיקה או ניסיון חוזר משתמשים באותה בקשה מקורית. אין ליצור משפחה נוספת לפנייה הזו.')}</p>
    <div className="lsw-actions"><Button busy={busy} onClick={()=>void checkFamily()}>{t('Check family save','בדיקת שמירת המשפחה')}</Button>
     <Button variant="secondary" disabled={busy} onClick={()=>void saveFamily(pending)}>{t('Retry the same family save','ניסיון חוזר לאותה שמירת משפחה')}</Button></div></section>}
  </section>}
  {accessBlocked?<p>{t('Choose an accessible saved group before loading family details.','יש לבחור קבוצה שמורה שהגישה אליה מותרת לפני טעינת פרטי המשפחה.')}</p>:denied?
   <section role="alert" className="lsw-alert"><p>{nativeFamilyErrorV3(denied,locale)}</p><Button variant="secondary" disabled={held} onClick={()=>{
    setDenied(null);void requestPage(submittedSearch,null,[null]);void requestFamily();
   }}>{t('Reload private family details','רענון פרטי המשפחה הפרטיים')}</Button></section>:<>
   <form className={styles.search} onSubmit={searchRequests}><Input id="program-family-search" label={t('Find a saved Fishing request','איתור פניית דיג שמורה')} maxLength={160} value={search} disabled={disabledInputs||dirty} onChange={event=>setSearch(event.target.value)}/>
    <Button type="submit" variant="secondary" disabled={disabledInputs||dirty}>{t('Search requests','חיפוש פניות')}</Button></form>
   {list===null?<p role="status">{t('Loading saved requests…','טוען פניות שמורות…')}</p>:list.state==='failed'?
    <section className="lsw-alert" role="alert"><p>{nativeFamilyErrorV3(list.code,locale)}</p><Button variant="secondary" disabled={disabledInputs||dirty} onClick={()=>{setListBusy(true);void requestPage(submittedSearch,null,[null]);}}>{t('Reload saved requests','רענון פניות שמורות')}</Button></section>:<>
     {list.value.items.length===0?<p>{t('No saved requests match this search.','לא נמצאו פניות שמורות התואמות לחיפוש הזה.')}</p>:
      <Select id="program-family-request" label={t('Saved request','פנייה שמורה')} value={reference} disabled={disabledInputs||dirty} onChange={event=>choose(event.target.value)}>
       <option value="">{t('Choose a request…','בחירת פנייה…')}</option>
       {reference&&!list.value.items.some(item=>item.id===reference)&&<option value={reference}>{family?.guardianName??t('Selected saved request','הפנייה השמורה שנבחרה')}</option>}
       {list.value.items.map(record=><option key={record.id} value={record.id}>{requestLabel(record,locale)}</option>)}</Select>}
     <nav className={styles.row} aria-label={t('Saved request pages','עמודי פניות שמורות')}><Button variant="secondary" disabled={disabledInputs||dirty||trail.length<2} onClick={()=>{
      const previous=trail.slice(0,-1);setListBusy(true);void requestPage(submittedSearch,previous[previous.length-1]??null,previous);
     }}>{t('Previous requests','פניות קודמות')}</Button><span>{t('Page','עמוד')} <bdi>{trail.length}</bdi></span>
      <Button variant="secondary" disabled={disabledInputs||dirty||!list.value.nextCursor} onClick={()=>{const cursor=list.value.nextCursor;if(cursor){setListBusy(true);void requestPage(submittedSearch,cursor,[...trail,cursor]);}}}>{t('Next requests','פניות הבאות')}</Button></nav>
    </>}
   {reference&&<section className={styles.familyDetails}><div className={styles.row}><h4>{t('Selected family request','פניית המשפחה שנבחרה')}</h4>
    <Button variant="quiet" disabled={disabledInputs||dirty} onClick={()=>{setSource(null);void requestFamily();}}>{t('Reload family details','רענון פרטי המשפחה')}</Button></div>
    {loaded===null?<p role="status">{t('Loading saved family details…','טוען את פרטי המשפחה השמורים…')}</p>:loaded.state==='failed'?
     <p role="alert" className="lsw-alert">{nativeFamilyErrorV3(loaded.code,locale)}</p>:family&&<>
      <p><strong>{family.guardianName}</strong></p><ul>{family.children.map(child=><li key={child.id}>{child.name} · {t('Age','גיל')} <bdi>{child.ageYears??t('Not provided','לא נמסר')}</bdi></li>)}</ul>
      {family.contactAdmission==='required'?<p className={styles.notice}>{t('Review and save the contact in Families before creating child records.','יש לבדוק ולשמור את איש הקשר באזור המשפחות לפני יצירת רשומות ילדים.')} <a href={'/'+locale+'/app/clients?'+new URLSearchParams({inquiryId:family.reference})}>{t('Open this request in Families','פתיחת הפנייה באזור המשפחות')}</a></p>:
       !family.association?<form onSubmit={createFamily} className={styles.form}><p>{t('Create separate family and child planning records from the names listed above.','יצירת רשומות תכנון נפרדות למשפחה ולילדים לפי השמות המפורטים למעלה.')}</p>
        <Checkbox id="program-family-reviewed" label={t('I reviewed these names and confirm creating these family and child records.','בדקתי את השמות ואני מאשר/ת יצירת רשומות משפחה וילדים אלו.')} checked={reviewed} disabled={disabledInputs||!workspaceId} onChange={event=>setReviewed(event.target.checked)}/>
        <div className="lsw-actions"><Button type="submit" busy={busy} disabled={disabledInputs||!reviewed||!workspaceId}>{t('Save family records','שמירת רשומות המשפחה')}</Button>
         <Button variant="quiet" disabled={held||!reviewed} onClick={()=>setReviewed(false)}>{t('Discard family review','ביטול בדיקת המשפחה')}</Button></div></form>:
       <section><p className={styles.notice}>{t('Family and child planning records are saved. Contact, guardian and payment approvals remain separate.','רשומות התכנון למשפחה ולילדים נשמרו. אישורי קשר, אפוטרופסות ותשלום נבדקים בנפרד.')}</p>
        {!data&&<p>{t('Load the saved group schedule before planning participant starts.','יש לטעון את לוח הזמנים השמור של הקבוצה לפני תכנון תחילת ההשתתפות.')}</p>}
        {data&&!canPlan&&<p>{t('Participant planning is unavailable while this schedule is cancelled.','לא ניתן לתכנן השתתפות בזמן שלוח הזמנים הזה מבוטל.')}</p>}
        {family.children.map(child=>{
         const mapping=family.association!.command.selection.children.find(item=>item.applicationChildId===child.id);
         const plan=data?.progressions.find(item=>item.record.command.id===mapping?.nativeChildId)?.record.command;
         const fields=plan?.kind==='progression'?plan.fields:undefined;
         const options=data?.lessons.filter(item=>{const c=item.record.command;return c.kind==='lesson'&&c.fields.state==='scheduled'&&
          (!fields||fields.readiness==='needs_foundation'?c.fields.sequence===1:fields.readiness==='foundation_one_complete'?c.fields.sequence<=2:true);})??[];
         const isEditing=editing?.applicationChildId===child.id;
         return <section key={child.id} className={styles.lesson}><h4>{child.name}</h4><p>{!data?t('Group participant plan is unavailable','תוכנית ההשתתפות בקבוצה אינה זמינה'):fields?.state==='withdrawn'?t('Plan withdrawn','התוכנית בוטלה'):fields?t('Participant plan saved','תוכנית המשתתף נשמרה'):t('Not yet planned for this group','עדיין אין תוכנית לקבוצה הזו')}</p>
          {fields&&<p>{readiness(fields.readiness,locale)} · {t('Eligible from','זכאות החל מ־')} <time dateTime={fields.eligibleFrom}>{time(fields.eligibleFrom,locale)}</time></p>}
          {isEditing?<form className={styles.form} onSubmit={event=>{
           event.preventDefault();if(!data||disabledInputs||!editing)return;
           try{const prepared=prepareProgramParticipantSaveV3({data,source:family,applicationChildId:child.id,lessonId:editing.lessonId||undefined,state:editing.state,operationId:crypto.randomUUID()});
            if(!prepared){setEditor(null);return;}if(saveParticipant(prepared))setEditor(null);else report('CONFLICT');
           }catch{report('INVALID_REQUEST');}
          }}><Select id="program-child-lesson" label={t('First eligible saved lesson','השיעור השמור הראשון המתאים')} value={editing.lessonId} disabled={disabledInputs||editing.state==='withdrawn'} onChange={event=>setEditor({...editing,lessonId:event.target.value})}>
            <option value="">{t('Choose a saved lesson…','בחירת שיעור שמור…')}</option>{options.map(item=>{const c=item.record.command;if(c.kind!=='lesson')throw new Error('INVALID_LESSON');return <option key={c.id} value={c.id}>{t('Lesson','שיעור')} {c.fields.sequence} · {time(c.fields.startsAt,locale)}</option>;})}</Select>
           {options.length===0&&<p>{t('Save an eligible foundation lesson before planning a new participant start.','יש לשמור שיעור בסיס מתאים לפני תכנון מועד ההתחלה של משתתף חדש.')}</p>}
           {fields&&<Select id="program-child-state" label={t('Participant plan','תוכנית המשתתף')} value={editing.state} disabled={disabledInputs} onChange={event=>setEditor({...editing,state:event.target.value==='withdrawn'?'withdrawn':'planned'})}>
            <option value="planned">{t('Planned','מתוכנן')}</option><option value="withdrawn">{t('Withdrawn','בוטל')}</option></Select>}
           <div className="lsw-actions"><Button type="submit" disabled={disabledInputs||(!editing.lessonId&&editing.state!=='withdrawn')}>{t('Save participant plan','שמירת תוכנית המשתתף')}</Button>
            <Button variant="quiet" disabled={held} onClick={()=>setEditor(null)}>{t('Discard participant changes','ביטול שינויי המשתתף')}</Button></div></form>:
           <Button variant="secondary" disabled={disabledInputs||editing!==null||!canPlan} onClick={()=>{
            const selected=options.find(item=>item.record.command.kind==='lesson'&&fields&&Date.parse(item.record.command.fields.startsAt)===Date.parse(fields.eligibleFrom));
            setEditor({key,applicationChildId:child.id,lessonId:selected?.record.command.id??'',state:fields?.state??'planned'});
           }}>{fields?t('Edit participant plan','עריכת תוכנית המשתתף'):t('Plan participant start','תכנון תחילת השתתפות')}</Button>}
         </section>;
        })}
       </section>}
     </>}
   </section>}
  </>}
 </section>;
}
