"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./client.module.css";
import { useIntakeLocale } from "./intake-brand.tsx";

export type PublicConsent = Readonly<{ version: string; hash: string; sourceHashes: readonly string[]; displayText: readonly string[]; acknowledgements: readonly string[]; translations?: { en: { displayText: readonly string[]; acknowledgements: readonly string[] } } | undefined }>;
type Child = { childSlotId: string; firstName: string; age: number | null };
type BankTransfer = { bankName: string; bankCode: string; branchNumber: string; accountNumber: string; accountHolder: string };
type Exchange = { ok: true; data: { childSlotIds: string[]; consent: PublicConsent; bankTransfer?: BankTransfer | null } } | { ok: false };
const days = [["sun", "א׳", "Sun"], ["mon", "ב׳", "Mon"], ["tue", "ג׳", "Tue"], ["wed", "ד׳", "Wed"], ["thu", "ה׳", "Thu"]] as const;
const windows = [["morning", "בוקר", "Morning"], ["afternoon", "צהריים", "Afternoon"], ["evening", "ערב", "Evening"]] as const;

export function PreEnrollmentForm({ consent, testPreview = false }: { consent: PublicConsent | null; testPreview?: boolean }) {
  const { locale, setLocked } = useIntakeLocale();
  const he = locale === "he";
  const t = (heText: string, enText: string) => he ? heText : enText;
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
  const [consentLanguage, setConsentLanguage] = useState<"he" | "en" | "">("");
  const shownConsent = !he && activeConsent?.translations?.en ? { displayText: activeConsent.translations.en.displayText, acknowledgements: activeConsent.translations.en.acknowledgements } : activeConsent;

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
    .catch(() => setStatus(locale === "he" ? "הקישור אינו זמין או שפג תוקפו." : "This private link is unavailable or has expired."));
  }, [testPreview, locale]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeConsent || !ready || !tokenRef.current || saved || pendingRequest.current) return;
    const form = new FormData(event.currentTarget);
    const availableDays = form.getAll("days").map(String);
    const timeWindows = form.getAll("timeWindows").map(String);
    if (children.some(child => !child.firstName.trim() || child.age === null)) { setStatus(t("יש למלא שם וגיל לכל ילד/ה.", "Enter each child’s name and age.")); return; }
    if (!attemptedPayload.current && (!availableDays.length || !timeWindows.length)) { setStatus(t("יש לבחור לפחות יום ושעת נוחות אחת.", "Choose at least one day and one convenient time.")); return; }
    if (testPreview) {
      if (!availableDays.length || !timeWindows.length) { setStatus(t("יש לבחור לפחות יום ושעת נוחות אחת.", "Choose at least one day and one convenient time.")); return; }
      setAttempted(true); tokenRef.current = null; setSaved(true); setStatus(t("בדיקה הושלמה — המידע לא נשלח ולא נשמר", "Test complete — nothing was sent or saved")); return;
    }
    idempotencyKey.current ??= crypto.randomUUID();
    setStatus(t("שומרים…", "Saving…"));
    pendingRequest.current = true;
    setSubmitting(true);
    setLocked(true);
    setAttempted(true);
    const acceptedConsent = form.get("consent") === "on";
    if (!consentLanguage || (!he && !activeConsent.translations?.en)) { setStatus(t("יש לבחור שפת הסכמה זמינה.", "Choose an available consent language.")); pendingRequest.current = false; setSubmitting(false); setLocked(false); return; }
    const payload = { parentName: form.get("parentName"), contactNumber: form.get("contactNumber"), preferredLanguage: form.get("preferredLanguage"), email: form.get("email"), children, locationPreference: form.get("locationPreference"), arrivalNeeds: form.get("arrivalNeeds"), availableDays, timeWindows, availabilityNote: form.get("availabilityNote"), privateContext: form.get("privateContext"), cp01: form.get("cp01"), willingToBeContacted: form.get("contact"), accessSupportNeeded: form.get("access"), consentVersion: activeConsent.version, consentHash: activeConsent.hash, consentAcknowledgements: activeConsent.acknowledgements.map(() => acceptedConsent), consentLanguage, signerName: form.get("signerName") };
    try {
      attemptedPayload.current ??= payload;
      const response = await fetch("/api/intake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "submit", token: tokenRef.current, idempotencyKey: idempotencyKey.current, payload: attemptedPayload.current }) });
      const result = await response.json() as { ok: boolean };
      if (!response.ok || !result.ok) throw new Error("not confirmed");
      tokenRef.current = null;
      setSaved(true);
      setStatus(t("המידע התקבל ונשמר.", "Your information was received and saved."));
    } catch { setStatus(t("לא הצלחנו לאשר שהמידע נשמר. לחצו שוב כדי לבדוק ולשלוח את אותם הפרטים בבטחה.", "We could not confirm that your information was saved. Try again to safely check and resend the same details.")); }
    finally { pendingRequest.current = false; setSubmitting(false); }
  }

  if (!ready) return <p role="status">{status || t("טוענים טופס פרטי…", "Loading your private form…")}</p>;
  if (!activeConsent || (!he && !activeConsent.translations?.en)) return <p role="alert">{t("הטופס אינו זמין כרגע.", "The English version is not available until its translated consent is configured.")}</p>;
  if (saved) return <section className={styles.form} aria-label={testPreview ? t("בדיקה הושלמה", "Test complete") : t("המידע התקבל", "Information received")}><h1>{testPreview ? t("בדיקה הושלמה — המידע לא נשלח ולא נשמר", "Test complete — nothing was sent or saved") : t("המידע התקבל ונשמר", "Information received and saved")}</h1><p>{testPreview ? t("זו בדיקה בלבד; אין תיאום, שמירה או תשלום במסגרת הבדיקה.", "This was only a test; no scheduling, saving, or payment took place.") : t("מילוי הטופס ותשלום אינם אישור לפגישה.", "Submitting this form and paying do not confirm an appointment.")}</p><PaymentGuidance bankTransfer={bankTransfer} testPreview={testPreview} /><p>{t("משך מפגש הניסיון 60 דקות. במסגרת ליווי מתמשך תקבלו דוח התקדמות חודשי עם תצפיות מעשיות והצעות לתרגול בבית.", "The trial session is 60 minutes. Ongoing support includes monthly progress reports with practical observations and home practice suggestions.")}</p></section>;
  return <form className={styles.form} onSubmit={submit}>
    {testPreview && <aside role="alert"><strong>{t("תצוגת בדיקה לשלמה בלבד; אין להזין מידע אמיתי על ילדים; אין צורך לשלם", "Test view for Shlomo only; do not enter real child information; no payment is needed")}</strong></aside>}<header><h1>{t("מפגש ניסיון ראשון", "First trial session")}</h1><p>{t("לאחר השיחה שלנו, מלאו את הפרטים לקראת מפגש הניסיון.", "Following our conversation, please complete these details for the trial session.")}</p></header><PaymentGuidance bankTransfer={bankTransfer} testPreview={testPreview} />
    <fieldset disabled={attempted} className={styles.section}><legend>{t("פרטי הפנייה", "Inquiry details")}</legend>
    <Section title={t("פרטי קשר", "Contact details")}><Field label={t("שם ההורה", "Parent name")} required><input name="parentName" required maxLength={160} /></Field><Field label={t("טלפון", "Phone")} required><input name="contactNumber" required maxLength={64} inputMode="tel" /></Field><Field label={t("שפת קשר", "Contact language")}><Dropdown locale={locale} value={locale} name="preferredLanguage" ariaLabel={t("שפת קשר", "Contact language")} options={[["he","עברית","Hebrew"],["en","English","English"]]} /></Field><Field label={t("דוא״ל (רשות)", "Email (optional)")}><input name="email" type="email" maxLength={254} /></Field></Section>
    {children.map((child, index) => <Section key={child.childSlotId} title={t(`ילד/ה ${index + 1}`, `Child ${index + 1}`)}><Field label={t("שם פרטי", "First name")} required><input value={child.firstName} required maxLength={120} onChange={event => setChildren(items => items.map((item, i) => i === index ? { ...item, firstName: event.target.value } : item))} /></Field><Field label={t("גיל", "Age")} required><Dropdown locale={locale} name={`age-${index}`} ariaLabel={t(`גיל ילד/ה ${index + 1}`, `Child ${index + 1} age`)} required options={Array.from({length:51},(_,index)=>{const age=index/2;return [String(age),String(age),String(age)] as const})} value={child.age===null?"":String(child.age)} placeholder={t("בחירת גיל", "Choose age")} onChange={value=>setChildren(items=>items.map((item,i)=>i===index?{...item,age:Number(value)}:item))}/></Field></Section>)}
    <Section title={t("מיקום וזמינות", "Location and availability")}><p>{t("למפגש הראשון נעדיף, ככל שמתאים לכם, פארק או מרחב פתוח ונעים — באווירה פחות רשמית. יש פארק קרוב לבית שיכול להתאים? כתבו לנו כאן.", "For the first session, when suitable, we prefer a pleasant park or open space with a less formal atmosphere. Is there a nearby park that could work? Tell us here.")}</p><p>{t("השעות הן לפי שעון ישראל (Asia/Jerusalem). שלמה יאשר איתכם את המועד, המיקום והנחיות ההגעה באופן אישי.", "Times are in Israel time (Asia/Jerusalem). Shlomo will personally confirm the time, location, and arrival guidance with you.")}</p><Field label={t("מיקום מועדף", "Preferred location")} required><input name="locationPreference" required maxLength={500} placeholder={t("למשל: פארק קרוב לבית או לתאם מיקום עם שלמה", "For example: a nearby park or coordinate a location with Shlomo")} /></Field><Field label={t("הגעה, חניה או נגישות (רשות)", "Arrival, parking, or accessibility (optional)")}><textarea name="arrivalNeeds" maxLength={500} placeholder={t("למשל: הצעת פארק קרוב, חניה או הנחיית הגעה", "For example: nearby park, parking, or directions")} /></Field><Choice locale={locale} name="days" title={t("ימים נוחים", "Convenient days")} values={days} required /><Choice locale={locale} name="timeWindows" title={t("שעות נוחות", "Convenient times")} values={windows} required /><Field label={t("העדפה נוספת", "Additional preference")}><textarea name="availabilityNote" maxLength={1000} /></Field></Section>
    <Section title={t("פרטים נוספים", "Additional details")}><Field label={t("מידע פרטי רלוונטי (רשות)", "Relevant private information (optional)")}><textarea name="privateContext" maxLength={4000} /></Field><Field label={t("הורה נוסף", "Additional parent")}><Dropdown locale={locale} name="cp01" ariaLabel={t("הורה נוסף", "Additional parent")} options={[["not_now","לא כרגע","Not now"],["joint","פנייה משותפת","Joint contact"],["separate","בנפרד","Separately"],["discuss_privately","לדבר בפרטיות","Discuss privately"]]} /></Field><p>{t("בחירה זו אינה שולחת פנייה או הזמנה להורה נוסף ואינה מעניקה לו גישה למידע.", "This choice does not contact or invite another parent and does not give them access to information.")}</p><Field label={t("אפשר לפנות אליי?", "May we contact you?")}><Dropdown locale={locale} name="contact" ariaLabel={t("אפשר לפנות אליי", "May we contact you?")} options={[["yes","כן","Yes"],["no","לא","No"]]} /></Field><Field label={t("נדרשת התאמת נגישות?", "Accessibility adjustment needed?")}><Dropdown locale={locale} name="access" ariaLabel={t("נדרשת התאמת נגישות", "Accessibility adjustment needed?")} options={[["no","לא","No"],["yes","כן","Yes"]]} /></Field></Section>
    <Section title={t("הסכמה", "Consent")}><p id="consent-instruction">{t("יש לגלול ולקרוא את כל נוסח ההסכמה לפני אישור.", "Please scroll through and read the full consent text before agreeing.")}</p><div className={styles.consentBox} tabIndex={0} aria-labelledby="consent-instruction">{shownConsent?.displayText.map(text => <p key={text}>{text}</p>)}<ol>{shownConsent?.acknowledgements.map(text => <li key={text}>{text}</li>)}</ol></div><p aria-live="polite">{t("שפת ההסכמה המוצגת כעת: עברית", "Consent language currently displayed: English")}</p><label className={styles.check}><input key={locale} name="consent" type="checkbox" required onChange={() => setConsentLanguage(locale)} /> <span>{t("קראתי את הנוסח ואני מסכים/ה לשלוש ההצהרות הממוספרות לעיל", "I have read the text and agree to the three numbered statements above")}<RequiredMarker /></span></label><Field label={t("שם החותם/ת", "Signer name")} required><input name="signerName" required maxLength={160} /></Field></Section>
    </fieldset>
    <button className={styles.submit} disabled={submitting} type="submit">{submitting ? t("שומרים…", "Saving…") : testPreview ? t("סיום בדיקה ללא שליחה", "Finish test without sending") : attempted ? t("בדיקה ושליחה חוזרת", "Check and resend") : t("שליחה", "Submit")}</button><p role="status">{status}</p>
  </form>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <fieldset className={styles.section}><legend>{title}</legend>{children}</fieldset>; }
