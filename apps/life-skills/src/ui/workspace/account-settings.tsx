"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {useRouter} from "next/navigation";
import type { Locale } from "../../lib/locale.ts";
import { accountAction, accountRead } from "../../features/identity/client.ts";
import { UnsavedChangesGuard } from "./draft-guard.tsx";
import { settingsItems, workspaceHref, type WorkspaceRole } from "./navigation-model.ts";
import { deliveryChannels, duplicatePreferences, preferenceEvents, preferenceFingerprint, updatePreference, validQuietHours, type Preference } from "./preference-model.ts";
import {InstallApp} from "../revamp/install-app.tsx";
export { updatePreference } from "./preference-model.ts";
export type { Preference } from "./preference-model.ts";
type Section = "account" | "notifications" | "coordination";
const words = {
 en: { account: "Account & language", notifications: "Notifications", coordination: "Task coordination", settings: "Settings", language: "Preferred language", save: "Save preferences", saving: "Saving…", saved: "Preferences saved and verified.", load: "Loading your settings…", loadFailed: "Settings could not be read. No changes have been made.", uncertain: "The saved state could not be verified. Your draft is still here. Check the saved settings before making more changes.", conflict: "Saved settings differ from this draft. Review them before replacing anything.", verify: "Check saved settings", useSaved: "Load saved settings instead", reload: "Try reading again", none: "No editable preferences are available for this account. Nothing was created automatically.", missing: "Not configured for this account", duplicate: "These settings contain conflicting entries. Editing is blocked until they are resolved.", dirty: "You have unsaved changes. Leave this page?", discard: "Replace this draft with the saved settings?", quiet: "Do not disturb", from: "From", to: "Until", timezone: "Time zone", quietHelp: "Hold non-urgent notifications during these hours. This does not change appointment or practice times. Leave both times blank to turn this off.", invalid: "Enter two different valid times, or leave both blank.", delivery: "Choosing a channel does not activate a provider or change who can see your information. Delivery depends on its verified configuration and your permission.", coordinationHelp: "Who handles a task is chosen on that published practice. It never changes the private audience or another parent’s notification consent.", openPractice: "Open practice coordination", email: "Email", push: "Push", whatsapp: "WhatsApp", practice_due: "Practice: time to do your task or remind your child", appointment_changed: "Appointments: time changes or cancellations", new_reply: "Messages: a new reply in your authorized conversation", summary_published: "Reports: a new update was shared with you" },
 he: { account: "חשבון ושפה", notifications: "התראות", coordination: "תיאום משימות", settings: "הגדרות", language: "שפה מועדפת", save: "שמירת ההעדפות", saving: "שומר…", saved: "ההעדפות נשמרו ואומתו.", load: "טוען את ההגדרות שלכם…", loadFailed: "לא ניתן לקרוא את ההגדרות. לא בוצעו שינויים.", uncertain: "לא ניתן לאמת את מצב השמירה. הטיוטה נשארה כאן. בדקו את ההגדרות השמורות לפני שינוי נוסף.", conflict: "ההגדרות השמורות שונות מהטיוטה הזאת. בדקו אותן לפני החלפה.", verify: "בדיקת ההגדרות השמורות", useSaved: "טעינת ההגדרות השמורות במקום הטיוטה", reload: "ניסיון קריאה נוסף", none: "אין העדפות הניתנות לעריכה בחשבון הזה. לא נוצרו הגדרות אוטומטית.", missing: "לא הוגדר בחשבון הזה", duplicate: "ההגדרות מכילות רשומות סותרות. העריכה נעצרת עד לבירור.", dirty: "יש שינויים שלא נשמרו. לצאת מהעמוד?", discard: "להחליף את הטיוטה בהגדרות השמורות?", quiet: "נא לא להפריע", from: "מ־", to: "עד", timezone: "אזור זמן", quietHelp: "התראות שאינן דחופות יושהו בשעות אלו. זמני המפגשים והתרגול אינם משתנים. לביטול השאירו את שני השדות ריקים.", invalid: "יש להזין שתי שעות תקינות ושונות, או להשאיר את שתיהן ריקות.", delivery: "בחירת ערוץ אינה מפעילה ספק ואינה משנה הרשאות צפייה. המסירה תלויה בחיבור המאומת ובהרשאה שלכם.", coordinationHelp: "האחריות למשימה נבחרת בתרגול שפורסם. היא אינה משנה את קהל הצפייה או את הסכמת ההורה האחר להתראות.", openPractice: "פתיחת תיאום התרגול", email: "דוא״ל", push: "התראת מכשיר", whatsapp: "WhatsApp", practice_due: "תרגול: הגיע הזמן למשימה או להזכיר לילד", appointment_changed: "מפגשים: שינוי שעה או ביטול", new_reply: "הודעות: תגובה חדשה בשיחה המורשית שלך", summary_published: "דוחות: עדכון חדש ששותף איתך" },
} as const;
export function AccountSettings({ locale, role, section = "account" }: { locale: Locale; role: WorkspaceRole; section?: Section }) {
 const caseId = useSearchParams().get("caseId"), t = words[locale];
 const base = role === "parent" ? "family" : role === "client" ? "client" : "app";
 // Coordination is navigation only. Do not make it depend on the preferences API.
 return <main className="lsu-settings-content"><header className="lsw-page-header"><div><p className="lsw-eyebrow">{t.settings}</p><h1>{t[section]}</h1></div></header><nav className="lsu-section-nav" aria-label={t.settings}>{settingsItems(role).map(x => <a key={x.key} href={workspaceHref(locale,x.path,caseId)} aria-current={section === x.key ? "page" : undefined}>{x[locale]}</a>)}</nav>{section === "coordination" ? <section className="lsu-panel"><p>{t.coordinationHelp}</p><a className="lsw-button lsw-button--primary" href={workspaceHref(locale,`${base}/practice`,caseId)}>{t.openPractice}</a></section> : <><PreferencesEditor key={`${locale}:${role}`} locale={locale} section={section}/>{section==="account"&&<DeviceControls locale={locale}/>}</>}</main>;
}
function DeviceControls({locale}:{locale:Locale}){const he=locale==="he",router=useRouter(),[busy,setBusy]=useState(false),[error,setError]=useState("");async function logout(all:boolean){if(busy||all&&!window.confirm(he?"לנתק את כל המכשירים?":"Sign out every device?"))return;setBusy(true);setError("");try{await accountAction<void>(all?"logout-all":"logout","POST",{});router.push(`/${locale}/intake/staff?mode=login`);router.refresh()}catch{setError(he?"לא ניתן לאשר את הניתוק. סגרו את החלון ונסו שוב.":"Sign-out could not be confirmed. Close this window and try again.")}finally{setBusy(false)}}return <section className="lsu-panel lsw-stack" aria-labelledby="device-controls"><h2 id="device-controls">{he?"האפליקציה והמכשירים":"App and devices"}</h2><InstallApp locale={locale}/><p>{he?"האפליקציה אינה שומרת תמלולים או מידע פרטי במטמון לא מקוון.":"The app does not cache transcripts or private records for offline use."}</p><div className="lsw-actions"><button type="button" disabled={busy} onClick={()=>void logout(false)}>{he?"יציאה מהמכשיר הזה":"Sign out this device"}</button><button type="button" disabled={busy} onClick={()=>void logout(true)}>{he?"ניתוק כל המכשירים":"Sign out all devices"}</button></div>{error&&<p role="alert">{error}</p>}</section>}
function PreferencesEditor({ locale, section }: { locale: Locale; section: "account" | "notifications" }) {
 const t = words[locale];
 const [draft,setDraft] = useState<Preference[] | null>(null), [savedFingerprint,setSavedFingerprint] = useState("");
 const [loading,setLoading] = useState(true), [saving,setSaving] = useState(false), [status,setStatus] = useState("");
 const [uncertain,setUncertain] = useState(false), [savedAlternative,setSavedAlternative] = useState<Preference[] | null>(null);
 const mounted = useRef(false), inFlight = useRef(false), generation = useRef(0);
 const dirty = draft !== null && preferenceFingerprint(draft) !== savedFingerprint;
 const setLoaded = useCallback((rows: Preference[]) => { setDraft(rows); setSavedFingerprint(preferenceFingerprint(rows)); setSavedAlternative(null); setUncertain(false); }, []);
 const load = useCallback(async () => {
   if (inFlight.current) return;
   const current = ++generation.current; inFlight.current = true; setLoading(true); setStatus("");
   try { const rows = await accountRead<Preference[]>("preferences"); if (mounted.current && current === generation.current) setLoaded(rows); }
   catch { if (mounted.current && current === generation.current) setStatus(t.loadFailed); }
   finally { inFlight.current = false; if (mounted.current && current === generation.current) setLoading(false); }
 }, [setLoaded,t.loadFailed]);
 useEffect(() => { mounted.current = true; const timer = window.setTimeout(() => { void load(); },0); return () => { window.clearTimeout(timer); mounted.current = false; generation.current += 1; }; }, [load]);
 const verify = async () => {
   if (!draft || inFlight.current) return; inFlight.current = true; setSaving(true);
   try { const rows = await accountRead<Preference[]>("preferences"); if (!mounted.current) return;
     if (preferenceFingerprint(rows) === preferenceFingerprint(draft)) { setLoaded(rows); setStatus(t.saved); }
     else { setSavedAlternative(rows); setStatus(t.conflict); }
   } catch { if (mounted.current) setStatus(t.uncertain); }
   finally { inFlight.current = false; if (mounted.current) setSaving(false); }
 };
 const save = async () => {
   if (!draft || inFlight.current || uncertain || !draft.length || duplicatePreferences(draft)) return;
   if (draft.some(r => !validQuietHours(r.quietStart ?? "",r.quietEnd ?? ""))) { setStatus(t.invalid); return; }
   inFlight.current = true; setSaving(true); setStatus("");
   const submitted = draft.map(r => ({ ...r }));
   try { await accountAction<void>("preferences","PUT",{ preferences: submitted });
     const rows = await accountRead<Preference[]>("preferences"); if (!mounted.current) return;
     if (preferenceFingerprint(rows) === preferenceFingerprint(submitted)) { setLoaded(rows); setStatus(t.saved); }
     else { setUncertain(true); setSavedAlternative(rows); setStatus(t.conflict); }
   } catch { if (mounted.current) { setUncertain(true); setStatus(t.uncertain); } }
   finally { inFlight.current = false; if (mounted.current) setSaving(false); }
 };
 if (loading) return <section className="lsu-panel" role="status">{t.load}</section>;
 if (!draft) return <section className="lsu-state lsu-state--error" role="alert"><p>{status || t.loadFailed}</p><button type="button" onClick={() => void load()}>{t.reload}</button></section>;
 const start = draft[0]?.quietStart ?? "", end = draft[0]?.quietEnd ?? "";
 const locked = saving || uncertain || !draft.length || duplicatePreferences(draft);
 const patch = (change: Partial<Pick<Preference,"locale" | "quietStart" | "quietEnd">>) => { setDraft(rows => rows ? rows.map(r => ({ ...r,...change })) : rows); setStatus(""); };
 return <><UnsavedChangesGuard dirty={dirty || uncertain} message={t.dirty}/><section className="lsu-panel">
   {!draft.length && <p role="status">{t.none}</p>}{duplicatePreferences(draft) && <p role="alert">{t.duplicate}</p>}
   <fieldset disabled={locked} className="lsu-editor-fields"><legend>{t[section]}</legend>{section === "account" ? <div className="lsw-field"><label htmlFor="settings-language">{t.language}</label><select id="settings-language" value={draft[0]?.locale ?? locale} onChange={e => patch({ locale: e.target.value === "he" ? "he" : "en" })}><option value="he">עברית</option><option value="en">English</option></select></div> : <>
     <fieldset><legend>{t.quiet}</legend><div className="lsw-two-fields"><div className="lsw-field"><label htmlFor="quiet-start">{t.from}</label><input id="quiet-start" type="time" value={start} onChange={e => patch({ quietStart: e.target.value || null })} aria-describedby="quiet-help"/></div><div className="lsw-field"><label htmlFor="quiet-end">{t.to}</label><input id="quiet-end" type="time" value={end} onChange={e => patch({ quietEnd: e.target.value || null })} aria-describedby="quiet-help"/></div></div><p id="quiet-help" className="lsw-help">{t.quietHelp}</p><p className="lsw-help">{t.timezone}: <bdi>{draft[0]?.timezone ?? "Asia/Jerusalem"}</bdi></p></fieldset>
     <div className="lsw-preference-grid">{preferenceEvents.map(eventType => <fieldset key={eventType}><legend>{t[eventType]}</legend>{deliveryChannels.map(channel => { const row = draft.find(r => r.eventType === eventType && r.channel === channel); return <label className="lsw-choice" key={channel}><input type="checkbox" checked={row?.enabled ?? false} disabled={locked || !row} onChange={e => { setDraft(updatePreference(draft,eventType,channel,e.target.checked)); setStatus(""); }}/><span>{t[channel]}{!row && <small>{t.missing}</small>}</span></label>; })}</fieldset>)}</div><p className="lsw-help">{t.delivery}</p>
   </>}</fieldset></section>
   <div className="lsw-actions"><button className="lsw-button lsw-button--primary" type="button" disabled={locked || !dirty} aria-busy={saving || undefined} onClick={() => void save()}>{saving ? t.saving : t.save}</button></div>
   <div className={`lsu-state${uncertain ? " lsu-state--error" : ""}`} role="status" aria-live="polite" hidden={!status}><p>{status}</p>{uncertain && <button type="button" disabled={saving} onClick={() => void verify()}>{t.verify}</button>}{savedAlternative && <button type="button" disabled={saving} onClick={() => { if (window.confirm(t.discard)) { setLoaded(savedAlternative); setStatus(""); } }}>{t.useSaved}</button>}</div>
 </>;
}
