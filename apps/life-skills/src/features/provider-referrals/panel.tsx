"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { writeFailureIsUncertain, type ProviderRecord, type WriteReceipt } from "../provider-index/core.ts";
import { providerRequest } from "../provider-index/client.ts";
import { providerCopy, problemText } from "../provider-index/copy.ts";
import { parseReferral, referralStates, type ReferralInput, type ReferralRecord, type ReferralCommand } from "./core.ts";
import styles from "../provider-index/panel.module.css";
export function ReferralPanel({ locale, provider, caseId, onStateChange }: { locale: "he" | "en"; provider: ProviderRecord; caseId: string | null; onStateChange: (state: { dirty: boolean; busy: boolean; uncertain: boolean }) => void }) {
  const t = providerCopy[locale], blank = useCallback((): ReferralInput => ({ providerId: provider.id, caseId, happenedOn: "", status: "considering", context: "", nextAction: "", nextOn: "" }), [provider.id, caseId]);
  const [records, setRecords] = useState<ReferralRecord[] | null>(null), [selected, setSelected] = useState<ReferralRecord | null>(null), [form, setForm] = useState<ReferralInput | null>(null);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState(""), [conflict, setConflict] = useState(false);
  const inFlight = useRef(false);
  const pending = useRef<ReferralCommand | null>(null), seq = useRef(0);
  const dirty = !!form && JSON.stringify(form) !== JSON.stringify(selected?.detail ?? blank());
  useEffect(() => { onStateChange({ dirty, busy, uncertain }); }, [dirty, busy, uncertain, onStateChange]);
  useEffect(() => () => { onStateChange({ dirty: false, busy: false, uncertain: false }); }, [onStateChange]);
  const load = useCallback(async () => {
    const id = ++seq.current;
    try { const result = await providerRequest<ReferralRecord[]>("provider-referrals", { action: "list", providerId: provider.id, caseId }); if (id === seq.current) setRecords(result); }
    catch (error) { if (id === seq.current) { setRecords(null); setMessage(problemText(providerCopy[locale], error)); } }
  }, [provider.id, caseId, locale]);
  const cancelLoad = useCallback(() => { seq.current++; }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => { window.clearTimeout(timer); cancelLoad(); }; }, [load, cancelLoad]);
  const open = (r: ReferralRecord | null) => {
    if (busy || (dirty || uncertain) && !window.confirm(t.leave)) return;
    setSelected(r); setForm(structuredClone(r?.detail ?? blank())); pending.current = null; setUncertain(false); setConflict(false); setMessage("");
  };
  const change = <K extends keyof ReferralInput>(key: K, value: ReferralInput[K]) => { if (!busy && !uncertain) { setForm(p => p ? { ...p, [key]: value } : p); setMessage(""); } };
  const save = async () => {
    if (!form || inFlight.current || conflict) return;
    const retryingUncertain = uncertain;
    let c = pending.current;
    if (!c) { try { const detail = parseReferral(form), common = { operationId: crypto.randomUUID(), id: selected?.id ?? crypto.randomUUID(), detail };
      c = selected ? { action: "update", ...common, expectedVersion: selected.version } : { action: "create", ...common };
    } catch (error) { setMessage(problemText(t, error)); return; } }
    pending.current = c; seq.current++; inFlight.current = true; setBusy(true); setMessage("");
    let receivedReceipt = false;
    try {
      const receipt = await providerRequest<WriteReceipt>("provider-referrals", c); receivedReceipt = true;
      const saved = await providerRequest<ReferralRecord[]>("provider-referrals", { action: "list", providerId: provider.id, caseId });
      const readback = saved.find(r => r.id === receipt.id); if (!readback || readback.version < receipt.version) throw new Error("READBACK_FAILED");
      setRecords(saved); setSelected(readback); setForm(structuredClone(readback.detail)); pending.current = null; setUncertain(false); setMessage(t.saved);
    } catch (error) {
      const code = (error as { code?: string }).code, unknown = writeFailureIsUncertain(retryingUncertain, receivedReceipt, code);
      setUncertain(unknown); setConflict(code === "CONFLICT"); setMessage(unknown ? t.uncertain : problemText(t, error)); if (!unknown) pending.current = null;
    } finally { inFlight.current = false; setBusy(false); }
  };
  const compare = async () => {
    if (!selected || busy || !window.confirm(t.discard)) return;
    seq.current++; setBusy(true);
    try {
      const saved = await providerRequest<ReferralRecord[]>("provider-referrals", { action: "list", providerId: provider.id, caseId });
      const current = saved.find(r => r.id === selected.id); if (!current) throw new Error("RECORD_NOT_FOUND");
      setRecords(saved); setSelected(current); setForm(structuredClone(current.detail)); pending.current = null;
      setConflict(false); setUncertain(false); setMessage("");
    } catch (error) { setMessage(problemText(t, error)); } finally { setBusy(false); }
  };
  return <section className={`${styles.card} ${styles.stack}`} aria-label={t.privateContext}>
    <h2>{t.privateContext}</h2><p>{caseId ? t.caseContext : t.generalContext}</p>
    {provider.archived && <p>{t.archivedWarning}</p>}
    <button type="button" className="lsw-button lsw-button--secondary" disabled={busy || provider.archived} onClick={() => open(null)}>{t.newReferral}</button>
    {!records && <p>{message || t.referralsLoading} <button type="button" disabled={busy} onClick={() => void load()}>{t.retry}</button></p>}
    {records?.length === 0 && <p>{t.noReferrals}</p>}
    <ul className={styles.list}>{records?.map(r => <li key={r.id}><strong>{t.referralStates[r.detail.status]}</strong> {r.detail.happenedOn}<p>{r.detail.context}</p><p>{r.detail.nextAction} {r.detail.nextOn}</p><button type="button" disabled={busy} onClick={() => open(r)}>{t.editReferral}</button></li>)}</ul>
    {form && <form className={styles.stack} onSubmit={e => { e.preventDefault(); void save(); }}>
      <fieldset disabled={busy || uncertain} className={styles.fields}><legend>{t.privateContext}</legend>
        <label className={styles.label}>{t.referralDate}<input type="date" value={form.happenedOn} onChange={e => change("happenedOn", e.target.value)} /></label>
        <label className={styles.label}>{t.referralStatus}<select value={form.status} onChange={e => change("status", e.target.value as ReferralInput["status"])}>{referralStates.map(s => <option key={s} value={s}>{t.referralStates[s]}</option>)}</select></label>
        <label className={`${styles.label} ${styles.full}`}>{t.context}<textarea maxLength={1000} value={form.context} onChange={e => change("context", e.target.value)} /></label>
        <label className={styles.label}>{t.nextAction}<input maxLength={500} value={form.nextAction} onChange={e => change("nextAction", e.target.value)} /></label>
        <label className={styles.label}>{t.nextOn}<input type="date" value={form.nextOn} onChange={e => change("nextOn", e.target.value)} /></label>
      </fieldset>
      {message && <p role="status" className={styles.notice}>{message}</p>}
      <div className={styles.buttons}><button type="submit" className="lsw-button" disabled={busy || conflict}>{busy ? t.saving : uncertain ? t.retrySave : t.saveReferral}</button>
      {conflict && selected && <button type="button" disabled={busy} onClick={() => void compare()}>{t.compare}</button>}
      <button type="button" disabled={busy} onClick={() => { if ((dirty || uncertain) && !window.confirm(t.leave)) return; setForm(null); pending.current = null; setUncertain(false); setConflict(false); }}>{t.cancel}</button></div>
    </form>}
  </section>;
}