function RequiredMarker() { const { locale } = useIntakeLocale(); return <><span className={styles.required} aria-hidden="true">•</span><span className={styles.srOnly}>{locale === "he" ? "שדה חובה" : "Required field"}</span></>; }
function PaymentGuidance({ bankTransfer, testPreview }: { bankTransfer: BankTransfer | null; testPreview: boolean }) { const { locale } = useIntakeLocale(); const he = locale === "he"; const t = (a:string,b:string) => he ? a : b; return <section className={styles.payment} aria-label={t("תשלום למפגש הניסיון", "Trial-session payment")}><h2>{t("תשלום למפגש הניסיון", "Trial-session payment")}</h2><p>{t("₪550 לכל ילד למפגש ניסיון ראשון.", "₪550 per child for the first trial session.")}</p><a href="https://mrng.to/RQYMwyQ88C" target="_blank" rel="noreferrer">{testPreview ? t("קישור תשלום אמיתי — אינו חלק מהבדיקה", "Real payment link — not part of this test") : t("לתשלום בקישור המאובטח", "Pay using the secure link")}</a>{bankTransfer ? <dl className={styles.bankTransfer}><div><dt>{t("בנק", "Bank")}</dt><dd>{bankTransfer.bankName} ({bankTransfer.bankCode})</dd></div><div><dt>{t("סניף", "Branch")}</dt><dd>{bankTransfer.branchNumber}</dd></div><div><dt>{t("חשבון", "Account")}</dt><dd>{bankTransfer.accountNumber}</dd></div><div><dt>{t("בעל/ת החשבון", "Account holder")}</dt><dd>{bankTransfer.accountHolder}</dd></div></dl> : <p>{t("להעברה בנקאית, פרטי ההעברה יתואמו ישירות עם שלמה.", "For a bank transfer, Shlomo will coordinate the details directly with you.")}</p>}<p>{t("מזומן אפשרי בתיאום מראש. אם כבר שילמתם, אין צורך לשלם שוב. לאחר תשלום מאומת, נתאם את המפגש ידנית או באמצעות קישור ליומן ששלמה ישלח.", "Cash is available by prior arrangement. If you already paid, do not pay again. After payment is verified, we will coordinate manually or through a booking link Shlomo sends.")}</p></section>; }
function Field({ label, children, required = false }: { label: string; children: React.ReactNode; required?: boolean }) { return <label className={styles.field}><span className={styles.fieldLabel}>{label}{required && <RequiredMarker />}</span>{children}</label>; }
function Choice({ name, title, values, locale, required = false }: { name: string; title: string; values: readonly (readonly [string, string, string])[]; locale: "he" | "en"; required?: boolean }) { return <div className={styles.choices}><p>{title}{required && <RequiredMarker />}</p>{values.map(([value, heLabel, enLabel]) => <label key={value}><input type="checkbox" name={name} value={value} /> {locale === "he" ? heLabel : enLabel}</label>)}</div>; }
function Dropdown({ name, ariaLabel, options, locale = "he", value, placeholder, onChange, required = false }: { name: string; ariaLabel: string; options: readonly (readonly [string, string, string])[]; locale?: "he" | "en"; value?: string; placeholder?: string; onChange?: (value: string) => void; required?: boolean }) {
  const [selected, setSelected] = useState(value ?? options[0]?.[0] ?? "");
  const [open, setOpen] = useState(false);
  const listId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const label = options.find(item => item[0] === selected)?.[locale === "he" ? 1 : 2] ?? placeholder ?? (locale === "he" ? "בחירה" : "Choose");
  function close(restoreFocus = false) { setOpen(false); if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus()); }
  function choose(next: string) { setSelected(next); onChange?.(next); close(true); }
  function move(current: number, delta: number) { const next = (current + delta + options.length) % options.length; optionRefs.current[next]?.focus(); }
  useEffect(() => { const onPointerDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) close(false); }; document.addEventListener("pointerdown", onPointerDown); return () => document.removeEventListener("pointerdown", onPointerDown); });
  function focusIndex(index: number) { optionRefs.current[index]?.focus(); }
  return <span className={styles.dropdown}>
    <input type="hidden" name={name} value={selected} aria-required={required || undefined} />
    <span ref={rootRef}><button ref={triggerRef} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={ariaLabel} aria-required={required || undefined} onClick={() => setOpen(isOpen => !isOpen)} onKeyDown={event => { if (event.key === "Escape") { close(true); return; } if (event.key === "ArrowDown" || event.key === "Home") { event.preventDefault(); setOpen(true); requestAnimationFrame(() => focusIndex(0)); } if (event.key === "End") { event.preventDefault(); setOpen(true); requestAnimationFrame(() => focusIndex(options.length - 1)); } }}>{label}<span aria-hidden="true">⌄</span></button>
    <span id={listId} role="listbox" aria-label={ariaLabel} hidden={!open}>{options.map(([key, heText, enText], index) => { const text = locale === "he" ? heText : enText; return <button ref={element => { optionRefs.current[index] = element; }} type="button" role="option" aria-selected={selected === key} key={key} onClick={() => choose(key)} onKeyDown={event => { if (event.key === "Escape") { close(true); return; } if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); move(index, event.key === "ArrowDown" ? 1 : -1); return; } if (event.key === "Home" || event.key === "End") { event.preventDefault(); focusIndex(event.key === "Home" ? 0 : options.length - 1); return; } if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(key); return; } if (event.key.length === 1) { const match = options.findIndex(([, , option]) => option.startsWith(event.key)); if (match >= 0) { event.preventDefault(); focusIndex(match); } } }}>{text}</button>; })}</span></span>
  </span>;
}
