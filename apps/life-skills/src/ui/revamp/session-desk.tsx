"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { validIso } from "../../features/session-workflow/policy.ts";
import type { Locale, PrivateAnalysis, RoutineRecap, Transcript, ProcessingStage, AudioState } from "../../features/session-workflow/types.ts";
import type { PrivateSessionReadMetadata } from "../../features/session-workflow/private-records.ts";
import type { MetricValues, MetricRecord } from "../../features/session-workflow/metrics.ts";
import { FOCUS_LABELS, attendanceLabel,sessionProcessingLabel } from "../../features/session-workflow/presentation.ts";
import type {SpeakerSaveReceipt} from "../../features/session-workflow/client.ts";
import { RoutineRecapEditor, SpeakerLabelsEditor, type RecapEditInput, type SpeakerEditInput } from "./session-editors.tsx";
import { SessionMetricFields } from "./session-metrics.tsx";
import { PrivateObservationEvidencePanel } from "../../features/session-workflow/private-observation-evidence.tsx";
import { Section, SaveStatus, word } from "./primitives.tsx";
import { useCommand, type CommandPort } from "./use-command.ts";
import "./styles.css";
/** Only a practitioner-authorized server loader may supply this DTO. Never return it to family/client routes. */
export interface SessionDeskModel {
    /** Present on the real authorized server DTO, absent on component-gallery examples. */
    workspaceId?: string;
    caseId: string;
    sessionId: string;
    clientDisplayName: string;
    selectedAppointmentId: string;
    appointments: readonly {
        id: string;
        label: string;
    }[];
    processing: {
        state: ProcessingStage | null;
        audioState: AudioState | null;
        message: string;
        permissionToRecord: boolean;
    };
    transcript: Transcript | null;
    analysis: PrivateAnalysis | null;
    privateRecords?: PrivateSessionReadMetadata;
    metrics: MetricValues;
    metricsRevision: number;
    recap: RoutineRecap | null;
    recapDigest: string | null;
    recipients: readonly {
        accountId: string;
        name: string;
    }[];
}
export interface SessionDeskActions {
    upload(file: File, appointmentId: string, signal: AbortSignal, progress: (percent: number) => void): Promise<void>;
    refresh(): Promise<void>;
    saveRecap: CommandPort<RecapEditInput, {
        recap: RoutineRecap;
        digest: string;
    }>;
    speakers: CommandPort<SpeakerEditInput, SpeakerSaveReceipt>;
    metrics: CommandPort<{
        sessionId: string;
        values: MetricValues;
        expectedRevision: number;
    }, MetricRecord>;
    share: CommandPort<{
        sessionId: string;
        expectedVersion: number;
        expectedDigest: string;
        recipientAccountIds: readonly string[];
    }, {
        sharedAt: string;
    }>;
    /** Locale change affects your private analysis only; live AI regeneration requires its own capped job receipt. */
    selectAnalysisLanguage(locale: Locale): void;
}
export function sessionAppointmentLabel(label: string, locale: Locale): string {
    return validIso(label) ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(new Date(label)) : label;
}
export function PractitionerSessionDesk(props: {
    locale: Locale;
    model: SessionDeskModel;
    actions: SessionDeskActions;
    consentPanel?: ReactNode;
}) {
    return <SessionDeskInner key={`${props.model.caseId}:${props.model.sessionId}`} {...props}/>;
}
function SessionDeskInner({ locale, model, actions, consentPanel }: {
    locale: Locale;
    model: SessionDeskModel;
    actions: SessionDeskActions;
    consentPanel?: ReactNode;
}) {
    const [tab, setTab] = useState<"overview" | "transcript" | "observations" | "update">("overview"), [appointment, setAppointment] = useState(model.selectedAppointmentId), [progress, setProgress] = useState<number | null>(null), [uploadError, setUploadError] = useState<string | null>(null), [metrics, setMetrics] = useState(model.metrics), [metricRevision, setMetricRevision] = useState(model.metricsRevision), [shared, setShared] = useState<string | null>(null);
    const [editing, setEditing] = useState(false), [pending, setPending] = useState(false), [analysisLocale, setAnalysisLocale] = useState<Locale>("en"), [transcriptView, setTranscriptView] = useState<"source" | "cleaned">("source"), controller = useRef<AbortController | null>(null), alive = useRef(true), busy = useRef(false);
    const metricSave = useCommand(actions.metrics, result => { setMetricRevision(result.revision); setMetrics(result.values); }), share = useCommand(actions.share, v => setShared(v.sharedAt));
    const metricError = metricSave.error === "CONFLICT" ? word(locale, "A newer revision was saved. Your edits are still here; compare the saved revision history before reopening this session and retrying.", "נשמרה גרסה חדשה יותר. השינויים שלך עדיין כאן; יש להשוות להיסטוריית הגרסאות לפני פתיחה מחדש של המפגש וניסיון נוסף.") : metricSave.error === "UNAUTHENTICATED" ? word(locale, "Your sign-in expired. Your edits are still here; sign in again before saving.", "ההתחברות פגה. השינויים שלך עדיין כאן; יש להתחבר מחדש לפני השמירה.") : metricSave.error ? word(locale, "Observations were not saved. Check your authorized session and the observation fields; your edits are still here.", "התצפיות לא נשמרו. יש לבדוק את הרשאת המפגש ואת שדות התצפיות; השינויים שלך עדיין כאן.") : null;
    const activeProcessing = model.processing.state !== null && ["queued", "transcribing", "transcript_saved", "analyzing"].includes(model.processing.state);
    const analysisConfirmed = !model.privateRecords || model.privateRecords.analysisLocale === analysisLocale;
    const savedAnalysis = analysisConfirmed && model.analysis?.locale === analysisLocale ? model.analysis : null;
    const cleaned = new Map(model.privateRecords?.transcript?.cleaned.map(segment => [segment.sourceSegmentId, segment.text]) ?? []);
    const savedSpeakers = model.privateRecords?.transcript?.speakers ?? {};
    const savedTime = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(new Date(value));
    useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
    useEffect(() => {
        if (!activeProcessing)
            return;
        let stop = false, timer: ReturnType<typeof setTimeout>;
        const tick = async () => {
            if (stop)
                return;
            try {
                if (!document.hidden)
                    await actions.refresh();
            }
            catch { /* Existing status stays visible; no successful completion inferred. */ }
            if (!stop)
                timer = setTimeout(tick, 5000);
        };
        timer = setTimeout(tick, 5000);
        return () => { stop = true; clearTimeout(timer); };
    }, [activeProcessing, actions]);
    async function upload(file: File | null) {
        if (!file || busy.current || !model.processing.permissionToRecord)
            return;
        busy.current = true;
        controller.current = new AbortController();
        setPending(true);
        setProgress(0);
        setUploadError(null);
        try {
            await actions.upload(file, appointment, controller.current.signal, v => {
                if (alive.current)
                    setProgress(Math.min(100, Math.max(0, v)));
            });
            if (alive.current)
                await actions.refresh();
        }
        catch {
            if (alive.current)
                setUploadError(word(locale, "Upload status could not be confirmed. Check this session before uploading again.", "לא ניתן לאשר את מצב ההעלאה. יש לבדוק את המפגש לפני העלאה נוספת."));
        }
        finally {
            busy.current = false;
            if (alive.current) {
                setPending(false);
                setProgress(null);
            }
        }
    }
    return <div className="lsr" lang={locale} dir={locale === "he" ? "rtl" : "ltr"}>
    <header className="lsr-page-heading"><div><p className="lsr-eyebrow">{word(locale, "Client session", "מפגש בתיק")}</p><h1>{model.clientDisplayName}</h1><p>{word(locale, "Recording and analysis are private. Only the short update you share is visible to its recipients.", "ההקלטה והניתוח פרטיים. רק העדכון הקצר שתשתף יהיה גלוי לנמענים שלו.")}</p></div></header>
    <nav className="lsr-tabs" aria-label={word(locale, "Session sections", "חלקי המפגש")}>{([["overview", "Session", "המפגש"], ["transcript", "Transcript", "תמלול"], ["observations", "My observations", "התצפיות שלי"], ["update", "Shared update", "עדכון לשיתוף"]] as const).map(([id, en, he]) => <button type="button" aria-pressed={tab === id} key={id} onClick={() => setTab(id)}>{word(locale, en, he)}</button>)}</nav>
    {consentPanel}
    {tab === "overview" && <><Section title={word(locale, "Add session recording", "הוספת הקלטת מפגש")} privateOnly>
      <div className="lsr-form-grid"><label>{word(locale, "Attach to appointment", "שיוך למפגש ביומן")}<select disabled={pending || activeProcessing || uploadError !== null} value={appointment} onChange={e => setAppointment(e.target.value)}>{model.appointments.map(a => <option key={a.id} value={a.id}>{sessionAppointmentLabel(a.label,locale)}</option>)}</select></label><label className="lsr-upload">{word(locale, "Choose audio recording", "בחירת קובץ שמע")}<input type="file" accept=".mp3,.m4a,.wav,.ogg,.webm,.flac" disabled={pending || activeProcessing || uploadError !== null || !model.processing.permissionToRecord} onChange={e => { const file = e.currentTarget.files?.[0] ?? null; e.currentTarget.value = ""; void upload(file); }}/></label></div>
      {!model.processing.permissionToRecord && <p role="alert">{word(locale, "Recording/AI consent or authority requires attention before upload.", "יש להסדיר הסכמה להקלטה ולעיבוד או הרשאה לפני העלאה.")}</p>}
      {pending && <div><label>{word(locale, "Uploading", "מעלה הקלטה")} <progress value={progress ?? 0} max={100}/></label><button type="button" onClick={() => controller.current?.abort()}>{word(locale, "Stop upload", "עצירת העלאה")}</button></div>}
      <p role="status" aria-live="polite">{sessionProcessingLabel(model.processing.state,model.processing.audioState,locale)}</p>{uploadError && <div role="alert"><p>{uploadError}</p><button type="button" onClick={() => void actions.refresh()}>{word(locale, "Check session status", "בדיקת מצב המפגש")}</button><p>{word(locale, "A new upload must wait until the previous request is reconciled.", "העלאה חדשה תתאפשר אחרי בירור תוצאת הבקשה הקודמת.")}</p></div>}
      <p className="lsr-help">{word(locale, "Raw audio is deleted after the complete source transcript is saved and verified. If processing fails, the session shows the unresolved status.", "קובץ השמע יימחק לאחר שהתמלול המקורי המלא יישמר וייבדק. כישלון בעיבוד יוצג במפגש.")}</p>
    </Section><Section title={word(locale, "Private session analysis", "ניתוח מפגש פרטי")} privateOnly>
      <label>{word(locale, "My summary language", "שפת הסיכום שלי")}<select value={analysisLocale} onChange={e => { const l = e.target.value as Locale; setAnalysisLocale(l); actions.selectAnalysisLanguage(l); }}><option value="en">English</option><option value="he">עברית</option></select></label>
      <p className="lsr-help">{word(locale, "This selects an already-saved private analysis. It does not start a new AI request.", "הבחירה מציגה ניתוח פרטי שכבר נשמר. היא אינה מפעילה בקשה חדשה לבינה מלאכותית.")}</p>
      {!analysisConfirmed ? <p role="status">{word(locale, "The selected language has not been confirmed yet. If the read fails, retry the session read above.", "שפת הניתוח שנבחרה עדיין לא אושרה בקריאה. אם הקריאה נכשלת, יש לנסות שוב את קריאת המפגש למעלה.")}</p> : savedAnalysis ? <div lang={savedAnalysis.locale} dir={savedAnalysis.locale === "he" ? "rtl" : "ltr"}>
        {model.privateRecords?.analysis && <p className="lsr-help" dir="auto">{word(locale, "Saved analysis revision", "גרסת ניתוח שמורה")} {model.privateRecords.analysis.revision} · {word(locale, "Transcript version", "גרסת תמלול")} {model.privateRecords.analysis.transcriptVersion} · {savedTime(model.privateRecords.analysis.createdAt)} · {model.privateRecords.analysis.promptVersion} · {model.privateRecords.analysis.modelVersion}</p>}
        {([["summary", "Summary", "סיכום"], ["observations", "Transcript-linked observations — not my scored observations", "תצפיות המקושרות לתמלול — לא ציוני התצפיות שלי"], ["possibleInterpretations", "Possible interpretations — not established facts", "אפשרויות לפרשנות — לא עובדות מבוססות"], ["nextSessionTopics", "Possible next-session topics", "נושאים אפשריים למפגש הבא"]] as const).map(([key, en, he]) => savedAnalysis[key].length > 0 && <div key={key}><h3>{word(locale, en, he)}</h3>{savedAnalysis[key].map((item, i) => <div key={i}><p dir="auto">{item.text}</p><details><summary>{word(locale, "Source evidence", "ראיות מן המקור")}</summary>{item.evidence.map((quote, index) => <blockquote key={index} dir="auto"><p>{quote.quote}</p><small>{word(locale, "Source segment", "קטע מקור")} {quote.segmentId}</small></blockquote>)}</details></div>)}</div>)}
        <details><summary>{word(locale, "Limitations", "מגבלות")}</summary>{savedAnalysis.limitations.map((text, index) => <p dir="auto" key={index}>{text}</p>)}</details>
      </div> : <p role="status">{word(locale, "No saved analysis in this language for the current transcript. Nothing was generated or shared.", "אין ניתוח שמור בשפה זו עבור התמלול הנוכחי. לא נוצר ולא שותף דבר.")}</p>}
    </Section></>}
    <div hidden={tab!=="transcript"}><Section title={word(locale, "Source transcript", "תמלול מקור")} privateOnly description={word(locale, "Machine-generated source. Speaker labels and corrections must be versioned; do not silently overwrite it.", "תמלול מקור ממוחשב. שמות הדוברים והתיקונים נשמרים בגרסאות, בלי לדרוס את המקור.")}>
      {model.privateRecords?.transcript && <><p className="lsr-help">{word(locale, "Verified stored transcript version", "גרסת תמלול שמורה ומאומתת")} {model.privateRecords.transcript.version} · {savedTime(model.privateRecords.transcript.createdAt)}</p><nav className="lsr-tabs" aria-label={word(locale, "Transcript view", "תצוגת תמלול")}><button type="button" aria-pressed={transcriptView === "source"} onClick={() => setTranscriptView("source")}>{word(locale, "Original source", "מקור מקורי")}</button><button type="button" aria-pressed={transcriptView === "cleaned"} onClick={() => setTranscriptView("cleaned")}>{word(locale, "Saved cleaned text", "טקסט ערוך שמור")}</button></nav></>}
      {model.transcript && <SpeakerLabelsEditor sessionId={model.sessionId} transcript={model.transcript} saved={model.privateRecords?.transcript} locale={locale} port={actions.speakers} onSaved={() => void actions.refresh()}/>}
      {model.transcript?.segments.map(s => <div className="lsr-transcript-line" key={s.id}><strong>{Object.hasOwn(savedSpeakers, s.speaker) ? savedSpeakers[s.speaker] : s.speaker}</strong>{Object.hasOwn(savedSpeakers, s.speaker) && <small dir="auto"> ({s.speaker})</small>}<time>{Math.floor(s.startMs / 60000)}:{String(Math.floor(s.startMs / 1000) % 60).padStart(2, "0")}</time><p dir="auto">{transcriptView === "cleaned" ? cleaned.get(s.id) : s.text}</p></div>) ?? <p>{word(locale, "No transcript available.", "התמלול אינו זמין.")}</p>}
    </Section></div>
    {tab === "observations" && <><Section title={word(locale, "My private session observations", "התצפיות הפרטיות שלי")} privateOnly description={word(locale, "Use the same nine criteria. Leave unobserved items blank; AI does not fill these scores.", "משתמשים באותם תשעה קריטריונים. פריטים שלא נצפו נשארים ריקים. הבינה המלאכותית אינה ממלאת ציונים.")}>
      <SessionMetricFields locale={locale} values={metrics} onChange={setMetrics} disabled={metricSave.locked}/><div className="lsr-actions"><button className="lsr-primary" type="button" disabled={metricSave.locked} onClick={() => void metricSave.execute({ sessionId: model.sessionId, values: metrics, expectedRevision: metricRevision })}>{word(locale, "Save observations", "שמירת תצפיות")}</button></div><SaveStatus locale={locale} phase={metricSave.phase} error={metricError} onReconcile={() => void metricSave.reconcile()}/>
    </Section>{model.workspaceId && <PrivateObservationEvidencePanel locale={locale} caseId={model.caseId} refreshToken={`${metricRevision}:${metricSave.error === "CONFLICT" ? "conflict" : "current"}`}/>}</>}
    {tab === "update" && <Section title={word(locale, "Short routine update", "עדכון קצר ושגרתי")} description={word(locale, "The selected child and parents receive the same version. Private analysis, recordings and scores are never attached.", "הילד וההורים שנבחרו יקבלו את אותה גרסה. ניתוח פרטי, הקלטות וציונים אינם מצורפים.")}>
      {editing ? <RoutineRecapEditor key={model.recap?.version ?? 0} sessionId={model.sessionId} initial={model.recap} locale={locale} port={actions.saveRecap} onSaved={() => { setEditing(false); setShared(null); void actions.refresh(); }} onCancel={() => setEditing(false)}/> : <button type="button" disabled={share.locked} onClick={() => setEditing(true)}>{word(locale, "Edit routine update", "עריכת העדכון השגרתי")}</button>}
      {!editing && (model.recap ? <><dl className="lsr-recap"><dt>{word(locale, "Attendance", "נוכחות")}</dt><dd>{attendanceLabel(model.recap.attendance, locale)}</dd><dt>{word(locale, "Broad focus", "מוקד כללי")}</dt><dd>{model.recap.focus.map(f => FOCUS_LABELS[f][locale]).join(" · ")}</dd><dt>{word(locale, "This week's practice and each person's part", "התרגול השבוע והתפקיד של כל משתתף")}</dt><dd>{model.recap.practices.map(p => <p key={p.responsibilityId}><strong>{p.participant === "parent" ? word(locale, "Parent", "הורה") : word(locale, "Client", "מקבל השירות")}</strong>: {p.instructions} — {p.localTime}</p>)}</dd><dt>{word(locale, "Next step", "הצעד הבא")}</dt><dd>{model.recap.nextStep}</dd><dt>{word(locale, "Next appointment", "המפגש הבא")}</dt><dd>{model.recap.nextAppointment ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: model.recap.nextAppointment.timezone }).format(new Date(model.recap.nextAppointment.startsAt)) : word(locale, "Not scheduled", "טרם נקבע")}</dd></dl><p><strong>{word(locale, "Recipients:", "נמענים:")}</strong> {model.recipients.map(r => r.name).join(", ")}</p><button type="button" className="lsr-primary" disabled={editing || share.locked || !model.recapDigest || !model.recipients.length || shared !== null} onClick={() => model.recap && model.recapDigest && void share.execute({ sessionId: model.sessionId, expectedVersion: model.recap.version, expectedDigest: model.recapDigest, recipientAccountIds: model.recipients.map(r => r.accountId) })}>{word(locale, "Share update", "שיתוף עדכון")}</button><SaveStatus locale={locale} phase={share.phase} error={share.error} onReconcile={() => void share.reconcile()}/>{shared && <p role="status">{word(locale, "This version was shared. Delivery status is tracked separately.", "גרסה זו שותפה. מצב מסירת ההתראות נרשם בנפרד.")}</p>}</> : <p>{word(locale, "No routine update is ready. Prepare the broad focus, agreed practice and next step first.", "אין עדכון מוכן. יש להכין קודם את המוקד הכללי, התרגול המוסכם והצעד הבא.")}</p>)}
    </Section>}
  </div>;
}
