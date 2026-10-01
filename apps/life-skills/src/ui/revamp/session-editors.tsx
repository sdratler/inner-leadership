"use client";
import { useEffect,useState } from "react";
import type { BroadFocus, Locale, RoutineRecap, Transcript } from "../../features/session-workflow/types.ts";
import { FOCUS_LABELS } from "../../features/session-workflow/presentation.ts";
import { SaveStatus, word } from "./primitives.tsx";
import { useCommand, type CommandPort } from "./use-command.ts";
import {sameSpeakerLabels} from "../../features/session-workflow/speaker-corrections.ts";
import type {SpeakerSaveReceipt} from "../../features/session-workflow/client.ts";
import type {TranscriptReadMetadata} from "../../features/session-workflow/private-records.ts";
export interface RecapEditInput {
    sessionId: string;
    expectedVersion: number;
    locale: Locale;
    focus: readonly BroadFocus[];
    nextStep: string;
}
/** The server owns attendance, calendar facts and published responsibility versions. This editor cannot change them. */
export function RoutineRecapEditor({ sessionId, initial, locale, port, onSaved, onCancel }: {
    sessionId: string;
    initial: RoutineRecap | null;
    locale: Locale;
    port: CommandPort<RecapEditInput, {
        recap: RoutineRecap;
        digest: string;
    }>;
    onSaved: () => void;
    onCancel: () => void;
}) {
    const [focus, setFocus] = useState<readonly BroadFocus[]>(initial?.focus ?? []), [nextStep, setNextStep] = useState(initial?.nextStep ?? ""), [language, setLanguage] = useState<Locale>(initial?.locale ?? locale);
    const command = useCommand(port, () => onSaved());
    return <form className="lsr" onSubmit={e => { e.preventDefault(); void command.execute({ sessionId, expectedVersion: initial?.version ?? 0, locale: language, focus, nextStep }); }}>
 <fieldset disabled={command.locked}><legend>{word(locale, "Broad focus — at most three", "מוקד כללי — עד שלושה נושאים")}</legend><div className="lsr-choice-grid">{(Object.keys(FOCUS_LABELS) as BroadFocus[]).map(id => <label key={id}><input type="checkbox" checked={focus.includes(id)} disabled={!focus.includes(id) && focus.length >= 3} onChange={e => setFocus(e.target.checked ? [...focus, id] : focus.filter(x => x !== id))}/>{FOCUS_LABELS[id][locale]}</label>)}</div></fieldset>
 <label>{word(locale, "Short next step", "הצעד הבא בקצרה")}<textarea value={nextStep} maxLength={300} rows={3} disabled={command.locked} onChange={e => setNextStep(e.target.value)}/></label>
 <label>{word(locale, "Language of this saved version", "שפת הגרסה השמורה הזאת")}<select value={language} disabled={command.locked} onChange={e => setLanguage(e.target.value as Locale)}><option value="en">English</option><option value="he">עברית</option></select></label>
 <p className="lsr-help">{word(locale, "Selecting a language labels the text you write; it does not silently translate it. An AI translation is a new reviewed version. Attendance, assignments and next meeting come from their records.", "בחירת שפה מסמנת את שפת הטקסט שכתבת; היא אינה מתרגמת אותו. תרגום בבינה מלאכותית הוא גרסה חדשה לבדיקה. נוכחות, תרגול והמועד הבא מגיעים מהרשומות שלהם.")}</p>
 <div className="lsr-actions"><button className="lsr-primary" disabled={command.locked} type="submit">{word(locale, "Save update draft", "שמירת טיוטת עדכון")}</button><button disabled={command.locked} type="button" onClick={onCancel}>{word(locale, "Cancel", "ביטול")}</button></div><SaveStatus locale={locale} phase={command.phase} error={command.error} onReconcile={() => void command.reconcile()}/></form>;
}
export interface SpeakerEditInput {
    sessionId: string;
    transcriptVersion: number;
    expectedRevision:number;
    labels: Readonly<Record<string, string>>;
}
export function SpeakerLabelsEditor({ sessionId, transcript,saved, locale, port, onSaved }: {
    sessionId: string;
    transcript: Transcript;
    saved?:TranscriptReadMetadata|null|undefined;
    locale: Locale;
    port: CommandPort<SpeakerEditInput,SpeakerSaveReceipt>;
    onSaved: () => void;
}) {
    const fromSaved=()=>Object.fromEntries([...new Set(transcript.segments.map(segment=>segment.speaker))].map(key=>[key,saved&&Object.hasOwn(saved.speakers,key)?saved.speakers[key]!:key]));
    const [source,setSource]=useState(transcript),[labels,setLabels]=useState<Record<string,string>>(fromSaved),[baseline,setBaseline]=useState(fromSaved),[revision,setRevision]=useState(saved?.speakerHistory.revision??0);
    const dirty=!sameSpeakerLabels(labels,baseline),speakers=[...new Set(source.segments.map(segment=>segment.speaker))];
    const command=useCommand(port,result=>{setBaseline(labels);setRevision(result.revision);onSaved();});
    const newer=source.version!==transcript.version||saved&&saved.speakerHistory.revision!==revision;
    useEffect(()=>{if(!dirty&&!command.locked)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[dirty,command.locked]);
    const error=command.error==="CONFLICT"?word(locale,"A newer transcript or speaker revision exists. Your labels are still here. Read the current session and compare its saved history before choosing to discard these edits.","יש גרסת תמלול או דוברים חדשה יותר. השמות שערכת עדיין כאן. יש לקרוא את המפגש ולהשוות להיסטוריה לפני בחירה בביטול השינויים."):command.error?word(locale,"Speaker labels were not saved. Your edits are still here; check your authorized session and the label fields.","שמות הדוברים לא נשמרו. השינויים שלך עדיין כאן; יש לבדוק את הרשאת המפגש ואת השדות."):null;
    return <details className="lsr"><summary>{word(locale,"Name the speakers","שמות הדוברים")}</summary><form onSubmit={event=>{event.preventDefault();void command.execute({sessionId,transcriptVersion:source.version,expectedRevision:revision,labels});}}>
      <p>{word(locale,"Name speakers yourself. Source labels and text stay unchanged; each correction has a separate saved revision. There is no voiceprint identification or new AI request.","ניתן לתת שמות לדוברים. סימוני המקור והטקסט אינם משתנים; כל תיקון נשמר בגרסה נפרדת. אין זיהוי ביומטרי או בקשה חדשה לבינה מלאכותית.")}</p>
      <p className="lsr-help">{word(locale,"Editing transcript version","עריכת גרסת תמלול")} {source.version} · {word(locale,"Speaker revision","גרסת דוברים")} {revision}</p>
      {newer&&<p role="alert">{word(locale,"The current saved version differs from this draft. Your edits were not replaced.","הגרסה השמורה שונה מהטיוטה הזאת. השינויים שלך לא הוחלפו.")}</p>}
      {speakers.map(key=><label key={key}>{key}<input dir="auto" maxLength={100} required value={Object.hasOwn(labels,key)?labels[key]!:key} disabled={command.locked} onChange={event=>setLabels(value=>({...value,[key]:event.target.value}))}/></label>)}
      <div className="lsr-actions"><button className="lsr-primary" type="submit" disabled={command.locked||!dirty||Boolean(newer)}>{word(locale,"Save speaker labels","שמירת שמות הדוברים")}</button><button type="button" disabled={command.locked} onClick={()=>{const current=fromSaved();setSource(transcript);setLabels(current);setBaseline(current);setRevision(saved?.speakerHistory.revision??0);}}>{word(locale,"Discard edits / use saved labels","ביטול שינויים / שימוש בשמות השמורים")}</button></div>
      <SaveStatus locale={locale} phase={command.phase} error={error} onReconcile={()=>void command.reconcile()}/>
    </form>{saved&&<details><summary>{word(locale,"Saved speaker revision history","היסטוריית גרסאות דוברים שמורות")}</summary><p>{word(locale,"Original saved mapping — author/date were not recorded","מיפוי מקורי שנשמר — מחבר ותאריך לא נרשמו")}</p>{Object.entries(saved.speakerHistory.originalLabels).map(([key,value])=><p key={key} dir="auto">{key}: {value}</p>)}{saved.speakerHistory.versions.map(version=><section key={version.revision}><h3>{word(locale,"Revision","גרסה")} {version.revision}</h3><p>{new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Jerusalem"}).format(new Date(version.recordedAt))} · {word(locale,"Recorded by practitioner","נרשם על ידי המטפל")}</p>{Object.entries(version.labels).map(([key,value])=><p key={key} dir="auto">{key}: {value}</p>)}</section>)}</details>}</details>;
}
