"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Locale } from "../../lib/locale.ts";
import { IdentityClientError, sessionInfo } from "../identity/client.ts";
import { loginHref } from "../identity/login-return.ts";
import { keysOwnerUpdateSchema, normalizeKeysPhone, KEYS_PICKUP_LABELS, type KeysContactCorrection, type KeysOwnerUpdate } from "./contract.ts";
import type { KeysInterestStore } from "./store.ts";
import { keysTripPublic } from "./config.ts";
import styles from "./owner-workspace.module.css";

type Detail = Awaited<ReturnType<KeysInterestStore["read"]>>;
type ListPage = Awaited<ReturnType<KeysInterestStore["listPage"]>>;
type Summary = Awaited<ReturnType<KeysInterestStore["summary"]>>;
type Contact = Detail["currentContact"];
type SaveResult = { saved: true; followup: Awaited<ReturnType<KeysInterestStore["update"]>> };
type Pickup = keyof typeof KEYS_PICKUP_LABELS;
type FollowupDraft = { status: KeysOwnerUpdate["status"]; note: string; nextAction: string; dueDate: string; waitingCondition: string; correctContact: boolean; contact: Contact; correctionReason: string };
type OperationState = "idle" | "saving" | "unknown" | "conflict";
const endpoint = "/api/private/keys-interest";
const availabilityLabels = { yes: "Interested in December 6", maybe: "Maybe — please contact", future: "Future trips only" };
const statusLabels = { new: "New", contacted: "Contacted", waiting: "Waiting", closed: "Closed" };
class OwnerRequestError extends Error { constructor(readonly status: number) { super("KEYS_OWNER_REQUEST_FAILED"); } }

