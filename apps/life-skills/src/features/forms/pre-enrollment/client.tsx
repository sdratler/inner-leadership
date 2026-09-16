"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./client.module.css";

export type PublicConsent = Readonly<{ version: string; hash: string; sourceHashes: readonly string[]; displayText: readonly string[]; acknowledgements: readonly string[] }>;
type Child = { childSlotId: string; firstName: string; age: number | null };
type BankTransfer = { bankName: string; bankCode: string; branchNumber: string; accountNumber: string; accountHolder: string };
type Exchange = { ok: true; data: { childSlotIds: string[]; consent: PublicConsent; bankTransfer?: BankTransfer | null } } | { ok: false };
const days = [["sun", "א׳"], ["mon", "ב׳"], ["tue", "ג׳"], ["wed", "ד׳"], ["thu", "ה׳"], ["fri", "ו׳"], ["sat", "ש׳"]] as const;
const windows = [["morning", "בוקר"], ["afternoon", "צהריים"], ["evening", "ערב"]] as const;

export function PreEnrollmentForm({ consent, testPreview = false }: { consent: PublicConsent | null; testPreview?: boolean }) {
  const tokenRef = useRef<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const attemptedPayload = useRef<object | null>(null);
  const pendingRequest = useRef(false);
  const exchanged = useRef(false);
  const [children, setChildren] = useState<Child[]>([]);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("");
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [activeConsent, setActiveConsent] = useState<PublicConsent | null>(consent);
  const [bankTransfer, setBankTransfer] = useState<BankTransfer | null>(null);

  useEffect(() => {
    if (exchanged.current) return;
    exchanged.current = true;
    const value = window.location.hash.slice(1);
    tokenRef.current = value;
    window.history.replaceState(null, "", window.location.pathname);
    void fetch(testPreview ? "/api/intake-preview" : "/api/intake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "exchange", token: value }) })
      .then(response => { if (!response.ok) throw new Error("unavailable"); return response.json() as Promise<Exchange>; })
      .then(result => {
        if (!result.ok || !Array.isArray(result.data.childSlotIds) || !result.data.consent) throw new Error("unavailable");
        setChildren(result.data.childSlotIds.map(childSlotId => ({ childSlotId, firstName: "", age: null })));
        setActiveConsent(result.data.consent);
        setBankTransfer(result.data.bankTransfer ?? null);
        setReady(true);
      })
      .catch(() => setStatus("הקישור אינו זמין או שפג תוקפו."));
  }, [testPreview]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeConsent || !ready || !tokenRef.current || saved || pendingRequest.current) return;
    const form = new FormData(event.currentTarget);
    const availableDays = form.getAll("days").map(String);
    const timeWindows = form.getAll("timeWindows").map(String);
    if (children.some(child => !child.firstName.trim() || child.age === null)) { setStatus("יש למלא שם וגיל לכל ילד/ה."); return; }
    if (!attemptedPayload.current && (!availableDays.length || !timeWindows.length)) { setStatus("יש לבחור לפחות יום ושעת נוחות אחת."); return; }
    if (testPreview) {
      if (!availableDays.length || !timeWindows.length) { setStatus("יש לבחור לפחות יום ושעת נוחות אחת."); return; }
      setAttempted(true); tokenRef.current = null; setSaved(true); setStatus("בדיקה הושלמה — המידע לא נשלח ולא נשמר"); return;
    }
    idempotencyKey.current ??= crypto.randomUUID();
    setStatus("שומרים…");
    pendingRequest.current = true;
    setSubmitting(true);
    setAttempted(true);
    const acceptedConsent = form.get("consent") === "on";
    const payload = { parentName: form.get("parentName"), contactNumber: form.get("contactNumber"), preferredLanguage: form.get("preferredLanguage"), email: form.get("email"), children, locationPreference: form.get("locationPreference"), arrivalNeeds: form.get("arrivalNeeds"), availableDays, timeWindows, availabilityNote: form.get("availabilityNote"), privateContext: form.get("privateContext"), cp01: form.get("cp01"), willingToBeContacted: form.get("contact"), accessSupportNeeded: form.get("access"), consentVersion: activeConsent.version, consentHash: activeConsent.hash, consentAcknowledgements: activeConsent.acknowledgements.map(() => acceptedConsent), signerName: form.get("signerName") };
    try {
      attemptedPayload.current ??= payload;
      const response = await fetch("/api/intake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "submit", token: tokenRef.current, idempotencyKey: idempotencyKey.current, payload: attemptedPayload.current }) });
      const result = await response.json() as { ok: boolean };
      if (!response.ok || !result.ok) throw new Error("not confirmed");
      tokenRef.current = null;
      setSaved(true);
      setStatus("המידע התקבל ונשמר.");
    } catch { setStatus("לא הצלחנו לאשר שהמידע נשמר. לחצו שוב כדי לבדוק ולשלוח את אותם הפרטים בבטחה."); }
    finally { pendingRequest.current = false; setSubmitting(false); }
  }

  if (!ready) return <p role="status">{status || "טוענים טופס פרטי…"}</p>;
  if (!activeConsent) return <p role="alert">הטופס אינו זמין כרגע.</p>;
  if (saved) return <section className={styles.form} aria-label={testPreview ? "בדיקה הושלמה" : "המידע התקבל"}><h1>{testPreview ? "בדיקה הושלמה — המידע לא נשלח ולא נשמר" : "המידע התקבל ונשמר"}</h1><p>{testPreview ? "זו בדיקה בלבד; אין תיאום, שמירה או תשלום במסגרת הבדיקה." : "מילוי הטופס ותשלום אינם אישור לפגישה."}</p><PaymentGuidance bankTransfer={bankTransfer} testPreview={testPreview} /><p>משך מפגש הניסיון 60 דקות. במסגרת ליווי מתמשך תקבלו דוח התקדמות חודשי עם תצפיות מעשיות והצעות לתרגול בבית.</p></section>;
  return <form className={styles.form} onSubmit={submit}>
    {testPreview && <aside role="alert"><strong>תצוגת בדיקה לשלמה בלבד; אין להזין מידע אמיתי על ילדים; אין צורך לשלם</strong></aside>}<header><h1>מפגש ניסיון ראשון</h1><p>לאחר השיחה שלנו, מלאו את הפרטים לקראת מפגש הניסיון.</p></header><PaymentGuidance bankTransfer={bankTransfer} testPreview={testPreview} />
    <fieldset disabled={attempted} className={styles.section}><legend>פרטי הפנייה</legend>
    <Section title="פרטי קשר"><Field label="שם ההורה" required><input name="parentName" required maxLength={160} /></Field><Field label="טלפון" required><input name="contactNumber" required maxLength={64} inputMode="tel" /></Field><Field label="שפת קשר"><Dropdown name="preferredLanguage" ariaLabel="שפת קשר" options={[["he","עברית"],["en","English"]]} /></Field><Field label="דוא״ל (רשות)"><input name="email" type="email" maxLength={254} /></Field></Section>
    {children.map((child, index) => <Section key={child.childSlotId} title={`ילד/ה ${index + 1}`}><Field label="שם פרטי" required><input value={child.firstName} required maxLength={120} onChange={event => setChildren(items => items.map((item, i) => i === index ? { ...item, firstName: event.target.value } : item))} /></Field><Field label="גיל" required><Dropdown name={`age-${index}`} ariaLabel={`גיל ילד/ה ${index + 1}`} required options={Array.from({length:51},(_,index)=>{const age=index/2;return [String(age),String(age)] as const})} value={child.age===null?"":String(child.age)} placeholder="בחירת גיל" onChange={value=>setChildren(items=>items.map((item,i)=>i===index?{...item,age:Number(value)}:item))}/></Field></Section>)}
    <Section title="מיקום וזמינות"><p>למפגש הראשון נעדיף, ככל שמתאים לכם, פארק או מרחב פתוח ונעים — באווירה פחות רשמית. יש פארק קרוב לבית שיכול להתאים? כתבו לנו כאן.</p><p>השעות הן לפי שעון ישראל (Asia/Jerusalem). שלמה יאשר איתכם את המועד, המיקום והנחיות ההגעה באופן אישי.</p><Field label="מיקום מועדף" required><input name="locationPreference" required maxLength={500} placeholder="למשל: פארק קרוב לבית או לתאם מיקום עם שלמה" /></Field><Field label="הגעה, חניה או נגישות (רשות)"><textarea name="arrivalNeeds" maxLength={500} placeholder="למשל: הצעת פארק קרוב, חניה או הנחיית הגעה" /></Field><Choice name="days" title="ימים נוחים" values={days} required /><Choice name="timeWindows" title="שעות נוחות" values={windows} required /><Field label="העדפה נוספת"><textarea name="availabilityNote" maxLength={1000} /></Field></Section>
    <Section title="פרטים נוספים"><Field label="מידע פרטי רלוונטי (רשות)"><textarea name="privateContext" maxLength={4000} /></Field><Field label="הורה נוסף"><Dropdown name="cp01" ariaLabel="הורה נוסף" options={[["not_now","לא כרגע"],["joint","פנייה משותפת"],["separate","בנפרד"],["discuss_privately","לדבר בפרטיות"]]} /></Field><p>בחירה זו אינה שולחת פנייה או הזמנה להורה נוסף ואינה מעניקה לו גישה למידע.</p><Field label="אפשר לפנות אליי?"><Dropdown name="contact" ariaLabel="אפשר לפנות אליי" options={[["yes","כן"],["no","לא"]]} /></Field><Field label="נדרשת התאמת נגישות?"><Dropdown name="access" ariaLabel="נדרשת התאמת נגישות" options={[["no","לא"],["yes","כן"]]} /></Field></Section>
    <Section title="הסכמה"><p id="consent-instruction">יש לגלול ולקרוא את כל נוסח ההסכמה לפני אישור.</p><div className={styles.consentBox} tabIndex={0} aria-labelledby="consent-instruction">{activeConsent.displayText.map(text => <p key={text}>{text}</p>)}<ol>{activeConsent.acknowledgements.map(text => <li key={text}>{text}</li>)}</ol></div><label className={styles.check}><input name="consent" type="checkbox" required /> <span>קראתי את הנוסח ואני מסכים/ה לשלוש ההצהרות הממוספרות לעיל<RequiredMarker /></span></label><Field label="שם החותם/ת" required><input name="signerName" required maxLength={160} /></Field></Section>
    </fieldset>
    <button className={styles.submit} disabled={submitting} type="submit">{submitting ? "שומרים…" : testPreview ? "סיום בדיקה ללא שליחה" : attempted ? "בדיקה ושליחה חוזרת" : "שליחה"}</button><p role="status">{status}</p>
  </form>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <fieldset className={styles.section}><legend>{title}</legend>{children}</fieldset>; }
function RequiredMarker() { return <><span className={styles.required} aria-hidden="true">•</span><span className={styles.srOnly}>שדה חובה</span></>; }
function PaymentGuidance({ bankTransfer, testPreview }: { bankTransfer: BankTransfer | null; testPreview: boolean }) { return <section className={styles.payment} aria-label="תשלום למפגש הניסיון"><h2>תשלום למפגש הניסיון</h2><p>₪550 לכל ילד למפגש ניסיון ראשון.</p><a href="https://mrng.to/RQYMwyQ88C" target="_blank" rel="noreferrer">{testPreview ? "קישור תשלום אמיתי — אינו חלק מהבדיקה" : "לתשלום בקישור המאובטח"}</a>{bankTransfer ? <dl className={styles.bankTransfer}><div><dt>בנק</dt><dd>{bankTransfer.bankName} ({bankTransfer.bankCode})</dd></div><div><dt>סניף</dt><dd>{bankTransfer.branchNumber}</dd></div><div><dt>חשבון</dt><dd>{bankTransfer.accountNumber}</dd></div><div><dt>בעל/ת החשבון</dt><dd>{bankTransfer.accountHolder}</dd></div></dl> : <p>להעברה בנקאית, פרטי ההעברה יתואמו ישירות עם שלמה.</p>}<p>מזומן אפשרי בתיאום מראש. אם כבר שילמתם, אין צורך לשלם שוב. לאחר תשלום מאומת, נתאם את המפגש ידנית או באמצעות קישור ליומן ששלמה ישלח.</p></section>; }
function Field({ label, children, required = false }: { label: string; children: React.ReactNode; required?: boolean }) { return <label className={styles.field}><span className={styles.fieldLabel}>{label}{required && <RequiredMarker />}</span>{children}</label>; }
function Choice({ name, title, values, required = false }: { name: string; title: string; values: readonly (readonly [string, string])[]; required?: boolean }) { return <div className={styles.choices}><p>{title}{required && <RequiredMarker />}</p>{values.map(([value, label]) => <label key={value}><input type="checkbox" name={name} value={value} /> {label}</label>)}</div>; }
function Dropdown({ name, ariaLabel, options, value, placeholder, onChange, required = false }: { name: string; ariaLabel: string; options: readonly (readonly [string, string])[]; value?: string; placeholder?: string; onChange?: (value: string) => void; required?: boolean }) {
  const [selected, setSelected] = useState(value ?? options[0]?.[0] ?? "");
  const [open, setOpen] = useState(false);
  const listId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const label = options.find(item => item[0] === selected)?.[1] ?? placeholder ?? "בחירה";
  function close(restoreFocus = false) { setOpen(false); if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus()); }
  function choose(next: string) { setSelected(next); onChange?.(next); close(true); }
  function move(current: number, delta: number) { const next = (current + delta + options.length) % options.length; optionRefs.current[next]?.focus(); }
  useEffect(() => { const onPointerDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) close(false); }; document.addEventListener("pointerdown", onPointerDown); return () => document.removeEventListener("pointerdown", onPointerDown); });
  function focusIndex(index: number) { optionRefs.current[index]?.focus(); }
  return <span className={styles.dropdown}>
    <input type="hidden" name={name} value={selected} aria-required={required || undefined} />
    <span ref={rootRef}><button ref={triggerRef} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={ariaLabel} aria-required={required || undefined} onClick={() => setOpen(isOpen => !isOpen)} onKeyDown={event => { if (event.key === "Escape") { close(true); return; } if (event.key === "ArrowDown" || event.key === "Home") { event.preventDefault(); setOpen(true); requestAnimationFrame(() => focusIndex(0)); } if (event.key === "End") { event.preventDefault(); setOpen(true); requestAnimationFrame(() => focusIndex(options.length - 1)); } }}>{label}<span aria-hidden="true">⌄</span></button>
    <span id={listId} role="listbox" aria-label={ariaLabel} hidden={!open}>{options.map(([key, text], index) => <button ref={element => { optionRefs.current[index] = element; }} type="button" role="option" aria-selected={selected === key} key={key} onClick={() => choose(key)} onKeyDown={event => { if (event.key === "Escape") { close(true); return; } if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); move(index, event.key === "ArrowDown" ? 1 : -1); return; } if (event.key === "Home" || event.key === "End") { event.preventDefault(); focusIndex(event.key === "Home" ? 0 : options.length - 1); return; } if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(key); return; } if (event.key.length === 1) { const match = options.findIndex(([, option]) => option.startsWith(event.key)); if (match >= 0) { event.preventDefault(); focusIndex(match); } } }}>{text}</button>)}</span></span>
  </span>;
}
