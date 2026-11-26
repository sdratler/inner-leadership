"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { KEYS_CONSENT, KEYS_INTEREST_VERSION, KEYS_PICKUP_LABELS, KEYS_TRIP, keysInterestSchema, normalizeKeysPhone, type KeysInterest } from "./contract.ts";
import { keysTripPublic as trip } from "./config.ts";
import styles from "./keys-trip.module.css";

type Pickup = keyof typeof KEYS_PICKUP_LABELS;
type Availability = KeysInterest["availability"];
type ChildDraft = { id: string; name: string; age: string };
type Draft = { guardianName: string; email: string; phone: string; city: string; postalCode: string; children: ChildDraft[]; availability: Availability | ""; pickupPreferences: Pickup[]; notes: string; contact: boolean; whatsapp: boolean; futureEmail: boolean };
type SaveState = "idle" | "saving" | "error" | "unknown" | "saved";
type Pending = { operationId: string; fields: KeysInterest };
type FieldError = { field: string; message: string };
const availabilityLabels: Record<Availability, string> = { yes: "Yes, interested in December 6", maybe: "Maybe — please contact me", future: "Not December 6, but interested in future trips" };
const blankDraft = (): Draft => ({ guardianName: "", email: "", phone: "", city: "", postalCode: "", children: [{ id: "first", name: "", age: "" }], availability: "", pickupPreferences: [], notes: "", contact: false, whatsapp: false, futureEmail: false });
const api = "/api/public/keys-interest";

function ErrorText({ field, message }: { field: string; message: string | undefined }) {
  return message ? <p id={`keys-${field}-error`} className={styles.fieldError}>{message}</p> : null;
}

