"use client";
import { useState } from "react";
import type { Locale } from "../../features/session-workflow/types.ts";
import type { CheckInState } from "../../features/assignment-participants/contracts.ts";
import { useCommand, type CommandPort } from "./use-command.ts";
import { Section, SaveStatus, word } from "./primitives.tsx";
export interface DailyPracticeItem {
    occurrenceId: string;
    responsibilityId: string;
    title: string;
    instructions: string;
    localTime: string;
    timezone: string;
    participantLabel: string;
    assistanceAllowed: boolean;
    currentState: CheckInState | null;
    expectedRevision: number;
}
export function DailyPracticeCard(props: {
    locale: Locale;
    item: DailyPracticeItem;
    port: CommandPort<{
        occurrenceId: string;
        expectedRevision: number;
        state: CheckInState;
        note: string;
        assisted: "together" | "parent_report" | null;
    }, {
        state: CheckInState;
        revision: number;
    }>;
}) { return <DailyCard key={props.item.occurrenceId} {...props}/>; }
function DailyCard({ locale, item, port }: {
    locale: Locale;
    item: DailyPracticeItem;
    port: CommandPort<{
        occurrenceId: string;
        expectedRevision: number;
        state: CheckInState;
        note: string;
        assisted: "together" | "parent_report" | null;
    }, {
        state: CheckInState;
        revision: number;
    }>;
}) {
    const [state, setState] = useState<CheckInState>(item.currentState ?? "done"), [note, setNote] = useState(""), [mode, setMode] = useState<"together" | "parent_report">("together"), [revision, setRevision] = useState(item.expectedRevision);
    const cmd = useCommand(port, result => { setRevision(result.revision); setState(result.state); });
    const labels: Record<CheckInState, string> = { done: word(locale, "Done", "בוצע"), partly_done: word(locale, "Partly done", "בוצע חלקית"), not_done: word(locale, "Not done", "לא בוצע"), rescheduled: word(locale, "Rescheduled", "נדחה למועד אחר"), not_applicable: word(locale, "Not applicable", "לא רלוונטי") };
    return <Section title={item.title} description={`${item.participantLabel} · ${item.localTime} · ${item.timezone}`}><p className="lsr-instruction">{item.instructions}</p>{item.currentState === null && revision === 0 && <p>{word(locale, "No check-in yet", "עדיין אין דיווח")}</p>}<fieldset disabled={cmd.locked}><legend>{word(locale, "Today's check-in", "הדיווח להיום")}</legend>{item.assistanceAllowed && <><label>{word(locale, "Who is filling this out?", "מי ממלא את הדיווח?")}<select value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="together">{word(locale, "We are doing this together", "אנחנו ממלאים יחד")}</option><option value="parent_report">{word(locale, "I am reporting as the parent", "אני מדווח/ת כהורה")}</option></select></label><p className="lsr-help">{word(locale, "Recorded through this parent's account, not as an independent child login.", "הדיווח יירשם דרך חשבון ההורה, לא ככניסה עצמאית של הילד.")}</p></>}<label>{word(locale, "What happened?", "מה קרה?")}<select value={state} onChange={e => setState(e.target.value as CheckInState)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>{word(locale, "Add a note — optional", "הוספת הערה — לא חובה")}<textarea value={note} maxLength={2000} onChange={e => setNote(e.target.value)}/></label><button type="button" className="lsr-primary" onClick={() => void cmd.execute({ occurrenceId: item.occurrenceId, expectedRevision: revision, state, note, assisted: item.assistanceAllowed ? mode : null })}>{word(locale, "Save check-in", "שמירת דיווח")}</button></fieldset><SaveStatus locale={locale} phase={cmd.phase} error={cmd.error} onReconcile={() => void cmd.reconcile()}/></Section>;
}
