'use client';
import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {Button,Input} from '../../ui/workspace/controls.tsx';
import type {ErrorCode} from '../../lib/errors.ts';
import {
 GROUP_PREPARATION_VERSION,groupPreparationCommand,groupPreparationId,groupPreparationRevision,
 type GroupPreparationListPage,type GroupPreparationRecord,
} from './group-preparation-contract.ts';
import {
 createGroupPreparationClient,createGroupDraft,editGroupDraft,groupDraftInputs,groupPreparationHref,groupSaveMatches,prepareGroupSave,
 type GroupDraftInputs,type GroupSaveResult,type PreparedGroupSave,
} from './group-preparation-client.ts';
import styles from './group-preparation-workspace.module.css';

type Locale='en'|'he';
export type PendingGroupOperation={save:PreparedGroupSave;uncertain:boolean};
type Selection={current:GroupPreparationRecord;view:GroupPreparationRecord;historical:boolean};
type LoadSelection={cursor:string|null;groupId?:string;revision?:number;trail:(string|null)[]};
const emptyInputs=():GroupDraftInputs=>({label:'',firstClassLocalDate:'',proposedCapacity:''});
export function retainGroupOperation(pending:PendingGroupOperation,result:GroupSaveResult):PendingGroupOperation|null{
 if(result.state==='saved')return null;
 return result.state==='unknown'||pending.uncertain?{save:pending.save,uncertain:true}:null;
}
export function groupPreparationError(code:ErrorCode,locale:Locale):string{
 const text={
  UNAUTHENTICATED:['Your session ended. Sign in again, then reload or retry the same save.','פג תוקף החיבור. יש להתחבר מחדש ואז לרענן או לנסות שוב את אותה שמירה.'],
  FORBIDDEN:['This account cannot access these Fishing group drafts.','לחשבון הזה אין גישה לטיוטות קבוצות הדיג.'],
  NOT_FOUND:['That saved group or revision is not available.','הקבוצה או הגרסה השמורה אינן זמינות.'],
  CONFLICT:['The record changed or the operation conflicts. Reload the saved record before making a new edit.','הרשומה השתנתה או שהפעולה מתנגשת. יש לרענן את הרשומה השמורה לפני עריכה חדשה.'],
  INVALID_REQUEST:['Check the label, proposed date and whole-number capacity. A date must agree with any saved time and planning window.','יש לבדוק את השם, התאריך המוצע והקיבולת במספר שלם. התאריך צריך להתאים לשעה ולטווח התכנון השמורים.'],
  RATE_LIMITED:['Too many requests. Wait a moment, then use the same retry or reload action.','בוצעו בקשות רבות מדי. המתינו מעט ואז נסו שוב את אותה פעולה או רעננו.'],
  UNAVAILABLE:['The request could not be confirmed. This is not an empty list or a full group.','לא ניתן לאמת את הבקשה. אין פירוש הדבר שהרשימה ריקה או שהקבוצה מלאה.'],
  INTERNAL:['The request could not be confirmed. Reload saved records or check the same operation.','לא ניתן לאמת את הבקשה. יש לרענן את הרשומות השמורות או לבדוק את אותה פעולה.'],
  PAYLOAD_TOO_LARGE:['The save is too large. Review the entered information.','הבקשה לשמירה גדולה מדי. יש לבדוק את הפרטים שהוזנו.'],
  UNSUPPORTED_MEDIA_TYPE:['The save format was not accepted. Reload before making another edit.','תבנית השמירה לא התקבלה. יש לרענן לפני עריכה נוספת.'],
 } satisfies Record<ErrorCode,readonly[string,string]>;
 return text[code][locale==='he'?1:0];
}
function floridaTime(value:string,locale:Locale){
 return new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/New_York'}).format(new Date(value));
}
function localDate(value:string,locale:Locale){
 return new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-US',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
}
export function GroupPreparationRecordSummary({record,locale}:{record:GroupPreparationRecord;locale:Locale}){
 const t=(en:string,he:string)=>locale==='he'?he:en,f=record.fields,unset=t('Not set','לא הוגדר');
 return <dl className={styles.facts}>
  <div><dt>{t('Status','מצב')}</dt><dd>{record.state==='draft'?t('Draft','טיוטה'):t('Cancelled draft','טיוטה שבוטלה')}</dd></div>
  <div><dt>{t('Proposed capacity','קיבולת מוצעת')}</dt><dd>{f.proposedCapacity===null?unset:<bdi>{f.proposedCapacity}</bdi>}</dd></div>
  <div><dt>{t('Proposed first class date','תאריך מוצע לשיעור ראשון')}</dt><dd>{f.firstClassLocalDate?<time dateTime={f.firstClassLocalDate}>{localDate(f.firstClassLocalDate,locale)}</time>:unset}</dd></div>
  <div><dt>{t('Proposed first class time · Florida','שעה מוצעת לשיעור ראשון · פלורידה')}</dt><dd>{f.firstClassAt?<time dateTime={f.firstClassAt}>{floridaTime(f.firstClassAt,locale)}</time>:unset}</dd></div>
  <div><dt>{t('Location reference','אסמכתה למקום')}</dt><dd>{f.venueSource?<><span>{t('Saved reference','אסמכתה שמורה')}</span><details><summary>{t('View reference','הצגת האסמכתה')}</summary><bdi className={styles.reference}>{f.venueSource.id}</bdi></details></>:unset}</dd></div>
  <div><dt>{t('Proposed planning window','טווח תכנון מוצע')}</dt><dd>{f.period?<><time dateTime={f.period.startsAt}>{floridaTime(f.period.startsAt,locale)}</time><span> — </span><time dateTime={f.period.endsAt}>{floridaTime(f.period.endsAt,locale)}</time></>:unset}</dd></div>
  <div><dt>{t('Saved revision','גרסה שמורה')}</dt><dd><bdi>{record.revision}</bdi></dd></div>
  <div><dt>{t('Saved at · Florida','מועד השמירה · פלורידה')}</dt><dd><time dateTime={record.recordedAt}>{floridaTime(record.recordedAt,locale)}</time></dd></div>
 </dl>;
}
function DraftFields({value,onChange,disabled,locale,prefix}:{value:GroupDraftInputs;onChange:(value:GroupDraftInputs)=>void;disabled:boolean;locale:Locale;prefix:string}){
 const t=(en:string,he:string)=>locale==='he'?he:en;
 return <fieldset disabled={disabled} className={styles.fields}><legend className="lsw-visually-hidden">{t('Group draft details','פרטי טיוטת הקבוצה')}</legend>
  <Input id={prefix+'-label'} label={t('Group name','שם הקבוצה')} value={value.label} required maxLength={160} onChange={e=>onChange({...value,label:e.target.value})}/>
  <div className={styles.fieldPair}>
   <Input id={prefix+'-date'} label={t('Proposed first class date','תאריך מוצע לשיעור ראשון')} type="date" value={value.firstClassLocalDate}
    help={t('Florida local date; leave blank if unknown.','תאריך מקומי בפלורידה; אפשר להשאיר ריק אם אינו ידוע.')} onChange={e=>onChange({...value,firstClassLocalDate:e.target.value})}/>
   <Input id={prefix+'-capacity'} label={t('Proposed capacity','קיבולת מוצעת')} inputMode="numeric" value={value.proposedCapacity}
    help={t('A planning number, not verified available seats. Blank means not set; zero is kept as zero.','מספר לצורכי תכנון, לא מספר מקומות פנויים מאומת. ריק פירושו לא הוגדר; אפס נשמר כאפס.')} onChange={e=>onChange({...value,proposedCapacity:e.target.value})}/>
  </div>
 </fieldset>;
}
export function GroupPreparationPendingNotice({pending,busy,locale,retry,check}:{pending:PendingGroupOperation;busy:boolean;locale:Locale;retry:()=>void;check:()=>void}){
 const t=(en:string,he:string)=>locale==='he'?he:en;
 return <section className={'lsw-alert '+styles.notice} aria-labelledby="group-save-recovery">
  <h2 id="group-save-recovery">{t('Save not confirmed','השמירה טרם אומתה')}</h2>
  <p>{pending.save.command.action==='create'?t('Original action: create draft.','הפעולה המקורית: יצירת טיוטה.'):
   pending.save.command.action==='edit'?t('Original action: edit draft.','הפעולה המקורית: עריכת טיוטה.'):t('Original action: cancel draft.','הפעולה המקורית: ביטול טיוטה.')}</p>
  <p>{t('Keep this page open. The original operation is retained. Checking or retrying uses that same save; do not create a replacement draft.','יש להשאיר את הדף פתוח. הפעולה המקורית נשמרת. בדיקה או ניסיון חוזר משתמשים באותה שמירה; אין ליצור טיוטה חלופית.')}</p>
  <div className="lsw-actions"><Button busy={busy} onClick={check}>{t('Check saved result','בדיקת התוצאה השמורה')}</Button>
   <Button variant="secondary" disabled={busy} onClick={retry}>{t('Retry the same save','ניסיון חוזר לאותה שמירה')}</Button></div>
 </section>;
}
export function FishingGroupPreparationWorkspace({locale,initialGroupId,initialRevision}:{locale:Locale;initialGroupId?:string;initialRevision?:number}){
 const t=(en:string,he:string)=>locale==='he'?he:en;
 const initialValid=(initialGroupId===undefined||groupPreparationId.safeParse(initialGroupId).success)&&
  (initialRevision===undefined||(initialGroupId!==undefined&&groupPreparationRevision.safeParse(initialRevision).success));
 const selectionKey=(initialGroupId??'')+':'+(initialRevision??'');
 const client=useMemo(()=>createGroupPreparationClient(),[]);
 const [page,setPage]=useState<GroupPreparationListPage|null>(null),[selection,setSelection]=useState<Selection|null>(null);
 const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState<ErrorCode|null>(null),[actionError,setActionError]=useState<ErrorCode|null>(null);
 const [loadedSelection,setLoadedSelection]=useState(selectionKey);
 const [pending,setPending]=useState<PendingGroupOperation|null>(null),[busy,setBusy]=useState(false);
 const [created,setCreated]=useState<GroupDraftInputs>(emptyInputs),[editing,setEditing]=useState<GroupDraftInputs|null>(null),[cancelChecked,setCancelChecked]=useState(false);
 const [receipt,setReceipt]=useState<{record:GroupPreparationRecord;replayed:boolean}|null>(null),[notice,setNotice]=useState<''|'no_changes'|'unconfirmed'>('');
 const [trail,setTrail]=useState<(string|null)[]>([null]),[historyInput,setHistoryInput]=useState('');
 const pendingRef=useRef<PendingGroupOperation|null>(null),busyRef=useRef(false),alive=useRef(false),serial=useRef(0);
 const readAbort=useRef<AbortController|null>(null),saveAbort=useRef<AbortController|null>(null);
 const lastLoad=useRef<LoadSelection>({cursor:null,trail:[null]});
 const detailHeading=useRef<HTMLHeadingElement>(null);
 const updatePending=(value:PendingGroupOperation|null)=>{pendingRef.current=value;setPending(value);};
 const loseAccess=useCallback(()=>{
  // A late read from before a known access denial must not restore its data.
  serial.current++;readAbort.current?.abort();setLoading(false);
  setPage(null);setSelection(null);setEditing(null);setReceipt(null);setNotice('');
 },[]);
 const load=useCallback(async(request:LoadSelection)=>{
  const run=++serial.current;readAbort.current?.abort();const controller=new AbortController();readAbort.current=controller;
  lastLoad.current=request;
  const current=()=>alive.current&&run===serial.current&&!controller.signal.aborted;
  try{
   const list=await client.list(request.cursor,controller.signal);if(!current())return;
   setLoadedSelection(selectionKey);setLoading(true);setPage(null);setSelection(null);setEditing(null);setCancelChecked(false);setLoadError(null);
   if(list.state==='failed'){setLoadError(list.code);if(list.code==='UNAUTHENTICATED'||list.code==='FORBIDDEN')loseAccess();return;}
   let found:Selection|null=null;
   if(request.groupId){
    const now=await client.record(request.groupId,undefined,controller.signal);if(!current())return;
    if(now.state==='failed'){setLoadError(now.code);if(now.code==='UNAUTHENTICATED'||now.code==='FORBIDDEN')loseAccess();return;}
    let view=now.value;
    if(request.revision!==undefined){
     const old=await client.record(request.groupId,request.revision,controller.signal);if(!current())return;
     if(old.state==='failed'){setLoadError(old.code);if(old.code==='UNAUTHENTICATED'||old.code==='FORBIDDEN')loseAccess();return;}
     if(old.value.workspaceId!==now.value.workspaceId||old.value.revision>now.value.revision){setLoadError('UNAVAILABLE');return;}
     view=old.value;
    }
    found={current:now.value,view,historical:request.revision!==undefined};
   }
   setPage(list.value);setSelection(found);setTrail(request.trail);
   if(found)setHistoryInput(String(found.view.revision));
  }finally{if(current())setLoading(false);}
 },[client,loseAccess,selectionKey]);
 const beginLoad=useCallback((request:LoadSelection)=>{
  setLoading(true);setPage(null);setSelection(null);setEditing(null);setCancelChecked(false);setLoadError(null);
  return load(request);
 },[load]);
 useEffect(()=>{
  alive.current=true;
  if(initialValid)void load({cursor:null,trail:[null],...(initialGroupId?{groupId:initialGroupId}:{}),...(initialRevision!==undefined?{revision:initialRevision}:{})});
  return()=>{alive.current=false;readAbort.current?.abort();saveAbort.current?.abort();};
 },[initialGroupId,initialRevision,initialValid,load]);
 const createDirty=Object.values(created).some(value=>value!=='');
 const formDirty=createDirty||editing!==null;
 useEffect(()=>{
  const guard=(event:BeforeUnloadEvent)=>{if(pendingRef.current||formDirty){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);
 },[formDirty]);
 async function save(next:PendingGroupOperation){
  if(busyRef.current)return;
  busyRef.current=true;setBusy(true);setActionError(null);setNotice('');updatePending(next);
  const controller=new AbortController();saveAbort.current=controller;
  try{
   const result=await client.save(next.save,controller.signal);if(!alive.current)return;
   const retained=retainGroupOperation(next,result);updatePending(retained);
   if(result.state==='saved'){
    setReceipt({record:result.record,replayed:result.replayed});if(result.record.action==='create')setCreated(emptyInputs());setEditing(null);
    await beginLoad({cursor:null,trail:[null],groupId:result.record.groupId});
    detailHeading.current?.focus();
   }else{
    setActionError(result.code);
    if(result.code==='UNAUTHENTICATED'||result.code==='FORBIDDEN')loseAccess();
   }
  }finally{busyRef.current=false;if(alive.current)setBusy(false);}
 }
 async function checkPending(){
  const original=pendingRef.current;if(!original||busyRef.current)return;
  busyRef.current=true;setBusy(true);setActionError(null);setNotice('');
  const run=++serial.current;readAbort.current?.abort();const controller=new AbortController();readAbort.current=controller;setLoading(false);
  try{
   const read=await client.record(original.save.command.groupId,original.save.command.expectedRevision+1,controller.signal);
   if(!alive.current||run!==serial.current||controller.signal.aborted)return;
   if(read.state==='ready'&&groupSaveMatches(original.save,read.value)){
    updatePending(null);setReceipt({record:read.value,replayed:true});if(read.value.action==='create')setCreated(emptyInputs());
    await beginLoad({cursor:null,trail:[null],groupId:read.value.groupId});
   }else{
    const code=read.state==='failed'?read.code:'CONFLICT';setActionError(code);
    setNotice('unconfirmed');
    if(code==='UNAUTHENTICATED'||code==='FORBIDDEN')loseAccess();
   }
  }finally{busyRef.current=false;if(alive.current)setBusy(false);}
 }
 function create(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(pendingRef.current||busyRef.current)return;setActionError(null);setReceipt(null);setNotice('');
  try{void save({save:createGroupDraft(crypto.randomUUID(),crypto.randomUUID(),created),uncertain:false});}
  catch{setActionError('INVALID_REQUEST');}
 }
 function edit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!selection||selection.historical||!editing||pendingRef.current||busyRef.current)return;
  setActionError(null);setReceipt(null);setNotice('');
  try{
   const command=editGroupDraft(selection.current,crypto.randomUUID(),editing);
   if(!command){setNotice('no_changes');return;}
   void save({save:command,uncertain:false});
  }catch{setActionError('INVALID_REQUEST');}
 }
 function cancel(){
  if(!selection||selection.historical||!cancelChecked||pendingRef.current||busyRef.current)return;
  setReceipt(null);setNotice('');setActionError(null);
  try{void save({save:prepareGroupSave(groupPreparationCommand.parse({version:GROUP_PREPARATION_VERSION,action:'cancel',
   groupId:selection.current.groupId,operationId:crypto.randomUUID(),expectedRevision:selection.current.revision})),uncertain:false});}
  catch{setActionError('INVALID_REQUEST');}
 }
 const waiting=loading||loadedSelection!==selectionKey;
 const locked=busy||pending!==null||waiting;
 const navigationLocked=locked||formDirty;
 function history(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!selection||navigationLocked)return;
  const revision=/^[1-9]\d*$/.test(historyInput)?Number(historyInput):NaN;
  if(!groupPreparationRevision.safeParse(revision).success||revision>selection.current.revision){setActionError('INVALID_REQUEST');return;}
  setActionError(null);void beginLoad({...lastLoad.current,groupId:selection.current.groupId,revision});
 }
 return <main className={'lsw-main '+styles.workspace} lang={locale} dir={locale==='he'?'rtl':'ltr'}>
  <header className={'lsw-page-header '+styles.header}><div><p className="lsw-eyebrow">{t('Fishing groups','קבוצות דיג')}</p>
   <h1>{t('Group preparation','הכנת קבוצות')}</h1><p>{t('Plan a group and revisit its saved revisions.','תכנון קבוצה ועיון בגרסאות השמורות שלה.')}</p></div>
   <a href={groupPreparationHref(locale)}>{t('Group list','רשימת הקבוצות')}</a></header>
  <p className={styles.boundary}>{t('Drafts are planning records. They do not confirm a location, lesson, available seat, reservation or payment deadline.','טיוטות הן רשומות תכנון. הן אינן מאשרות מקום, שיעור, מקום פנוי, הזמנה או מועד לתשלום.')}</p>
  {actionError&&<div role="alert" className="lsw-alert">{groupPreparationError(actionError,locale)}</div>}
  {notice&&<p role="status">{notice==='no_changes'?t('There are no changes to save.','אין שינויים לשמירה.'):
   t('The original save is still unconfirmed. Its operation and entered values have been retained.','השמירה המקורית עדיין לא אומתה. הפעולה והפרטים שהוזנו נשמרו.')}</p>}
  {receipt&&initialValid&&loadedSelection===selectionKey&&<p role="status" className={styles.saved}>{t('Save confirmed','השמירה אומתה')} · {receipt.record.fields.label} · {t('revision','גרסה')} <bdi>{receipt.record.revision}</bdi>
   {receipt.replayed&&<> · {t('original operation result','תוצאת הפעולה המקורית')}</>}
   {receipt.record.action==='cancel'&&<> · {t('draft cancelled','הטיוטה בוטלה')}</>}
  </p>}
  {pending?.uncertain&&<GroupPreparationPendingNotice pending={pending} busy={busy} locale={locale} retry={()=>void save(pending)} check={()=>void checkPending()}/>}
  {(!initialValid||(loadError&&loadedSelection===selectionKey))&&<section className="lsw-alert" role="alert"><p>{!initialValid?
   t('This group link is invalid. Open the group list.','קישור הקבוצה אינו תקין. יש לפתוח את רשימת הקבוצות.'):groupPreparationError(loadError!,locale)}</p>
   <p>{t('No saved list or detail is being shown from an earlier response.','לא מוצגים רשימה או פרטים שמורים מתשובה קודמת.')}</p>
   {initialValid&&<Button variant="secondary" disabled={busy} onClick={()=>void beginLoad(lastLoad.current)}>{t('Reload saved records','רענון הרשומות השמורות')}</Button>}
  </section>}
  {waiting&&initialValid&&<p role="status">{t('Loading saved group drafts…','טוען טיוטות קבוצה שמורות…')}</p>}
  {page&&!waiting&&initialValid&&<div className={styles.columns}>
   <section className={'lsw-card '+styles.list} aria-labelledby="saved-group-drafts"><div className={styles.sectionHeader}>
    <h2 id="saved-group-drafts">{t('Saved group drafts','טיוטות קבוצה שמורות')}</h2><Button variant="quiet" disabled={navigationLocked} onClick={()=>void beginLoad(lastLoad.current)}>{t('Refresh','רענון')}</Button></div>
    {page.items.length===0?<p>{t('No group drafts on this page. Create one below when you are ready.','אין טיוטות קבוצה בעמוד זה. אפשר ליצור טיוטה בהמשך.')}</p>:
     <ul className={styles.items}>{page.items.map(record=><li key={record.groupId}>
      {navigationLocked?<span>{record.fields.label}</span>:<a href={groupPreparationHref(locale,record.groupId)} aria-current={selection?.current.groupId===record.groupId?'page':undefined}>{record.fields.label}</a>}
      <p>{record.state==='draft'?t('Draft','טיוטה'):t('Cancelled draft','טיוטה שבוטלה')} · {t('revision','גרסה')} <bdi>{record.revision}</bdi></p>
     </li>)}</ul>}
    <nav className={styles.pager} aria-label={t('Group draft pages','עמודי טיוטות קבוצה')}>
     <Button variant="secondary" disabled={navigationLocked||trail.length<2} onClick={()=>{const previous=trail.slice(0,-1);void beginLoad({...lastLoad.current,cursor:previous[previous.length-1]??null,trail:previous});}}>{t('Previous','הקודם')}</Button>
     <span>{t('Page','עמוד')} <bdi>{trail.length}</bdi></span>
     <Button variant="secondary" disabled={navigationLocked||page.nextCursor===null} onClick={()=>{if(page.nextCursor)void beginLoad({...lastLoad.current,cursor:page.nextCursor,trail:[...trail,page.nextCursor]});}}>{t('Next','הבא')}</Button>
    </nav><p className="lsw-help">{t('Pages show current drafts and cancellations. Refresh may change their contents.','העמודים מציגים טיוטות וביטולים עדכניים. תוכנם עשוי להשתנות ברענון.')}</p>
    <section className={styles.create} aria-labelledby="create-group-draft"><h2 id="create-group-draft">{t('New group draft','טיוטת קבוצה חדשה')}</h2>
     {editing&&<p>{t('Finish or discard the current edit before creating another draft.','יש לסיים או לבטל את העריכה הנוכחית לפני יצירת טיוטה נוספת.')}</p>}
     <form onSubmit={create} className={styles.form}><DraftFields prefix="create-group" locale={locale} value={created} onChange={setCreated} disabled={locked||editing!==null}/>
      <div className="lsw-actions"><Button type="submit" busy={busy} disabled={locked||editing!==null}>{t('Save draft','שמירת טיוטה')}</Button>
       <Button variant="quiet" disabled={locked||!createDirty} onClick={()=>setCreated(emptyInputs())}>{t('Clear new draft','ניקוי הטיוטה החדשה')}</Button></div></form>
    </section>
   </section>
   <section className="lsw-card" aria-labelledby="group-draft-detail"><h2 id="group-draft-detail" ref={detailHeading} tabIndex={-1}>{t('Group details and history','פרטי הקבוצה והיסטוריה')}</h2>
    {!selection?<p>{t('Choose a saved group to see its current details and earlier revisions.','בחרו קבוצה שמורה כדי לראות את פרטיה העדכניים וגרסאות קודמות.')}</p>:<>
     <h3>{selection.view.fields.label}</h3>
     {selection.historical&&<p role="status" className={styles.historyNotice}>{t('Historical revision · read only','גרסה היסטורית · לקריאה בלבד')} <bdi>{selection.view.revision}</bdi>
      {' · '}{t('Latest revision','הגרסה האחרונה')} <bdi>{selection.current.revision}</bdi></p>}
     <GroupPreparationRecordSummary record={selection.view} locale={locale}/>
     {!navigationLocked&&<a href={groupPreparationHref(locale,selection.view.groupId,selection.historical?selection.view.revision:undefined)}>{t('Open this saved view','פתיחת התצוגה השמורה')}</a>}
     <form onSubmit={history} className={styles.history}>
      <Input id="group-history-revision" label={t('Saved revision number','מספר הגרסה השמורה')} inputMode="numeric" value={historyInput} disabled={navigationLocked} onChange={e=>setHistoryInput(e.target.value)}/>
      <Button type="submit" variant="secondary" disabled={navigationLocked}>{t('Read revision','קריאת גרסה')}</Button>
      <Button variant="quiet" disabled={navigationLocked||!selection.historical} onClick={()=>void beginLoad({cursor:lastLoad.current.cursor,trail,groupId:selection.current.groupId})}>{t('Latest saved version','הגרסה השמורה האחרונה')}</Button>
     </form>
     {!selection.historical&&selection.current.state==='draft'&&<>
      {editing?<form className={styles.form} onSubmit={edit}><h3>{t('Edit proposed details','עריכת פרטי התכנון')}</h3>
       <DraftFields prefix="edit-group" locale={locale} value={editing} onChange={setEditing} disabled={locked}/>
       <p className="lsw-help">{t('Blanking a date or capacity explicitly clears it. Other saved planning facts stay unchanged.','מחיקת תאריך או קיבולת מנקה אותם במפורש. פרטי התכנון האחרים נשארים ללא שינוי.')}</p>
       <div className="lsw-actions"><Button type="submit" busy={busy} disabled={locked}>{t('Save changes','שמירת שינויים')}</Button>
        <Button variant="quiet" disabled={locked} onClick={()=>setEditing(null)}>{t('Discard edits','ביטול העריכה')}</Button></div>
      </form>:<><Button variant="secondary" disabled={locked||createDirty} onClick={()=>{setActionError(null);setEditing(groupDraftInputs(selection.current));}}>{t('Edit draft','עריכת הטיוטה')}</Button>
       {createDirty&&<p>{t('Save or clear the new draft before editing this record.','יש לשמור או לנקות את הטיוטה החדשה לפני עריכת רשומה זו.')}</p>}</>}
      <details className={styles.cancel}><summary>{t('Cancel this draft','ביטול הטיוטה')}</summary>
       <p>{t('Cancellation saves a new revision and keeps the history. It does not cancel a family booking or issue a refund.','הביטול שומר גרסה חדשה ומשאיר את ההיסטוריה. הוא אינו מבטל הזמנה של משפחה ואינו מבצע החזר כספי.')}</p>
       <label className="lsw-choice"><input type="checkbox" checked={cancelChecked} disabled={navigationLocked} onChange={e=>setCancelChecked(e.target.checked)}/>{t('I want to cancel this planning draft.','ברצוני לבטל את טיוטת התכנון הזו.')}</label>
       <Button variant="danger" disabled={navigationLocked||!cancelChecked} onClick={cancel}>{t('Confirm draft cancellation','אישור ביטול הטיוטה')}</Button>
      </details>
     </>}
    </>}
   </section>
  </div>}
 </main>;
}
export {FishingGroupPreparationWorkspace as GroupPreparationWorkspace};
