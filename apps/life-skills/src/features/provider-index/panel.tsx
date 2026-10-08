"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { UnsavedChangesGuard } from "../../ui/workspace/draft-guard.tsx";
import { emptyProvider, parseProvider, parseQuery, verificationStates, writeFailureIsUncertain, type ProviderInput, type ProviderRecord, type ProviderPage, type ProviderCommand, type WriteReceipt } from "./core.ts";
import { providerRequest } from "./client.ts";
import { providerCopy, problemText } from "./copy.ts";
import { ReferralPanel } from "../provider-referrals/panel.tsx";
import styles from "./panel.module.css";
export function ProviderIndexPanel({ locale, caseId }: { locale: "he" | "en"; caseId?: string }) {
  const t = providerCopy[locale], [query, setQuery] = useState(() => parseQuery({ locale })), [search, setSearch] = useState("");
  const [page, setPage] = useState<ProviderPage | null>(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<ProviderRecord | null>(null), [form, setForm] = useState<ProviderInput | null>(null), [servicesText, setServicesText] = useState("");
  const [allowDuplicate, setAllowDuplicate] = useState(false), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false);
  const [referralState, setReferralState] = useState({ dirty: false, busy: false, uncertain: false });
  const inFlight = useRef(false);
  const pending = useRef<ProviderCommand | null>(null), sequence = useRef(0), detailHeading = useRef<HTMLHeadingElement>(null);
  const dirty = !!form && (JSON.stringify(form) !== JSON.stringify(selected?.entry ?? emptyProvider()) || servicesText !== (selected?.entry.services ?? []).join("\n"));
  const load = useCallback(async () => {
    const n = ++sequence.current; setLoading(true); setLoadError("");
    try { const next = await providerRequest<ProviderPage>("provider-index", { action: "search", query }); if (n === sequence.current) setPage(next); }
    catch (error) { if (n === sequence.current) { setLoadError(problemText(providerCopy[locale], error)); setPage(null); } }
    finally { if (n === sequence.current) setLoading(false); }
  }, [query, locale]);
  const cancelLoad = useCallback(() => { sequence.current++; }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => { window.clearTimeout(timer); cancelLoad(); }; }, [load, cancelLoad]);
  const open = (record: ProviderRecord | null) => {
    if (busy || referralState.busy) return;
    if ((dirty || uncertain || referralState.dirty || referralState.uncertain) && !window.confirm(t.leave)) return;
    pending.current = null; setSelected(record); setForm(record ? null : emptyProvider());
    setServicesText(""); setMessage(""); setUncertain(false); setConflict(false); setAllowDuplicate(false);
    requestAnimationFrame(() => { detailHeading.current?.focus(); detailHeading.current?.scrollIntoView({ block: "start" }); });
  };
  const edit = () => {
    if (!selected || busy || referralState.busy) return;
    setForm(structuredClone(selected.entry)); setServicesText(selected.entry.services.join("\n")); setMessage(""); setConflict(false); setAllowDuplicate(false);
    requestAnimationFrame(() => { detailHeading.current?.focus(); detailHeading.current?.scrollIntoView({ block: "start" }); });
  };
  const change = <K extends keyof ProviderInput>(key: K, value: ProviderInput[K]) => {
    if (uncertain || busy) return; setForm(old => old ? { ...old, [key]: value } : old); setMessage(""); setConflict(false); pending.current = null;
  };
  const run = async (command?: ProviderCommand) => {
    if (inFlight.current) return; const c = command ?? pending.current; if (!c) return;
    const retryingUncertain = uncertain;
    pending.current = c; inFlight.current = true; setBusy(true); setMessage(""); setConflict(false);
    let receivedReceipt = false;
    try {
      const receipt = await providerRequest<WriteReceipt>("provider-index", c); receivedReceipt = true;
      const record = await providerRequest<ProviderRecord>("provider-index", { action: "read", id: receipt.id });
      if (record.version < receipt.version) throw new Error("READBACK_NOT_CURRENT");
      setSelected(record); setForm(null); setServicesText("");
      pending.current = null; setUncertain(false); setAllowDuplicate(false); setMessage(t.saved); void load();
    } catch (error) {
      const code = (error as { code?: string }).code;
      const unknown = writeFailureIsUncertain(retryingUncertain, receivedReceipt, code);
      setUncertain(unknown); setConflict(code === "CONFLICT"); setMessage(unknown ? t.uncertain : problemText(t, error));
      if (!unknown) pending.current = null;
    } finally { inFlight.current = false; setBusy(false); }
  };
  const save = () => {
    if (!form || busy || conflict) return;
    if (uncertain) { void run(); return; }
    try {
      const entry = parseProvider({ ...form, services: servicesText.split("\n").map(s => s.trim()).filter(Boolean) });
      const common = { operationId: crypto.randomUUID(), id: selected?.id ?? crypto.randomUUID(), entry, allowDuplicate };
      void run(selected ? { action: "update", ...common, expectedVersion: selected.version } : { action: "create", ...common });
    } catch (error) { setMessage(problemText(t, error)); }
  };
  const compare = async () => {
    if (!selected || !window.confirm(t.discard)) return;
    setBusy(true);
    try { const record = await providerRequest<ProviderRecord>("provider-index", { action: "read", id: selected.id });
      setSelected(record); setForm(structuredClone(record.entry)); setServicesText(record.entry.services.join("\n")); setConflict(false); setUncertain(false); pending.current = null; setMessage("");
    } catch (error) { setMessage(problemText(t, error)); } finally { setBusy(false); }
  };
  const archive = () => {
    if (!selected || busy || referralState.busy || referralState.dirty || referralState.uncertain || uncertain || dirty || !window.confirm(selected.archived ? t.restoreConfirm : t.archiveConfirm)) return;
    void run({ action: "archive", id: selected.id, operationId: crypto.randomUUID(), expectedVersion: selected.version, archived: !selected.archived });
  };
  const field = (key: "name" | "location" | "phone" | "email" | "website", label: string, type = "text") => <label className={styles.label}>{label}<input name={key} type={type} required={key === "name"} maxLength={key === "name" ? 160 : key === "phone" ? 40 : key === "website" ? 1024 : key === "email" ? 254 : 240} value={form?.[key] ?? ""} onChange={e => change(key, e.target.value)} dir={["phone", "email", "website"].includes(key) ? "ltr" : undefined} /></label>;
  const filters = (label: string, key: "service" | "location" | "gender" | "religiousFit", values: string[]) => <label className={styles.label}>{label}<select value={query[key]} onChange={e => setQuery({ ...query, [key]: e.target.value, page: 1 })}><option value="">{t.all}</option>{values.map(v => <option key={v} value={v}>{v}</option>)}</select></label>;
  return <main className={`lsw-main ${styles.surface}`} lang={locale} dir={locale === "he" ? "rtl" : "ltr"}>
    <UnsavedChangesGuard dirty={dirty || uncertain || busy || referralState.dirty || referralState.uncertain || referralState.busy} message={t.leave} />
    <div className={styles.stack}>
      <nav><a href={caseId ? `/${locale}/app/cases/${caseId}` : `/${locale}/app/clients`}>{caseId ? t.backCase : t.people}</a></nav>
      <header className={styles.toolbar}><div><h1>{t.title}</h1><p>{t.private}</p></div><button type="button" className="lsw-button" disabled={busy || referralState.busy} onClick={() => open(null)}>{t.new}</button></header>
      <form className={styles.toolbar} onSubmit={e => { e.preventDefault(); setQuery({ ...query, search, page: 1 }); }}>
        <label className={styles.label}>{t.search}<input type="search" value={search} maxLength={160} onChange={e => setSearch(e.target.value)} /></label><button type="submit" className="lsw-button lsw-button--secondary">{t.find}</button>
      </form>
      <details className={styles.filters} open={!caseId}>
        <summary>{t.filters}</summary><div className={styles.fields}>
        {filters(t.service, "service", page?.options.services ?? [])}{filters(t.location, "location", page?.options.locations ?? [])}
        <label className={styles.label}>{t.verification}<select value={query.verification} onChange={e => setQuery(parseQuery({ ...query, verification: e.target.value, page: 1 }))}><option value="all">{t.all}</option>{verificationStates.map(s => <option key={s} value={s}>{t.state[s]}</option>)}</select></label>
        <label className={styles.label}>{t.archiveFilter}<select value={query.archive} onChange={e => setQuery(parseQuery({ ...query, archive: e.target.value, page: 1 }))}><option value="active">{t.active}</option><option value="archived">{t.archived}</option><option value="all">{t.all}</option></select></label>
        {filters(t.gender, "gender", page?.options.genders ?? [])}{filters(t.religiousFit, "religiousFit", page?.options.religiousFits ?? [])}
        </div>
      </details>
      {loadError && <p role="alert">{loadError} <button type="button" onClick={() => void load()}>{t.retry}</button></p>}
      <div className={styles.grid}>
        <section className={`${styles.stack} ${styles.results}`} aria-label={t.results} aria-busy={loading}>
          {loading && <p role="status">{t.loading}</p>}
          {page && <p>{t.results}: {page.total}</p>}{page && !page.items.length && <p>{t.empty}</p>}
          <ul className={styles.list}>{page?.items.map(r => <li key={r.id} className={`${styles.card} ${selected?.id === r.id ? styles.selected : ""}`}>
            <h2>{r.entry.name}</h2><p>{r.entry.services.join(" · ")}</p><p>{r.entry.location}</p><p>{t.state[r.entry.verification.status]}{r.archived ? ` · ${t.archived}` : ""}</p>
            <p className={styles.meta}><bdi>{r.entry.phone}</bdi> <bdi>{r.entry.email}</bdi></p>
            <button type="button" className="lsw-button lsw-button--secondary" disabled={busy || referralState.busy} onClick={() => open(r)}>{t.open}</button>
          </li>)}</ul>
          {page && <div className={styles.buttons}><button type="button" disabled={loading || page.page <= 1} onClick={() => setQuery({ ...query, page: page.page - 1 })}>{t.previous}</button><span>{page.page} / {Math.max(1, Math.ceil(page.total / page.pageSize))}</span><button type="button" disabled={loading || page.page * page.pageSize >= page.total} onClick={() => setQuery({ ...query, page: page.page + 1 })}>{t.next}</button></div>}
        </section>
        <section className={styles.stack} aria-label={t.open}>
          {selected && !form && <section className={styles.summary} aria-label={t.summary}>
            <h2 ref={detailHeading} tabIndex={-1}>{selected.entry.name}</h2>
            <p className={styles.meta}>{t.version}: {selected.version} · {selected.archived ? t.archived : t.active}</p>
            {selected.entry.services.length > 0 && <p>{selected.entry.services.join(" · ")}</p>}
            {selected.entry.location && <p>{selected.entry.location}</p>}
            {(selected.entry.phone || selected.entry.email) && <p className={styles.meta}><bdi>{selected.entry.phone}</bdi> <bdi>{selected.entry.email}</bdi></p>}
            <p>{t.noCaseData}</p>
            {message && <p role="status" className={styles.notice}>{message}</p>}
            <div className={styles.summaryActions}><button type="button" className="lsw-button lsw-button--secondary" disabled={busy || referralState.busy} onClick={edit}>{t.edit}</button>
              {selected.entry.website && <a href={selected.entry.website} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{t.website}</a>}</div>
          </section>}
          {form && <div className={styles.card}>
            <h2 ref={detailHeading} tabIndex={-1}>{selected ? selected.entry.name : t.new}</h2>
            {selected && <p className={styles.meta}>{t.version}: {selected.version} · {selected.archived ? t.archived : t.active}</p>}
            <p>{t.noCaseData}</p>
            <form className={styles.stack} onSubmit={e => { e.preventDefault(); save(); }}>
              <fieldset disabled={busy || uncertain} className={`${styles.fields} ${styles.editorFields}`}>
                <legend>{t.open}</legend>{field("name", t.name)}{field("location", t.location)}
                <label className={`${styles.label} ${styles.full}`}>{t.services}<textarea value={servicesText} maxLength={1010} onChange={e => { setServicesText(e.target.value); setConflict(false); setMessage(""); }} /></label>
                {field("phone", t.phone, "tel")}{field("email", t.email, "email")}{field("website", t.website, "url")}
                <div className={`${styles.stack} ${styles.full}`}><h3>{t.source}</h3>{form.sources.map((s, i) => <div className={styles.fields} key={i}>
                  <label className={styles.label}>{t.sourceLabel}<input value={s.label} maxLength={300} onChange={e => change("sources", form.sources.map((v, n) => n === i ? { ...v, label: e.target.value } : v))} /></label>
                  <label className={styles.label}>{t.sourceUrl}<input type="url" dir="ltr" value={s.url} maxLength={1024} onChange={e => change("sources", form.sources.map((v, n) => n === i ? { ...v, url: e.target.value } : v))} /></label>
                  <button type="button" onClick={() => change("sources", form.sources.filter((_, n) => n !== i))}>{t.removeSource}</button></div>)}
                  <button type="button" disabled={form.sources.length >= 5} onClick={() => change("sources", [...form.sources, { label: "", url: "" }])}>{t.addSource}</button>
                </div>
                <label className={styles.label}>{t.verification}<select value={form.verification.status} onChange={e => change("verification", { ...form.verification, status: e.target.value as ProviderInput["verification"]["status"] })}>{verificationStates.map(s => <option key={s} value={s}>{t.state[s]}</option>)}</select></label>
                <label className={styles.label}>{t.checkedOn}<input type="date" value={form.verification.checkedOn} onChange={e => change("verification", { ...form.verification, checkedOn: e.target.value })} /></label>
                <label className={`${styles.label} ${styles.full}`}>{t.basis}<textarea value={form.verification.basis} maxLength={600} onChange={e => change("verification", { ...form.verification, basis: e.target.value })} /></label><p className={styles.full}>{t.evidenceHelp}</p>
                <details className={styles.full}><summary>{t.religiousFit} / {t.gender}</summary><div className={styles.stack}><p>{t.fitHelp}</p>
                  <label className={styles.label}>{t.gender}<input maxLength={80} value={form.declaredFit.gender} onChange={e => change("declaredFit", { ...form.declaredFit, gender: e.target.value })} /></label>
                  <label className={styles.label}>{t.religiousFit}<input maxLength={100} value={form.declaredFit.religiousFit} onChange={e => change("declaredFit", { ...form.declaredFit, religiousFit: e.target.value })} /></label>
                  <label className={styles.label}>{t.fitSource}<textarea maxLength={600} value={form.declaredFit.source} onChange={e => change("declaredFit", { ...form.declaredFit, source: e.target.value })} /></label>
                </div></details>
                <label className={`${styles.label} ${styles.full}`}>{t.notes}<textarea maxLength={2000} value={form.privateNotes} onChange={e => change("privateNotes", e.target.value)} /><span>{t.notesHelp}</span></label>
                <label className={styles.full}><input type="checkbox" checked={allowDuplicate} onChange={e => { setAllowDuplicate(e.target.checked); setConflict(false); }} /> {t.allowDuplicate}</label>
              </fieldset>
              {message && <p role="status" className={styles.notice}>{message}</p>}
              <div className={styles.buttons}>
                {!uncertain && <button type="submit" className="lsw-button lsw-button--primary" disabled={busy || conflict}>{busy ? t.saving : t.save}</button>}
                {uncertain && <button type="button" disabled={busy} onClick={() => void run()}>{t.retrySave}</button>}
                {conflict && selected && <button type="button" disabled={busy} onClick={() => void compare()}>{t.compare}</button>}
                <button type="button" className="lsw-button lsw-button--quiet" disabled={busy} onClick={() => { if (referralState.busy) return; if ((dirty || uncertain || referralState.dirty || referralState.uncertain) && !window.confirm(t.leave)) return; setForm(null); if (!selected) setSelected(null); pending.current = null; setUncertain(false); }}>{t.cancel}</button>
                {selected && <button type="button" className={`lsw-button ${styles.archiveButton}`} disabled={busy || dirty || uncertain || conflict || referralState.busy || referralState.dirty || referralState.uncertain} onClick={archive}>{selected.archived ? t.restore : t.archive}</button>}
              </div>
            </form>
          </div>}
          {selected && <ReferralPanel key={`${selected.id}:${caseId ?? "general"}`} locale={locale} provider={selected} caseId={caseId ?? null} onStateChange={setReferralState} />}
          {!form && !selected && <p>{t.choose}</p>}
        </section>
      </div>
    </div>
  </main>;
}