async function readOwner<T>(query = "", signal?: AbortSignal): Promise<T> {
  const response = await fetch(endpoint + query, { credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", ...(signal ? { signal } : {}) });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true || !body.data) throw new OwnerRequestError(response.status || 503);
  return body.data as T;
}
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(date);
}
function initialDraft(detail: Detail): FollowupDraft {
  return { status: detail.followup.status, note: "", nextAction: detail.followup.nextAction ?? "", dueDate: detail.followup.dueDate ?? "", waitingCondition: detail.followup.waitingCondition ?? "", correctContact: false, contact: { ...detail.currentContact, pickupPreferences: [...detail.currentContact.pickupPreferences] }, correctionReason: "" };
}
function contactRows(contact: Contact) {
  return <><div><dt>Parent / guardian</dt><dd>{contact.guardianName}</dd></div><div><dt>Email</dt><dd><a href={`mailto:${contact.email}`}>{contact.email}</a></dd></div><div><dt>Phone</dt><dd><a href={`tel:${contact.phone}`}>{contact.phone}</a></dd></div><div><dt>City / ZIP</dt><dd>{contact.city} {contact.postalCode}</dd></div><div><dt>Availability</dt><dd>{availabilityLabels[contact.availability]}</dd></div><div><dt>Pickup preferences</dt><dd>{contact.pickupPreferences.length ? contact.pickupPreferences.map(area => KEYS_PICKUP_LABELS[area]).join(", ") : "Please discuss"}</dd></div></>;
}

function InquiryDetail({ reference, onDirtyChange, onLockedChange, onAccessDenied, onSaved }: { reference: string; onDirtyChange: (value: boolean) => void; onLockedChange: (value: boolean) => void; onAccessDenied: (status: number) => void; onSaved: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<FollowupDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<OperationState>("idle");
  const [pending, setPending] = useState<KeysOwnerUpdate | null>(null);
  const [showDiscard, setShowDiscard] = useState(false);
  const busy = useRef(false);
  const active = useRef(true);
  const notice = useRef<HTMLDivElement>(null);
  const locked = state === "saving" || state === "unknown";

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onLockedChange(locked); }, [locked, onLockedChange]);
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    readOwner<Detail>("?" + new URLSearchParams({ reference }), controller.signal).then(value => {
      if (value.application.id !== reference) throw new OwnerRequestError(503);
      if (!active.current) return;
      setDetail(value); setDraft(initialDraft(value)); setLoading(false);
    }).catch(cause => {
      if (!active.current || controller.signal.aborted) return;
      const status = cause instanceof OwnerRequestError ? cause.status : 503;
      if ([401, 403, 404].includes(status)) onAccessDenied(status);
      else { setError("This inquiry could not be loaded. Try again."); setLoading(false); }
    });
    return () => { active.current = false; controller.abort(); };
  }, [reference, onAccessDenied]);
  useEffect(() => {
    if (!dirty && !locked) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, locked]);

  function change<K extends keyof FollowupDraft>(field: K, value: FollowupDraft[K]) {
    if (locked) return;
    setDraft(current => current ? { ...current, [field]: value } : null);
    setDirty(true); setError(""); setMessage("");
  }
  function changeContact<K extends keyof Contact>(field: K, value: Contact[K]) {
    if (locked) return;
    setDraft(current => current ? { ...current, contact: { ...current.contact, [field]: value } } : null);
    setDirty(true); setError(""); setMessage("");
  }
  function focusNotice() { requestAnimationFrame(() => notice.current?.focus()); }
  async function reload(preserveDraft = false) {
    if (busy.current) return;
    busy.current = true; setLoading(true); setError("");
    try {
      const value = await readOwner<Detail>("?" + new URLSearchParams({ reference }));
      if (!active.current) return;
      if (value.application.id !== reference) throw new OwnerRequestError(503);
      setDetail(value);
      if (state === "unknown" && pending) {
        if (value.history.some(item => item.operationId === pending.operationId)) {
          setPending(null); setState("idle"); setDirty(false); setDraft(initialDraft(value)); setMessage("The saved change is confirmed in the record history."); onSaved();
        } else setMessage("The record was read, but this save has not been confirmed. Retry the same save to resolve its outcome.");
      } else {
        if (!preserveDraft || !draft) { setDraft(initialDraft(value)); setDirty(false); }
        setState("idle"); setPending(null); setShowDiscard(false);
        setMessage(preserveDraft ? "Latest record loaded. Your unsaved changes are preserved. Review them against the current record before saving." : "Latest record loaded.");
      }
    } catch (cause) {
      const status = cause instanceof OwnerRequestError ? cause.status : 503;
      if ([401, 403, 404].includes(status)) onAccessDenied(status);
      else setError("The latest record could not be read. Your unsaved changes are still here.");
    } finally { busy.current = false; if (active.current) { setLoading(false); focusNotice(); } }
  }
  async function loadHistory() {
    if (!detail || !detail.hasMoreHistory || !detail.history.length || busy.current || locked) return;
    busy.current = true; setLoading(true); setError("");
    try {
      const before = detail.history[detail.history.length - 1]!.version;
      const page = await readOwner<Detail>("?" + new URLSearchParams({ reference, historyBefore: String(before) }));
      if (!active.current) return;
      if (page.application.id !== reference || page.followup.version !== detail.followup.version) { setError("The record changed while reading history. Load the latest record before continuing."); setState("conflict"); return; }
      setDetail(current => current ? { ...current, history: [...current.history, ...page.history], hasMoreHistory: page.hasMoreHistory } : current);
    } catch (cause) {
      const status = cause instanceof OwnerRequestError ? cause.status : 503;
      if ([401, 403, 404].includes(status)) onAccessDenied(status); else setError("Older history could not be loaded. Try again.");
    } finally { busy.current = false; if (active.current) setLoading(false); }
  }
  async function save(command: KeysOwnerUpdate) {
    if (busy.current) return;
    const wasUnknown = state === "unknown";
    let postStarted = false;
    busy.current = true; setPending(command); setState("saving"); setError(""); setMessage("");
    try {
      const session = await sessionInfo();
      if (session.role !== "practitioner") throw new OwnerRequestError(403);
      postStarted = true;
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken }, body: JSON.stringify(command), signal: AbortSignal.timeout(25000) });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.ok !== true) throw new OwnerRequestError(response.status || 503);
      const result = body.data as SaveResult;
      if (result.saved !== true || result.followup?.applicationId !== reference || result.followup?.operationId !== command.operationId) throw new OwnerRequestError(503);
      if (!active.current) return;
      // Keep the editor and inquiry selection locked until readback is applied.
      // A slow read must not overwrite a new draft entered after the POST.
      const value = await readOwner<Detail>("?" + new URLSearchParams({ reference }));
      if (!active.current) return;
      if (value.application.id !== reference) throw new OwnerRequestError(503);
      setDetail(value); setDraft(initialDraft(value));
      setPending(null); setState("idle"); setDirty(false); setShowDiscard(false);
      setMessage("Saved and read back from the private inquiry record."); onSaved();
    } catch (cause) {
      if (!active.current) return;
      const status = cause instanceof OwnerRequestError ? cause.status : cause instanceof IdentityClientError && cause.code === "UNAUTHENTICATED" ? 401 : cause instanceof IdentityClientError && cause.code === "FORBIDDEN" ? 403 : 503;
      if ([401, 403, 404].includes(status)) { setDetail(null); setDraft(null); setPending(null); onAccessDenied(status); }
      else if (status === 409 && !wasUnknown) { setPending(null); setState("conflict"); setError("This inquiry changed before your save. Load the latest record, then review your preserved changes. Nothing was overwritten."); }
      else if (!wasUnknown && (!postStarted || [400, 429].includes(status))) { setPending(null); setState("idle"); setError(status === 429 ? "Please wait a moment, then try saving again. Your changes are preserved." : "The change was not saved. Check the note, dated next action or waiting condition, and any contact correction."); }
      else { setPending(command); setState("unknown"); setError("Save outcome is not confirmed. Retry this exact save, or check the saved record. Keep this page open."); }
    } finally { busy.current = false; focusNotice(); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!detail || !draft || locked || state === "conflict") return;
    const correction: KeysContactCorrection | undefined = draft.correctContact ? { version: "JLFA-KEYS-CONTACT-CORRECTION-v1", ...draft.contact, phone: normalizeKeysPhone(draft.contact.phone), reason: draft.correctionReason } : detail.followup.keysContactCorrection;
    const parsed = keysOwnerUpdateSchema.safeParse({ operationId: crypto.randomUUID(), applicationId: reference, expectedVersion: detail.followup.version, status: draft.status, note: draft.note, nextAction: draft.nextAction.trim() || null, dueDate: draft.dueDate || null, waitingCondition: draft.waitingCondition.trim() || null, ...(correction ? { contactCorrection: correction } : {}) });
    if (!parsed.success) { setError("Enter a note and a next action with its due date, or a waiting condition. Waiting status needs a waiting condition. Complete every contact field and the reason if making a correction."); focusNotice(); return; }
    void save(parsed.data);
  }

  return <section className={styles.detail} aria-labelledby="keys-owner-detail-title" aria-busy={loading || state === "saving"}>
    <div className={styles.detailHeader}><div><p className={styles.eyebrow}>Private family inquiry</p><h2 id="keys-owner-detail-title">{detail?.currentContact.guardianName ?? "Inquiry details"}</h2></div><button type="button" className={styles.secondary} disabled={loading || locked} onClick={() => dirty ? setShowDiscard(true) : void reload()}>Reload record</button></div>
    {(error || message) && <div className={error ? styles.alert : styles.message} ref={notice} tabIndex={-1} role={error ? "alert" : "status"}><p>{error || message}</p>{state === "unknown" && pending && <><p className={styles.small}>Pending operation: <span className={styles.reference}>{pending.operationId}</span></p><div className={styles.actions}><button type="button" className={styles.primary} disabled={loading} onClick={() => void save(pending)}>Retry same save</button><button type="button" className={styles.secondary} disabled={loading} onClick={() => void reload(true)}>Check saved record</button></div></>}{state === "conflict" && <button type="button" className={styles.secondary} disabled={loading} onClick={() => void reload(true)}>Load latest; keep my changes</button>}</div>}
    {showDiscard && <div className={styles.alert}><p>Reloading replaces the unsaved draft with the saved record.</p><div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setShowDiscard(false)}>Keep editing</button><button type="button" className={styles.secondary} onClick={() => void reload()}>Discard draft and reload</button></div></div>}
    {loading && !detail && <p role="status">Loading the private inquiry…</p>}
    {!detail && !loading && <button className={styles.secondary} type="button" onClick={() => void reload()}>Try loading again</button>}
    {detail && draft && <>
      <p className={styles.received}>Received {dateLabel(detail.application.receivedAt)} · <span className={styles.badge}>{statusLabels[detail.followup.status]}</span></p>
      <dl className={styles.facts}>{contactRows(detail.currentContact)}<div><dt>Boys</dt><dd>{detail.application.fields.children.map(child => <span className={styles.child} key={child.id}>{child.name} · age {child.ageYears}</span>)}</dd></div>{detail.application.fields.notes && <div><dt>Parent’s pickup note</dt><dd>{detail.application.fields.notes}</dd></div>}</dl>
      <div className={styles.permissionSummary}><strong>Contact permissions</strong><span>Trip contact: yes</span><span>Individual WhatsApp: {detail.application.fields.consent.whatsapp ? "yes" : "no"}</span><span>Future trip emails: {detail.application.fields.consent.futureEmail ? "yes" : "no"}</span></div>
      <details className={styles.original}><summary>Original submission and exact consent</summary><p>The original parent submission remains unchanged. Current corrections are recorded separately in the history.</p><dl className={styles.facts}>{contactRows(detail.application.fields)}</dl><p>{detail.application.fields.consent.noticeText}</p><p>{detail.application.fields.consent.whatsappText} <strong>{detail.application.fields.consent.whatsapp ? "Selected" : "Not selected"}</strong></p><p>{detail.application.fields.consent.futureEmailText} <strong>{detail.application.fields.consent.futureEmail ? "Selected" : "Not selected"}</strong></p><p className={styles.small}>Consent version: {detail.application.fields.consent.version}</p><p className={styles.small}>Inquiry reference: <span className={styles.reference}>{reference}</span></p></details>
      <form onSubmit={submit} className={styles.editor}><fieldset disabled={locked || loading}><legend>Update the follow-up</legend><p className={styles.small}>A saved status records your follow-up. It does not send a message or book a seat.</p>
        <label>Status<select value={draft.status} onChange={event => change("status", event.target.value as FollowupDraft["status"])}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>Note <span>Required</span><textarea value={draft.note} required rows={3} maxLength={5000} onChange={event => change("note", event.target.value)} placeholder="What happened, or what should happen next?" /></label>
        <div className={styles.fieldRow}><label>Next action<input value={draft.nextAction} maxLength={500} onChange={event => change("nextAction", event.target.value)} /></label><label>Due date<input type="date" value={draft.dueDate} onChange={event => change("dueDate", event.target.value)} /></label></div>
        <label>Waiting condition <span>Required when Waiting</span><input value={draft.waitingCondition} maxLength={500} onChange={event => change("waitingCondition", event.target.value)} placeholder="For example: parent to confirm pickup area" /></label>
        <p className={styles.hint}>Open inquiries need a dated next action or a waiting condition. Closed inquiries may leave both empty.</p>
        <label className={styles.check}><input type="checkbox" checked={draft.correctContact} onChange={event => change("correctContact", event.target.checked)} /><span>Correct contact or pickup details</span></label>
        {draft.correctContact && <fieldset className={styles.correction}><legend>Contact correction</legend><p className={styles.small}>Use details supplied or confirmed by the parent. The original stays in the record.</p>
          <label>Parent or guardian’s name<input required maxLength={120} value={draft.contact.guardianName} onChange={event => changeContact("guardianName", event.target.value)} /></label><div className={styles.fieldRow}><label>Email<input type="email" required maxLength={254} value={draft.contact.email} onChange={event => changeContact("email", event.target.value)} /></label><label>Phone<input type="tel" required maxLength={30} value={draft.contact.phone} onChange={event => changeContact("phone", event.target.value)} /></label></div><div className={styles.fieldRow}><label>City<input required maxLength={100} value={draft.contact.city} onChange={event => changeContact("city", event.target.value)} /></label><label>ZIP code<input required inputMode="numeric" maxLength={10} value={draft.contact.postalCode} onChange={event => changeContact("postalCode", event.target.value)} /></label></div><label>Availability<select value={draft.contact.availability} onChange={event => changeContact("availability", event.target.value as Contact["availability"])}>{Object.entries(availabilityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><fieldset className={styles.pickupChoices}><legend>Pickup preferences</legend>{(Object.entries(KEYS_PICKUP_LABELS) as [Pickup, string][]).map(([value, label]) => <label className={styles.check} key={value}><input type="checkbox" checked={draft.contact.pickupPreferences.includes(value)} onChange={event => changeContact("pickupPreferences", event.target.checked ? [...draft.contact.pickupPreferences, value] : draft.contact.pickupPreferences.filter(area => area !== value))} /><span>{label}</span></label>)}</fieldset><label>Reason for this correction <span>Required</span><textarea required rows={2} maxLength={500} value={draft.correctionReason} onChange={event => change("correctionReason", event.target.value)} placeholder="What did the parent confirm, and how?" /></label>
        </fieldset>}
        {!draft.correctContact && detail.followup.keysContactCorrection && <p className={styles.hint}>The existing contact correction will be retained with this follow-up.</p>}
        <button type="submit" className={styles.primary} disabled={locked || loading || state === "conflict"}>{state === "saving" ? "Saving…" : "Save follow-up"}</button>
      </fieldset></form>
      <section className={styles.history} aria-labelledby="keys-history-title"><h3 id="keys-history-title">Saved history</h3>{detail.history.length === 0 ? <p className={styles.small}>No owner follow-up has been recorded yet.</p> : <ol>{detail.history.map(item => <li key={item.operationId}><p><strong>{statusLabels[item.status]}</strong> · <time dateTime={item.recordedAt}>{dateLabel(item.recordedAt)}</time></p><p>{item.note}</p>{item.nextAction && <p className={styles.small}>Next: {item.nextAction} · due {item.dueDate}</p>}{item.waitingCondition && <p className={styles.small}>Waiting for: {item.waitingCondition}</p>}{item.keysContactCorrection && <details><summary>Contact correction</summary><p>{item.keysContactCorrection.reason}</p><dl className={styles.facts}>{contactRows(item.keysContactCorrection)}</dl></details>}</li>)}</ol>}{detail.hasMoreHistory && <button type="button" className={styles.secondary} disabled={loading || locked} onClick={() => void loadHistory()}>Load older history</button>}</section>
    </>}
  </section>;
}

export function KeysOwnerWorkspace({ locale, initialReference = "" }: { locale: Locale; initialReference?: string }) {
  const [items, setItems] = useState<ListPage["items"]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [denied, setDenied] = useState<number | null>(null);
  const [selected, setSelected] = useState(initialReference);
  const [search, setSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [locked, setLocked] = useState(false);
  const [switchTo, setSwitchTo] = useState<string | null>(null);
  const listBusy = useRef(false);
  const accessDenied = useCallback((status: number) => { setDenied(status); setItems([]); setSummary(null); setSelected(""); setDirty(false); setLocked(false); }, []);
  const load = useCallback(async () => {
    if (listBusy.current) return;
    listBusy.current = true; setLoading(true); setError(""); setSummaryError("");
    const results = await Promise.allSettled([readOwner<ListPage>(), readOwner<Summary>("?summary=true")]);
    let deniedStatus: number | null = null;
    const list = results[0], totals = results[1];
    if (list.status === "fulfilled") { setItems(list.value.items); setCursor(list.value.nextCursor); }
    else { if (list.reason instanceof OwnerRequestError && [401, 403, 404].includes(list.reason.status)) deniedStatus = list.reason.status; else setError("Inquiries could not be refreshed. Any displayed records are from the last successful read."); }
    if (totals.status === "fulfilled") setSummary(totals.value);
    else { if (totals.reason instanceof OwnerRequestError && [401, 403, 404].includes(totals.reason.status)) deniedStatus = totals.reason.status; else setSummaryError("Summary could not be refreshed. Totals shown, if any, are from the last successful read."); }
    if (deniedStatus !== null) accessDenied(deniedStatus);
    setLoading(false); listBusy.current = false;
  }, [accessDenied]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function more() {
    if (!cursor || listBusy.current || locked) return;
    listBusy.current = true; setLoading(true); setError("");
    try { const page = await readOwner<ListPage>("?" + new URLSearchParams({ cursor })); setItems(current => { const ids = new Set(current.map(item => item.application.id)); return [...current, ...page.items.filter(item => !ids.has(item.application.id))]; }); setCursor(page.nextCursor); }
    catch (cause) { const status = cause instanceof OwnerRequestError ? cause.status : 503; if ([401, 403, 404].includes(status)) accessDenied(status); else setError("The next page could not be loaded. Try again."); }
    finally { setLoading(false); listBusy.current = false; }
  }
  function choose(reference: string) { if (locked || reference === selected) return; if (dirty) setSwitchTo(reference); else { setSelected(reference); setSwitchTo(null); } }
  const matches = items.filter(item => [item.currentContact.guardianName, item.currentContact.email, item.currentContact.phone, item.currentContact.city, ...item.application.fields.children.map(child => child.name)].join(" ").toLowerCase().includes(search.trim().toLowerCase()));

  return <main className={styles.workspace} lang="en" dir="ltr"><header className={styles.heading}><div><p className={styles.eyebrow}>Fishing Academy · Private owner view</p><h1>Keys trip inquiries</h1><p>Sunday, December 6, 2026</p></div><div className={styles.actions}><a className={styles.secondary} href={keysTripPublic.publicUrl} target="_blank" rel="noopener noreferrer">Open public trip page</a><button className={styles.secondary} type="button" disabled={loading || locked || denied !== null} onClick={() => void load()}>Refresh inquiries</button></div></header>
    {denied !== null ? <section className={styles.alert} role="alert"><h2>{denied === 401 ? "Please sign in again" : "This account cannot open the Keys inquiries"}</h2><p>Private records are available only to the configured Fishing Academy owner.</p>{denied === 401 && <a className={styles.primary} href={loginHref(locale, `/${locale}/app/keys`)}>Sign in</a>}</section> : <>
      {summaryError && <p className={styles.alert} role="alert">{summaryError}</p>}
      <section className={styles.summary} aria-label="Interest summary"><div><span>{summary?.complete === false ? "Requests counted so far" : "Interest requests"}</span><strong>{summary ? summary.families : "—"}</strong></div><div><span>{summary?.complete === false ? "Child places counted so far" : "Requested child places"}</span><strong>{summary ? summary.boys : "—"}</strong></div><p>These are interest requests. <strong>They are not booked or paid seats.</strong>{summary?.complete === false && <span> The summary is partial; more inquiry pages remain.</span>}</p></section>
      {summary && <details className={styles.areaSummary}><summary>Pickup-area preferences</summary><p>A request may list several pickup areas, so these counts overlap. Repeat requests are not combined into unique families.</p><table><thead><tr><th scope="col">Pickup area</th><th scope="col">Requests</th><th scope="col">Child places</th></tr></thead><tbody>{Object.entries(KEYS_PICKUP_LABELS).map(([area, label]) => <tr key={area}><th scope="row">{label}</th><td>{summary.pickupAreas[area]?.families ?? 0}</td><td>{summary.pickupAreas[area]?.boys ?? 0}</td></tr>)}</tbody></table></details>}
      {error && <p className={styles.alert} role="alert">{error}</p>}
      {switchTo && <div className={styles.alert} role="alert"><p>You have unsaved changes. Open the other inquiry and discard this draft?</p><div className={styles.actions}><button className={styles.secondary} type="button" onClick={() => setSwitchTo(null)}>Keep editing</button><button className={styles.secondary} type="button" onClick={() => { setSelected(switchTo); setSwitchTo(null); setDirty(false); }}>Discard draft and open</button></div></div>}
      <div className={styles.columns}><section className={styles.list} aria-labelledby="keys-owner-list-title" aria-busy={loading}><h2 id="keys-owner-list-title">Family inquiries</h2><label className={styles.search}>Search loaded inquiries<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, email, phone or city" /></label>{loading && items.length === 0 && <p role="status">Loading private inquiries…</p>}{!loading && !error && items.length === 0 && <p className={styles.empty}>{cursor ? "No Keys inquiries on this page. Load the next page to continue." : "No Keys trip inquiries have been received yet."}</p>}{items.length > 0 && matches.length === 0 && <p className={styles.empty}>No match in the loaded inquiries. {cursor ? "Load more to search additional records." : "Try another name or contact detail."}</p>}<ul>{matches.map(item => <li key={item.application.id}><button type="button" className={styles.inquiryButton} aria-pressed={selected === item.application.id} disabled={locked && selected !== item.application.id} onClick={() => choose(item.application.id)}><span className={styles.inquiryTitle}>{item.currentContact.guardianName}<small>{statusLabels[item.followup.status]}</small></span><span>{item.currentContact.city} · {item.application.fields.children.length} {item.application.fields.children.length === 1 ? "boy" : "boys"}</span><span className={styles.small}>{availabilityLabels[item.currentContact.availability]}</span><span className={styles.small}>{dateLabel(item.application.receivedAt)}</span></button></li>)}</ul>{cursor && <button className={styles.secondary} type="button" disabled={loading || locked} onClick={() => void more()}>{loading ? "Loading…" : "Load more inquiries"}</button>}</section>
        {selected ? <InquiryDetail key={selected} reference={selected} onDirtyChange={setDirty} onLockedChange={setLocked} onAccessDenied={accessDenied} onSaved={() => void load()} /> : <section className={styles.selectPrompt}><h2>Select an inquiry</h2><p>Review the family, pickup preferences and permissions, then record your next action.</p></section>}
      </div>
    </>}
  </main>;
}