function InterestForm() {
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [reference, setReference] = useState("");
  const [attemptId, setAttemptId] = useState("");
  const [showClear, setShowClear] = useState(false);
  const pending = useRef<Pending | null>(null);
  const uncertain = useRef(false);
  const sending = useRef(false);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const saveNotice = useRef<HTMLDivElement>(null);
  const navigated = useRef(false);
  const locked = saveState === "saving" || saveState === "unknown";

  useEffect(() => {
    if (navigated.current) {
      formHeading.current?.focus({ preventScroll: true });
      formHeading.current?.scrollIntoView({ block: "start", behavior: "auto" });
    }
  }, [step]);

  useEffect(() => {
    if (saveState !== "unknown") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  function update<K extends keyof Draft>(field: K, value: Draft[K]) {
    if (locked) return;
    pending.current = null;
    setAttemptId("");
    setSaveState("idle");
    setSaveMessage("");
    setDraft(current => ({ ...current, [field]: value }));
    setErrors(current => current.filter(error => error.field !== field));
  }
  function updateChild(index: number, field: "name" | "age", value: string) {
    setDraft(current => ({ ...current, children: current.children.map((child, childIndex) => childIndex === index ? { ...child, [field]: value } : child) }));
    setErrors(current => current.filter(error => error.field !== `child-${index}-${field}`));
  }
  function displayErrors(next: FieldError[]) {
    setErrors(next);
    requestAnimationFrame(() => errorSummary.current?.focus());
  }
  function validate(currentStep: number) {
    const next: FieldError[] = [];
    if (currentStep === 1) {
      if (!draft.guardianName.trim()) next.push({ field: "guardianName", message: "Enter the parent or guardian’s name." });
      if (!/^\+[1-9]\d{7,14}$/.test(normalizeKeysPhone(draft.phone))) next.push({ field: "phone", message: "Enter a phone number, including the country code if outside the U.S." });
      const emailInput = document.getElementById("keys-email") as HTMLInputElement | null;
      if (!draft.email.trim() || !emailInput?.validity.valid) next.push({ field: "email", message: "Enter a valid email address." });
      draft.children.forEach((child, index) => {
        if (!child.name.trim()) next.push({ field: `child-${index}-name`, message: `Enter Boy ${index + 1}’s name.` });
        const age = Number(child.age);
        if (!child.age || !Number.isInteger(age) || age < 10 || age > 17) next.push({ field: `child-${index}-age`, message: `Boy ${index + 1} must be age 10–17 for this trip.` });
      });
    }
    if (currentStep === 2) {
      if (!draft.availability) next.push({ field: "availability", message: "Select your availability." });
      if (!draft.city.trim()) next.push({ field: "city", message: "Enter your city." });
      if (!/^\d{5}(?:-\d{4})?$/.test(draft.postalCode.trim())) next.push({ field: "postalCode", message: "Enter a 5-digit ZIP code, or ZIP+4." });
    }
    if (currentStep === 3 && !draft.contact) next.push({ field: "contact", message: "Confirm the parent or guardian’s permission before sending." });
    if (next.length) { displayErrors(next); return false; }
    setErrors([]);
    return true;
  }
  function go(next: 1 | 2 | 3) {
    if (locked) return;
    pending.current = null;
    setAttemptId("");
    setSaveState("idle");
    setSaveMessage("");
    setShowClear(false);
    setErrors([]);
    navigated.current = true;
    setStep(next);
  }
  function fieldError(field: string) { return errors.find(error => error.field === field)?.message; }
  function describe(field: string, hint?: string) { return [hint, fieldError(field) ? `keys-${field}-error` : undefined].filter(Boolean).join(" ") || undefined; }

  async function send() {
    if (sending.current || saveState === "saved") return;
    if (!pending.current) {
      if (!validate(3)) return;
      const parsed = keysInterestSchema.safeParse({
        version: KEYS_INTEREST_VERSION, tripId: KEYS_TRIP.id, tripVersion: KEYS_TRIP.version,
        guardianName: draft.guardianName, email: draft.email, phone: normalizeKeysPhone(draft.phone), city: draft.city, postalCode: draft.postalCode, messageLanguage: "en",
        children: draft.children.map(child => ({ id: child.id === "first" ? crypto.randomUUID() : child.id, name: child.name, ageYears: Number(child.age) })),
        availability: draft.availability, pickupPreferences: draft.pickupPreferences, notes: draft.notes,
        consent: { ...KEYS_CONSENT, contact: draft.contact, whatsapp: draft.whatsapp, futureEmail: draft.futureEmail },
      });
      if (!parsed.success) {
        setSaveMessage("Please review your contact details and the boys’ names and ages. Use ordinary text without hidden formatting characters.");
        setSaveState("error");
        requestAnimationFrame(() => saveNotice.current?.focus());
        return;
      }
      pending.current = { operationId: crypto.randomUUID(), fields: parsed.data };
    }
    const command = pending.current;
    setAttemptId(command.operationId);
    sending.current = true;
    setSaveState("saving");
    setSaveMessage("Saving your interest request…");
    let postStarted = false;
    let connectionMessage = "We couldn’t connect to the interest form. Your details are still here. Try again or call Rabbi Shlomo.";
    try {
      const challengeResponse = await fetch(api, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15000) });
      const challengeBody = await challengeResponse.json();
      const data = challengeBody?.data;
      if (!challengeResponse.ok || challengeBody?.ok !== true || typeof data?.challenge !== "string") { connectionMessage = "The interest form is temporarily unavailable. Please try again or call Rabbi Shlomo."; throw new Error(); }
      if (data.version !== KEYS_INTEREST_VERSION || data.trip?.id !== KEYS_TRIP.id || data.trip?.version !== KEYS_TRIP.version || data.consent?.version !== KEYS_CONSENT.version || data.consent?.noticeText !== KEYS_CONSENT.noticeText || data.consent?.whatsappText !== KEYS_CONSENT.whatsappText || data.consent?.futureEmailText !== KEYS_CONSENT.futureEmailText) { connectionMessage = "The trip form has changed. Please call Rabbi Shlomo before submitting these details."; throw new Error(); }
      postStarted = true;
      const response = await fetch(api, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...command, challenge: data.challenge, website: "" }), signal: AbortSignal.timeout(25000) });
      const body = await response.json();
      if (response.ok && body?.ok === true && body.data?.saved === true && body.data?.operationId === command.operationId && typeof body.data?.reference === "string") {
        setReference(body.data.reference);
        setSaveState("saved");
        setSaveMessage("");
        pending.current = null;
        uncertain.current = false;
        setDraft(blankDraft());
        setErrors([]);
      } else if (response.status >= 400 && response.status < 500 && body?.ok === false && !uncertain.current && body.error?.code !== "CONFLICT") {
        setSaveState("error");
        setSaveMessage(body.error?.code === "RATE_LIMITED" ? "Please wait a moment before trying again. Your details are still here." : "Your request was not accepted. Review your details and try again, or call Rabbi Shlomo.");
      } else {
        uncertain.current = true;
        setSaveState("unknown");
        setSaveMessage("We couldn’t confirm whether your request was saved. Keep this page open and retry the same request below. Your details are preserved.");
      }
    } catch {
      if (postStarted || uncertain.current) {
        uncertain.current = true;
        setSaveState("unknown");
        setSaveMessage("We couldn’t confirm whether your request was saved. Keep this page open and retry the same request below. Your details are preserved.");
      } else {
        setSaveState("error");
        setSaveMessage(connectionMessage);
      }
    } finally {
      sending.current = false;
      requestAnimationFrame(() => saveNotice.current?.focus());
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    if (step === 1 && validate(1)) go(2);
    else if (step === 2 && validate(2)) go(3);
    else if (step === 3) void send();
  }

  return <section id="interest" className={styles.interest} aria-labelledby="keys-form-title">
    <div className={styles.formIntro}><p className={styles.eyebrow}>Let’s plan your trip</p><h2>Interested in joining?</h2><p>Tell us who would like to come and which pickup areas could work. Rabbi Shlomo will discuss the details with you.</p></div>
    <div className={styles.formCard}>
      <header className={styles.formHeader}><h3 id="keys-form-title" ref={formHeading} tabIndex={-1}>{saveState === "saved" ? "Your interest request is saved" : "Parent interest form"}</h3>
        {saveState !== "saved" && <><p>No payment is collected here. A request does not reserve a seat.</p><ol className={styles.steps} aria-label="Form progress">{["Your family", "Trip details", "Review"].map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined} data-complete={step > index + 1}><span>{index + 1}</span>{label}</li>)}</ol></>}
      </header>
      {saveState === "saved" ? <div className={styles.success} role="status" ref={saveNotice} tabIndex={-1}>
        <span className={styles.successMark} aria-hidden="true">✓</span><p>Thank you. Your family’s interest has been recorded privately for Rabbi Shlomo to review.</p><p className={styles.receipt}>Your reference <strong>{reference}</strong></p><p>This is an interest request. Your place, pickup, schedule and price still need to be confirmed with Rabbi Shlomo.</p><a className={styles.primary} href={`tel:+${trip.phoneDigits}`}>Call {trip.phone}</a>
      </div> : <form onSubmit={submit} noValidate className={styles.formBody} aria-busy={saveState === "saving"}>
        {errors.length > 0 && <div className={styles.errorSummary} ref={errorSummary} tabIndex={-1} role="alert"><strong>Please check these details:</strong><ul>{errors.map(error => <li key={error.field}><a href={`#keys-${error.field}`}>{error.message}</a></li>)}</ul></div>}
        {step === 1 && <fieldset className={styles.fieldset} disabled={locked}><legend>Your contact details</legend>
          <div className={styles.field}><label htmlFor="keys-guardianName">Parent or guardian’s full name</label><input id="keys-guardianName" name="guardianName" autoComplete="name" required maxLength={120} value={draft.guardianName} onChange={event => update("guardianName", event.target.value)} aria-invalid={Boolean(fieldError("guardianName"))} aria-describedby={describe("guardianName")} /><ErrorText field="guardianName" message={fieldError("guardianName")} /></div>
          <div className={styles.fieldRow}><div className={styles.field}><label htmlFor="keys-phone">Phone number</label><input id="keys-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={30} placeholder="(305) 555-0123" value={draft.phone} onChange={event => update("phone", event.target.value)} aria-invalid={Boolean(fieldError("phone"))} aria-describedby={describe("phone")} /><ErrorText field="phone" message={fieldError("phone")} /></div>
          <div className={styles.field}><label htmlFor="keys-email">Email address</label><input id="keys-email" name="email" type="email" inputMode="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" value={draft.email} onChange={event => update("email", event.target.value)} aria-invalid={Boolean(fieldError("email"))} aria-describedby={describe("email")} /><ErrorText field="email" message={fieldError("email")} /></div></div>
          <div className={styles.childrenHeading}><h4>Who would like to join?</h4><p>Boys ages 10–17. Add each brother separately.</p></div>
          {draft.children.map((child, index) => <fieldset key={child.id} className={styles.childCard}><legend>Boy {index + 1}</legend><div className={styles.childRow}><div className={styles.field}><label htmlFor={`keys-child-${index}-name`}>First name</label><input id={`keys-child-${index}-name`} required maxLength={80} autoComplete="off" value={child.name} onChange={event => updateChild(index, "name", event.target.value)} aria-invalid={Boolean(fieldError(`child-${index}-name`))} aria-describedby={describe(`child-${index}-name`)} /><ErrorText field={`child-${index}-name`} message={fieldError(`child-${index}-name`)} /></div><div className={styles.field}><label htmlFor={`keys-child-${index}-age`}>Age</label><input id={`keys-child-${index}-age`} type="number" inputMode="numeric" min={10} max={17} step={1} required value={child.age} onChange={event => updateChild(index, "age", event.target.value)} aria-invalid={Boolean(fieldError(`child-${index}-age`))} aria-describedby={describe(`child-${index}-age`)} /><ErrorText field={`child-${index}-age`} message={fieldError(`child-${index}-age`)} /></div></div>{draft.children.length > 1 && <button className={styles.textButton} type="button" onClick={() => { update("children", draft.children.filter((_, childIndex) => childIndex !== index)); setErrors([]); }} aria-label={`Remove Boy ${index + 1}`}>Remove</button>}</fieldset>)}
          {draft.children.length < 10 && <button className={styles.textButton} type="button" onClick={() => { const index = draft.children.length; update("children", [...draft.children, { id: crypto.randomUUID(), name: "", age: "" }]); requestAnimationFrame(() => document.getElementById(`keys-child-${index}-name`)?.focus()); }}>Add another boy</button>}
        </fieldset>}
        {step === 2 && <fieldset className={styles.fieldset} disabled={locked}><legend>Availability and pickup</legend>
          <div className={styles.field}><label htmlFor="keys-availability">Could your family join on December 6?</label><select id="keys-availability" required value={draft.availability} onChange={event => update("availability", event.target.value as Availability | "")} aria-invalid={Boolean(fieldError("availability"))} aria-describedby={describe("availability")}><option value="">Select an answer</option>{Object.entries(availabilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ErrorText field="availability" message={fieldError("availability")} /></div>
          <div className={styles.fieldRow}><div className={styles.field}><label htmlFor="keys-city">City</label><input id="keys-city" name="city" autoComplete="address-level2" required maxLength={100} value={draft.city} onChange={event => update("city", event.target.value)} aria-invalid={Boolean(fieldError("city"))} aria-describedby={describe("city")} /><ErrorText field="city" message={fieldError("city")} /></div><div className={styles.field}><label htmlFor="keys-postalCode">ZIP code</label><input id="keys-postalCode" name="postalCode" autoComplete="postal-code" inputMode="numeric" required maxLength={10} placeholder="5-digit ZIP" value={draft.postalCode} onChange={event => update("postalCode", event.target.value)} aria-invalid={Boolean(fieldError("postalCode"))} aria-describedby={describe("postalCode")} /><ErrorText field="postalCode" message={fieldError("postalCode")} /></div></div>
          <fieldset className={styles.pickupFieldset}><legend>Which pickup areas could work?</legend><p className={styles.hint}>Choose any that could work. These are preferences, not confirmed stops. Leave blank if you’d like to discuss.</p><div className={styles.pickups}>{(Object.entries(KEYS_PICKUP_LABELS) as [Pickup, string][]).map(([value, label]) => <label key={value} className={styles.pickup}><input type="checkbox" checked={draft.pickupPreferences.includes(value)} onChange={event => update("pickupPreferences", event.target.checked ? [...draft.pickupPreferences, value] : draft.pickupPreferences.filter(item => item !== value))} /><span>{label}</span></label>)}</div></fieldset>
          <div className={styles.field}><label htmlFor="keys-notes">Anything else about timing or pickup? <span>Optional</span></label><textarea id="keys-notes" rows={3} maxLength={600} value={draft.notes} onChange={event => update("notes", event.target.value)} aria-describedby="keys-notes-hint" /><p id="keys-notes-hint" className={styles.hint}>Please leave medical and other sensitive details out of this initial form.</p></div>
        </fieldset>}
        {step === 3 && <><div className={styles.reviewHeading}><h4>Check your details</h4><p>Sunday, December 6, 2026 · Florida Keys</p></div><dl className={styles.reviewList}>
          <div><dt>Parent or guardian</dt><dd>{draft.guardianName}</dd></div><div><dt>Contact</dt><dd>{draft.phone}<br />{draft.email}</dd></div><div><dt>Boys</dt><dd>{draft.children.map((child, index) => <span key={child.id}>{index > 0 && <br />}{child.name} · age {child.age}</span>)}</dd></div><div><dt>Location</dt><dd>{draft.city} {draft.postalCode}</dd></div><div><dt>Availability</dt><dd>{draft.availability ? availabilityLabels[draft.availability] : ""}</dd></div><div><dt>Pickup preferences</dt><dd>{draft.pickupPreferences.length ? draft.pickupPreferences.map(value => KEYS_PICKUP_LABELS[value]).join(", ") : "Please discuss"}</dd></div>{draft.notes.trim() && <div><dt>Timing or pickup note</dt><dd>{draft.notes}</dd></div>}
          </dl><fieldset className={styles.permissions} disabled={locked}><legend>Permission to contact you</legend>
            <label className={styles.consent}><input id="keys-contact" type="checkbox" required checked={draft.contact} onChange={event => update("contact", event.target.checked)} aria-invalid={Boolean(fieldError("contact"))} aria-describedby={describe("contact")} /><span>{KEYS_CONSENT.noticeText} <strong>Required</strong></span></label><ErrorText field="contact" message={fieldError("contact")} />
            <label className={styles.consent}><input type="checkbox" checked={draft.whatsapp} onChange={event => update("whatsapp", event.target.checked)} /><span>{KEYS_CONSENT.whatsappText} <small>Optional</small></span></label>
            <label className={styles.consent}><input type="checkbox" checked={draft.futureEmail} onChange={event => update("futureEmail", event.target.checked)} /><span>{KEYS_CONSENT.futureEmailText} <small>Optional</small></span></label>
          </fieldset></>}
        {saveState !== "idle" && <div className={saveState === "unknown" ? styles.unknownNotice : styles.saveNotice} ref={saveNotice} tabIndex={-1} role={saveState === "saving" ? "status" : "alert"}><strong>{saveState === "unknown" ? "Save not confirmed" : saveState === "saving" ? "Sending your request" : "Please try again"}</strong><p>{saveMessage}</p>{saveState === "unknown" && <p>Reference for this attempt: <span className={styles.operationId}>{attemptId}</span><br />You can also call <a href={`tel:+${trip.phoneDigits}`}>{trip.phone}</a>.</p>}</div>}
        <div className={styles.formActions}>{step > 1 && <button className={styles.secondary} type="button" disabled={locked} onClick={() => go(step === 3 ? 2 : 1)}>Back</button>}{saveState === "unknown" ? <button className={styles.primary} type="button" onClick={() => void send()}>Retry same request</button> : <button className={styles.primary} type="submit" disabled={saveState === "saving"}>{step === 1 ? "Continue to trip details" : step === 2 ? "Review my details" : saveState === "saving" ? "Saving…" : "Send my interest request"}</button>}</div>
        <div className={styles.formFoot}><span>Your details are private.</span><button className={styles.textButton} type="button" disabled={locked} onClick={() => setShowClear(true)}>Clear this form</button></div>
        {showClear && <div className={styles.clearPrompt} role="group" aria-label="Clear form confirmation"><p>Clear all the details you entered on this page?</p><div><button className={styles.secondary} type="button" onClick={() => setShowClear(false)}>Keep my details</button><button className={styles.textButton} type="button" onClick={() => { setDraft(blankDraft()); pending.current = null; uncertain.current = false; go(1); }}>Clear details</button></div></div>}
      </form>}
    </div>
  </section>;
}

function Sharing({ past, accepting }: { past: boolean; accepting: boolean }) {
  const [notice, setNotice] = useState("");
  const [fallback, setFallback] = useState(false);
  const invitation = past ? `Ask Rabbi Shlomo about future Fishing Academy trips: ${trip.publicUrl}` : `${trip.title} — Sunday, December 6, 2026. Full-day Florida Keys trip for boys ages 10–17. Early morning departure. Transportation, bait, tackle and water included. Bring your own fishing rods. ${accepting ? "Details and parent interest form" : "Trip details"}: ${trip.publicUrl}`;
  async function copy() {
    try { await navigator.clipboard.writeText(trip.publicUrl); setNotice("Link copied."); }
    catch { setFallback(true); setNotice("Select and copy the link below."); }
  }
  return <section className={styles.sharing} aria-labelledby="keys-share-title"><div><p className={styles.eyebrow}>Pass it along</p><h2 id="keys-share-title">Know a family who’d be interested?</h2><p>Share the trip details with them.</p></div><div className={styles.shareControls}><a className={styles.secondary} href={`https://wa.me/?text=${encodeURIComponent(invitation)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a><button className={styles.secondary} type="button" onClick={() => void copy()}>Copy link</button><a className={styles.textButton} href={trip.flyer} download="Keys-Bridge-Fishing-December-6.png">Download flyer</a></div><p className={styles.shareNotice} role="status">{notice}</p>{fallback && <label className={styles.copyFallback}>Trip page link<input readOnly value={trip.publicUrl} onFocus={event => event.currentTarget.select()} /></label>}</section>;
}

export function KeysTripPage({ past = false, accepting = true }: { past?: boolean; accepting?: boolean }) {
  const showForm = accepting && !past;
  return <main className={styles.page} id="main" lang="en" dir="ltr"><a className={styles.skipLink} href={showForm ? "#interest" : "#keys-questions-title"}>{showForm ? "Skip to interest form" : "Skip to trip details"}</a>
    <div className={styles.heroWrap}><header className={styles.header}><a className={styles.brand} href="https://bneineviimacademy.org/fishing-academy" aria-label="Jewish Leadership Fishing Academy home">
      {/* eslint-disable-next-line @next/next/no-img-element -- use the exact locked logo without a transformation proxy */}
      <img src={trip.logo} width={1254} height={1254} alt="Jewish Leadership Fishing Academy" /><span>Jewish Leadership<br />Fishing Academy</span></a><a className={styles.headerCall} href={`tel:+${trip.phoneDigits}`}>Call Rabbi Shlomo<span>{trip.phone}</span></a></header>
      <section className={styles.hero} aria-labelledby="keys-title"><div className={styles.heroText}><p className={styles.eyebrow}>Full-day Florida Keys trip</p><h1 id="keys-title">Extreme Saltwater<br /><span>Bridge Fishing</span></h1><p className={styles.date}><time dateTime="2026-12-06">Sunday, December 6, 2026</time></p><p className={styles.heroFacts}><strong>Boys ages 10–17</strong><span>Early morning departure</span></p><p className={styles.heroDescription}>A full day of bridge fishing in the Florida Keys with Rabbi Shlomo Dratler.</p><p className={styles.torah}>Torah atmosphere</p>{past ? <div className={styles.pastNotice}><strong>The December 6 trip date has passed.</strong><p>Call Rabbi Shlomo to ask about future fishing trips.</p></div> : !accepting ? <><div className={styles.pastNotice}><p>Online interest requests are currently closed. Call Rabbi Shlomo to discuss the trip.</p></div><a className={styles.primary} href={`tel:+${trip.phoneDigits}`}>Call {trip.phone}</a></> : <a className={styles.primary} href="#interest">I’m interested</a>}<p className={styles.heroContact}>Call to reserve a spot: <a href={`tel:+${trip.phoneDigits}`}>{trip.phone}</a></p></div>
        <figure className={styles.flyer}><a href={trip.flyer} target="_blank" rel="noopener noreferrer" aria-label="Open the full-size Keys trip flyer">
          {/* eslint-disable-next-line @next/next/no-img-element -- preserve the supplied flyer in its original proportions */}
          <img src={trip.flyer} alt="December 6 Keys bridge fishing flyer. Boys ages 10–17. Early morning departure; transportation, bait, tackle and water included. Bring your own fishing rods. Call Rabbi Shlomo Dratler at 305-427-8909." width={941} height={1672} /></a><figcaption><a href={trip.flyer} target="_blank" rel="noopener noreferrer">View full-size flyer</a></figcaption></figure>
      </section></div>
    <div className={styles.content}><section className={styles.practical} aria-label="Trip essentials"><div><span className={styles.detailNumber}>01</span><h2>Included</h2><p>Transportation, bait, tackle and plenty of water.</p></div><div><span className={styles.detailNumber}>02</span><h2>Bring your own fishing rods</h2><p>Have your rods ready for a full day of saltwater bridge fishing.</p></div><div><span className={styles.detailNumber}>03</span><h2>Plan your pickup</h2><p>We’ll discuss pickup, timing and price with you directly.</p></div></section>
      {showForm && <InterestForm />}
      <section className={styles.questions} aria-labelledby="keys-questions-title"><h2 id="keys-questions-title">A few things to know</h2><div><details><summary>Where and when will we meet?</summary><p>We’re planning an early morning departure. Pickup areas, the final bridge location and return arrangements will be confirmed directly with parents. {showForm ? "Choose any pickup areas that could work in the form." : "Call Rabbi Shlomo to discuss which pickup areas could work."}</p></details><details><summary>{showForm ? "Does this form reserve a place?" : "How do I discuss a place?"}</summary><p>{showForm ? "No. It lets Rabbi Shlomo know that your family is interested. Your place, price and pickup arrangements still need to be confirmed privately. No payment is collected here." : "Call Rabbi Shlomo to discuss your family’s interest, pricing and pickup arrangements."}</p></details><details><summary>Can I speak to Rabbi Shlomo first?</summary><p>Of course. Call <a href={`tel:+${trip.phoneDigits}`}>{trip.phone}</a> to discuss the trip, pickup and pricing.</p></details></div></section>
      <Sharing past={past} accepting={accepting} />
      <footer className={styles.footer}><p>Jewish Leadership Fishing Academy<br /><span>Rabbi Shlomo Dratler · <a href={`tel:+${trip.phoneDigits}`}>{trip.phone}</a></span></p><a href="https://bneineviimacademy.org/fishing-academy">About the Academy</a></footer>
    </div>
  </main>;
}
