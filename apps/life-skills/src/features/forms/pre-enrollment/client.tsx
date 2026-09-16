"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./client.module.css";

export type PublicConsent = Readonly<{ version: string; hash: string; sourceHashes: readonly string[]; displayText: readonly string[]; acknowledgements: readonly string[] }>;
type Child = { childSlotId: string; firstName: string; age: number };
type Exchange = { ok: true; data: { childSlotIds: string[]; consent: PublicConsent } } | { ok: false };
const days = [["sun", "א׳"], ["mon", "ב׳"], ["tue", "ג׳"], ["wed", "ד׳"], ["thu", "ה׳"], ["fri", "ו׳"], ["sat", "ש׳"]] as const;
const windows = [["morning", "בוקר"], ["afternoon", "צהריים"], ["evening", "ערב"]] as const;

export function PreEnrollmentForm({ consent }: { consent: PublicConsent | null }) {
  const tokenRef = useRef<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const exchanged = useRef(false);
  const [children, setChildren] = useState<Child[]>([]);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("");
  const [saved, setSaved] = useState(false);
  const [activeConsent, setActiveConsent] = useState<PublicConsent | null>(consent);
  const missingToken = typeof window !== "undefined" && !window.location.hash.slice(1);

  useEffect(() => {
    if (exchanged.current || missingToken) return;
    exchanged.current = true;
    const value = window.location.hash.slice(1);
    tokenRef.current = value;
    window.history.replaceState(null, "", window.location.pathname);
    void fetch("/api/intake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "exchange", token: value }) })
      .then(response => response.json() as Promise<Exchange>)
      .then(result => {
        if (!result.ok || !Array.isArray(result.data.childSlotIds) || !result.data.consent) throw new Error("unavailable");
        setChildren(result.data.childSlotIds.map(childSlotId => ({ childSlotId, firstName: "", age: 0 })));
        setActiveConsent(result.data.consent);
        setReady(true);
      })
      .catch(() => setStatus("הקישור אינו זמין או שפג תוקפו."));
  }, [missingToken]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeConsent || !ready || !tokenRef.current || saved) return;
    const form = new FormData(event.currentTarget);
    const availableDays = form.getAll("days").map(String);
    const timeWindows = form.getAll("timeWindows").map(String);
    if (!availableDays.length || !timeWindows.length) { setStatus("יש לבחור לפחות יום ושעת נוחות אחת."); return; }
    idempotencyKey.current ??= crypto.randomUUID();
    setStatus("שומרים…");
    const payload = { parentName: form.get("parentName"), contactNumber: form.get("contactNumber"), preferredLanguage: form.get("preferredLanguage"), email: form.get("email"), children, locationPreference: form.get("locationPreference"), arrivalNeeds: form.get("arrivalNeeds"), availableDays, timeWindows, availabilityNote: form.get("availabilityNote"), privateContext: form.get("privateContext"), cp01: form.get("cp01"), willingToBeContacted: form.get("contact"), accessSupportNeeded: form.get("access"), consentVersion: activeConsent.version, consentHash: activeConsent.hash, consentAcknowledgements: activeConsent.acknowledgements.map((_, index) => form.get(`consent-${index}`) === "on"), signerName: form.get("signerName") };
    try {
      const response = await fetch("/api/intake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "submit", token: tokenRef.current, idempotencyKey: idempotencyKey.current, payload }) });
      const result = await response.json() as { ok: boolean };
      if (!result.ok) throw new Error("not confirmed");
      tokenRef.current = null;
      setSaved(true);
      setStatus("המידע התקבל ונשמר. שלמה יצור קשר לאישור זמן ומקום.");
    } catch { setStatus("לא הצלחנו לאשר שהמידע נשמר. אפשר לנסות שוב; לא נשלחה קבלה."); }
  }

  if (missingToken) return <p role="alert">נדרש קישור אישי תקף.</p>;
  if (!ready) return <p role="status">{status || "טוענים טופס פרטי…"}</p>;
  if (!activeConsent) return <p role="alert">הטופס אינו זמין כרגע.</p>;
  return <form className={styles.form} onSubmit={submit}>
    <header><h1>פנייה פרטית למשפחות</h1><p>העדפות לתיאום בלבד — אין בכך קביעת פגישה.</p></header>
    <Section title="פרטי קשר"><Field label="שם ההורה"><input name="parentName" required maxLength={160} /></Field><Field label="טלפון"><input name="contactNumber" required maxLength={64} inputMode="tel" /></Field><Field label="שפת קשר"><select name="preferredLanguage"><option value="he">עברית</option><option value="en">English</option></select></Field><Field label="דוא״ל (לא חובה)"><input name="email" type="email" maxLength={254} /></Field></Section>
    {children.map((child, index) => <Section key={child.childSlotId} title={`ילד/ה ${index + 1}`}><Field label="שם פרטי"><input value={child.firstName} required maxLength={120} onChange={event => setChildren(items => items.map((item, i) => i === index ? { ...item, firstName: event.target.value } : item))} /></Field><Field label="גיל"><input type="number" min="0" max="25" value={child.age || ""} required onChange={event => setChildren(items => items.map((item, i) => i === index ? { ...item, age: Number(event.target.value) } : item))} /></Field></Section>)}
    <Section title="מיקום וזמינות"><Field label="מיקום מועדף"><input name="locationPreference" required maxLength={500} placeholder="למשל: לתאם מיקום עם שלמה" /></Field><Field label="חניה או נגישות"><textarea name="arrivalNeeds" maxLength={500} /></Field><Choice name="days" title="ימים נוחים (חובה)" values={days} /><Choice name="timeWindows" title="שעות נוחות (חובה)" values={windows} /><Field label="העדפה נוספת"><textarea name="availabilityNote" maxLength={1000} /></Field></Section>
    <Section title="פרטים נוספים"><Field label="מידע פרטי רלוונטי (לא חובה)"><textarea name="privateContext" maxLength={4000} /></Field><Field label="הורה נוסף"><select name="cp01"><option value="not_now">לא כרגע</option><option value="joint">פנייה משותפת</option><option value="separate">בנפרד</option><option value="discuss_privately">לדבר בפרטיות</option></select></Field><Field label="אפשר לפנות אליי?"><select name="contact"><option value="yes">כן</option><option value="no">לא</option></select></Field><Field label="נדרשת התאמת נגישות?"><select name="access"><option value="no">לא</option><option value="yes">כן</option></select></Field></Section>
    <Section title="הסכמה">{activeConsent.displayText.map(text => <p key={text}>{text}</p>)}{activeConsent.acknowledgements.map((text, index) => <label className={styles.check} key={text}><input name={`consent-${index}`} type="checkbox" required /> {text}</label>)}<Field label="שם החותם/ת"><input name="signerName" required maxLength={160} /></Field></Section>
    <button disabled={saved} type="submit">{saved ? "המידע נשמר" : "שליחה"}</button><p role="status">{status}</p>
    {saved && <section className={styles.payment} aria-label="תשלום"><h2>תשלום לפגישת ההיכרות</h2><p>₪550 לפגישת היכרות אחת. העברה בנקאית או מזומן יתואמו בערוץ מאומת. שליחה או תשלום אינם אישור פגישה.</p><a href="https://mrng.to/RQYMwyQ88C" target="_blank" rel="noreferrer">לתשלום מאובטח</a></section>}
  </form>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <fieldset className={styles.section}><legend>{title}</legend>{children}</fieldset>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className={styles.field}>{label}{children}</label>; }
function Choice({ name, title, values }: { name: string; title: string; values: readonly (readonly [string, string])[] }) { return <div className={styles.choices}><p>{title}</p>{values.map(([value, label]) => <label key={value}><input type="checkbox" name={name} value={value} /> {label}</label>)}</div>; }
