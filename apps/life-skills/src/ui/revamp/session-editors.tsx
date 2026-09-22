"use client";
import { useState } from "react";
import type { BroadFocus, Locale, RoutineRecap, Transcript } from "../../features/session-workflow/types.ts";
import { FOCUS_LABELS } from "../../features/session-workflow/presentation.ts";
import { SaveStatus, word } from "./primitives.tsx";
import { useCommand, type CommandPort } from "./use-command.ts";
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
    labels: Readonly<Record<string, string>>;
}
export function SpeakerLabelsEditor({ sessionId, transcript, locale, port, onSaved }: {
    sessionId: string;
    transcript: Transcript;
    locale: Locale;
    port: CommandPort<SpeakerEditInput, {
        version: number;
    }>;
    onSaved: () => void;
}) {
    const speakers = [...new Set(transcript.segments.map(s => s.speaker))];
    const [labels, setLabels] = useState<Record<string, string>>(Object.fromEntries(speakers.map(s => [s, s])));
    const command = useCommand(port, () => onSaved());
    return <details className="lsr"><summary>{word(locale, "Name the speakers", "שמות הדוברים")}</summary><form onSubmit={e => { e.preventDefault(); void command.execute({ sessionId, transcriptVersion: transcript.version, labels }); }}>
 <p>{word(locale, "Name speakers yourself. The source labels stay unchanged; this creates a separate version. There is no voiceprint identification.", "ניתן לתת שמות לדוברים. סימוני המקור נשמרים ללא שינוי ונוצרת גרסה נפרדת. אין זיהוי ביומטרי של הקול.")}</p>{speakers.map(s => <label key={s}>{s}<input maxLength={80} required value={labels[s] ?? s} disabled={command.locked} onChange={e => setLabels(v => ({ ...v, [s]: e.target.value }))}/></label>)}<button className="lsr-primary" type="submit" disabled={command.locked}>{word(locale, "Save speaker labels", "שמירת שמות הדוברים")}</button><SaveStatus locale={locale} phase={command.phase} error={command.error} onReconcile={() => void command.reconcile()}/></form></details>;
}
