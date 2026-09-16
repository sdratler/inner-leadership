"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  accountAction,
  publicAuthAction,
  sessionInfo,
  takeAuthTokenFragment,
} from "@/features/identity/client.ts";
import type { PreEnrollmentInput } from "./schema.ts";
import { respondentLink } from "./staff-link.ts";
import { staffCopy, newAmendmentDays, type StaffLocale } from "./staff-locales.ts";
import styles from "./staff-client.module.css";
type Session = Awaited<ReturnType<typeof sessionInfo>>;
type Receipt = {
  receiptId: string;
  receivedAt: string;
  amendmentCount: number;
  consentVersion: string;
  consentHash: string;
};
type Consent = {
  version: string;
  hash: string;
  sourceHashes: string[];
  displayText: string[];
  acknowledgements: string[];
};
type Entry = {
  kind: "original" | "amendment";
  entryId: string;
  createdAt: string;
  actorAccountId: string | null;
  input: PreEnrollmentInput;
  consent: Consent | null;
};
type Selection = { receiptId: string; entries: Entry[] };
type IssuedLink = { href: string; expiresAt: string };
const windowKeys = ["morning", "afternoon", "evening"] as const;
async function staff<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = (await response.json()) as { ok?: boolean; data?: T };
  if (!response.ok || !body.ok || body.data === undefined)
    throw Error("unavailable");
  return body.data;
}
export function IntakeStaffClient({ locale = "he", respondentOrigin }: { locale?: StaffLocale; respondentOrigin: string }) {
  const t = staffCopy(locale), english = locale === "en", activationLinkError = t.errors.activationLink;
  const formatDate = (value: string, withTime = false) => new Intl.DateTimeFormat(english ? "en-GB" : "he-IL", { timeZone: t.timezone, dateStyle: withTime ? undefined : "medium", ...(withTime ? { dateStyle: "medium", timeStyle: "short" } : {}) }).format(new Date(value));
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<Receipt[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState("");
  const [mode, setMode] = useState<"login" | "invite" | "reset">("login");
  const [pending, setPending] = useState(false);
  const [issuedLink, setIssuedLink] = useState<IssuedLink | null>(null);
  const [issueState, setIssueState] = useState<
    "idle" | "issuing" | "uncertain" | "issued"
  >("idle");
  const authToken = useRef<string | null>(null),
    started = useRef(false),
    requestSequence = useRef(0),
    sessionEpoch = useRef(0),
    issueLock = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const requested = new URLSearchParams(window.location.search).get("mode");
    if (requested === "invite" || requested === "reset") {
      authToken.current = takeAuthTokenFragment(
        window.location,
        window.history,
      );
      void fetch("/api/identity/csrf", {
        credentials: "same-origin",
        cache: "no-store",
      })
        .then((response) => {
          if (!response.ok) throw Error("unavailable");
          setMode(requested);
        })
        .catch(() => setStatus(activationLinkError));
      return;
    }
    const epoch = sessionEpoch.current;
    void sessionInfo()
      .then(async (current) => {
        if (current.role !== "practitioner") return;
        const list = await staff<Receipt[]>("/api/intake/staff");
        if (epoch === sessionEpoch.current) {
          setSession(current);
          setItems(list);
        }
      })
      .catch(() => undefined);
  }, [activationLinkError]);
  async function login(form: FormData) {
    if (pending) return;
    setPending(true);
    const epoch = ++sessionEpoch.current;
    try {
      await publicAuthAction("login", {
        email: form.get("email"),
        password: form.get("password"),
      });
      const current = await sessionInfo();
      if (current.role !== "practitioner") throw Error("forbidden");
      const list = await staff<Receipt[]>("/api/intake/staff");
      if (epoch === sessionEpoch.current) {
        setSession(current);
        setItems(list);
        setStatus("");
      }
    } catch {
      if (epoch === sessionEpoch.current)
        setStatus(t.errors.login);
    } finally {
      setPending(false);
    }
  }
  async function activate(form: FormData) {
    const password = String(form.get("password") ?? "");
    if (
      pending ||
      !authToken.current ||
      password.length < 15 ||
      password !== form.get("confirmation")
    ) {
      setStatus(t.errors.password);
      return;
    }
    setPending(true);
    try {
      await publicAuthAction(
        mode === "invite" ? "invites/accept" : "reset/complete",
        { token: authToken.current, password },
      );
      authToken.current = null;
      setMode("login");
      setStatus(english ? "Action complete. You can sign in with the new password." : "הפעולה הושלמה. אפשר להיכנס עם הסיסמה החדשה.");
    } catch {
      setStatus(t.errors.activation);
    } finally {
      setPending(false);
    }
  }
  async function open(receiptId: string) {
    const sequence = ++requestSequence.current,
      epoch = sessionEpoch.current;
    setSelection(null);
    setEditing(false);
    try {
      const entries = await staff<Entry[]>(
        "/api/intake/staff?receiptId=" + encodeURIComponent(receiptId),
      );
      if (
        sequence === requestSequence.current &&
        epoch === sessionEpoch.current
      )
        setSelection({ receiptId, entries });
    } catch {
      if (
        sequence === requestSequence.current &&
        epoch === sessionEpoch.current
      )
        setStatus(t.errors.open);
    }
  }
  async function refresh() {
    const epoch = sessionEpoch.current;
    try {
      const list = await staff<Receipt[]>("/api/intake/staff");
      if (epoch === sessionEpoch.current) setItems(list);
    } catch {
      if (epoch === sessionEpoch.current) setStatus(t.errors.refresh);
    }
  }
  async function logout() {
    ++sessionEpoch.current;
    ++requestSequence.current;
    issueLock.current = false;
    setSession(null);
    setItems([]);
    setSelection(null);
    setEditing(false);
    setIssuedLink(null);
    setIssueState("idle");
    try {
      await accountAction("logout", "POST", {});
      setStatus(t.errors.loggedOut);
    } catch {
      setStatus(
        t.errors.logoutFailed,
      );
    }
  }
  async function amend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selection || pending) return;
    const boundSelection = selection,
      latest = boundSelection.entries.at(-1),
      epoch = sessionEpoch.current;
    if (!latest) return;
    const form = new FormData(event.currentTarget),
      chosenDays = form.getAll("days"),
      chosenWindows = form.getAll("windows");
    if (!chosenDays.length || !chosenWindows.length) {
      setStatus(t.errors.days);
      return;
    }
    const payload = {
      ...latest.input,
      locationPreference: String(form.get("locationPreference") ?? ""),
      arrivalNeeds: String(form.get("arrivalNeeds") ?? ""),
      availableDays: chosenDays,
      timeWindows: chosenWindows,
      availabilityNote: String(form.get("availabilityNote") ?? ""),
    };
    setPending(true);
    try {
      const current = await sessionInfo();
      await staff("/api/intake/staff", {
        method: "PATCH",
        headers: { "X-CSRF-Token": current.csrfToken },
        body: JSON.stringify({ receiptId: boundSelection.receiptId, payload }),
      });
      const entries = await staff<Entry[]>(
        "/api/intake/staff?receiptId=" +
          encodeURIComponent(boundSelection.receiptId),
      );
      if (epoch === sessionEpoch.current) {
        setSelection({ receiptId: boundSelection.receiptId, entries });
        setEditing(false);
        setStatus(t.errors.amendmentSuccess);
        await refresh();
      }
    } catch {
      if (epoch === sessionEpoch.current)
        setStatus(
          t.errors.amendment,
        );
    } finally {
      setPending(false);
    }
  }
  async function issueInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (issueState !== "idle" || issueLock.current) return;
    const form = new FormData(event.currentTarget),
      stableLeadRef = String(form.get("stableLeadRef") ?? ""),
      childCount = Number(form.get("childCount"));
    if (
      !/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]+$/.test(stableLeadRef) ||
      !Number.isInteger(childCount) ||
      childCount < 1 ||
      childCount > 8
    ) {
      setStatus(t.errors.issueInput);
      return;
    }
    const epoch = sessionEpoch.current;
    issueLock.current = true;
    setIssueState("issuing");
    setStatus("");
    try {
      const current = await sessionInfo();
      if (current.role !== "practitioner") throw Error("forbidden");
      if (epoch !== sessionEpoch.current) return;
      const issued = await staff<{ token: string; expiresAt: string }>(
        "/api/intake/staff",
        {
          method: "POST",
          headers: { "X-CSRF-Token": current.csrfToken },
          body: JSON.stringify({ stableLeadRef, childCount }),
        },
      );
      const href = respondentLink(respondentOrigin, issued.token, locale);
      if (!href) throw Error("unavailable");
      if (epoch !== sessionEpoch.current) return;
      setIssuedLink({
        href,
        expiresAt: issued.expiresAt,
      });
      setIssueState("issued");
      setStatus(
        t.errors.issueSuccess,
      );
    } catch {
      if (epoch !== sessionEpoch.current) return;
      setIssueState("uncertain");
      setStatus(
        t.errors.issueUnknown,
      );
    }
  }
  async function copyIssuedLink() {
    if (!issuedLink) return;
    try {
      await navigator.clipboard.writeText(issuedLink.href);
      setStatus(t.errors.copied);
    } catch {
      setStatus(
        t.errors.copyFailed,
      );
    }
  }
  if (mode !== "login")
    return (
      <form className={styles.card} dir={t.direction} action={(form) => void activate(form)}>
        <h1>{mode === "invite" ? t.activation : t.reset}</h1>
        <label>
          {t.newPassword}
          <input
            name="password"
            type="password"
            minLength={15}
            required
            autoComplete="new-password"
          />
        </label>
        <label>
          {t.confirmPassword}
          <input
            name="confirmation"
            type="password"
            minLength={15}
            required
            autoComplete="new-password"
          />
        </label>
        <button disabled={pending} type="submit">
          {t.save}
        </button>
        <p role="alert">{status}</p>
      </form>
    );
  if (!session)
    return (
      <form className={styles.card} dir={t.direction} action={(form) => void login(form)}>
        <h1>{t.loginTitle}</h1>
        <nav aria-label={t.language}><Link href="/he/intake/staff">{t.hebrew}</Link> · <Link href="/en/intake/staff">{t.english}</Link></nav>
        <p>{t.loginHelp}</p>
        <label>
          {t.email}
          <input name="email" type="email" required autoComplete="username" />
        </label>
        <label>
          {t.password}
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </label>
        <button disabled={pending} type="submit">
          {t.signIn}
        </button>
        <p role="alert">{status}</p>
      </form>
    );
  const latest = selection?.entries.at(-1)?.input;
  return (
    <main className={styles.shell} dir={t.direction}>
      <header>
        <h1>{t.privateIntake}</h1>
        <button disabled={pending} type="button" onClick={() => void logout()}>
          {t.signOut}
        </button>
        <p>{t.manualOnly}</p>
        <nav aria-label={t.language}><Link href="/he/intake/staff">{t.hebrew}</Link> · <Link href="/en/intake/staff">{t.english}</Link> · <a href={`https://bneineviimacademy.org/life-skills/?lang=${locale}`} rel="noreferrer">{t.backToPublic}</a></nav>
      </header>
      <section className={styles.card}>
        <h2>{t.issueTitle}</h2>
        <p>
          {t.issueHelp}
        </p>
        <form onSubmit={(event) => void issueInvitation(event)}>
          <fieldset disabled={issueState !== "idle"}>
            <label>
              {t.stableRef}
              <input
                name="stableLeadRef"
                required
                pattern="LS-(LEAD|WAPI)-[A-Za-z0-9_-]+"
                maxLength={160}
                autoComplete="off"
              />
            </label>
            <label>
              {t.childCount}
              <select name="childCount" defaultValue="1">
                {Array.from({ length: 8 }, (_, index) => (
                  <option key={index + 1} value={index + 1}>
                    {index + 1}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">
              {issueState === "issuing" ? t.issuing : t.issueLink}
            </button>
          </fieldset>
        </form>
      {issuedLink && (
        <div className={styles.issued}>
            <p>
              {t.linkExpiry}: {formatDate(issuedLink.expiresAt, true)}
            </p>
          <button type="button" onClick={() => void copyIssuedLink()}>
            {t.copyLink}
          </button>
          <label>{t.privateLink}<input value={issuedLink.href} readOnly aria-label={t.privateLink} /></label>
          <a href={issuedLink.href} target="_blank" rel="noreferrer">
              {t.openForm}
            </a>
          </div>
        )}
        {issueState === "uncertain" && (
          <p role="alert">{t.uncertainIssue}</p>
        )}
      </section>
      <section className={styles.card}>
        <h2>{t.received}</h2>
        <button type="button" disabled={pending} onClick={() => void refresh()}>
          {t.refresh}
        </button>
        {items.length ? (
          <ul>
            {items.map((item) => (
              <li key={item.receiptId}>
                <button
                  disabled={pending}
                  onClick={() => void open(item.receiptId)}
                  type="button"
                >
                  {t.open} · {formatDate(item.receivedAt)} · {item.amendmentCount} {t.updates}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t.noItems}</p>
        )}
      </section>
      {selection?.entries.map((entry) => (
        <HistoryEntry key={entry.entryId} entry={entry} locale={locale} />
      ))}
      {latest && !editing && (
        <button type="button" onClick={() => setEditing(true)}>
          {t.amendButton}
        </button>
      )}
      {latest && editing && (
        <form
          key={selection!.receiptId}
          className={styles.card}
          onSubmit={(event) => void amend(event)}
        >
          <h2>{t.amendTitle}</h2>
          <fieldset disabled={pending}>
            <legend>{t.consentImmutable}</legend>
            <label>
              {t.preferredLocation}
              <input
                name="locationPreference"
                required
                maxLength={500}
                defaultValue={latest.locationPreference}
              />
            </label>
            <label>
              {t.parking}
              <textarea
                name="arrivalNeeds"
                maxLength={500}
                defaultValue={latest.arrivalNeeds}
              />
            </label>
            <p>{t.convenientDays} — {t.timezone}</p>
            {newAmendmentDays.map((value) => (
              <label key={value}>
                <input
                  type="checkbox"
                  name="days"
                  value={value}
                  defaultChecked={latest.availableDays.includes(value)}
                />
                {t.days[value]}
              </label>
            ))}
            <p>{t.timeWindows}</p>
            {windowKeys.map((value) => (
              <label key={value}>
                <input
                  type="checkbox"
                  name="windows"
                  value={value}
                  defaultChecked={latest.timeWindows.includes(value)}
                />
                {t.windows[value]}
              </label>
            ))}
            <label>
              {t.availabilityNote}
              <textarea
                name="availabilityNote"
                maxLength={1000}
                defaultValue={latest.availabilityNote}
              />
            </label>
          </fieldset>
          <button disabled={pending} type="submit">
            {t.saveAmendment}
          </button>
          <button
            disabled={pending}
            type="button"
            onClick={() => setEditing(false)}
          >
            {t.cancel}
          </button>
        </form>
      )}
      <p role="status">{status}</p>
    </main>
  );
}
function HistoryEntry({ entry, locale }: { entry: Entry; locale: StaffLocale }) {
  const t = staffCopy(locale);
  const input = entry.input;
  return (
    <section className={styles.card}>
      <h2>
        {entry.kind === "original" ? t.original : t.amendment}
      </h2>
      <p>
        {new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "he-IL", { timeZone: t.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.createdAt))} · {t.timezone}
      </p>
      <p>
        {t.parent}: {input.parentName} · {input.contactNumber} · {input.email || t.noEmail} · {input.preferredLanguage === "en" ? t.english : t.hebrew}
      </p>
      <p>
        {t.children}: {" "}
        {input.children
          .map((child) => child.firstName + " (" + child.age + ")")
          .join(", ")}
      </p>
      <p>{t.location}: {input.locationPreference}</p>
      <p>{t.arrival}: {input.arrivalNeeds || t.notSpecified}</p>
      <p>
        {t.availability}: {" "}
        {input.availableDays
          .map((value) => t.days[value as keyof typeof t.days])
          .join(", ")}{" "}
        ·{" "}
        {input.timeWindows
          .map((value) => t.windows[value as keyof typeof t.windows])
          .join(", ")}
      </p>
      <p>{input.availabilityNote}</p>
      <p>{t.privateContext}: {input.privateContext || t.notSpecified}</p>
      <p>
        {t.additionalParent}: {input.cp01} · {t.contactOption}: {input.willingToBeContacted} · {t.accessNeed}: {input.accessSupportNeeded}
      </p>
      {entry.consent && (
        <details>
          <summary>
            {t.consent}: {input.signerName} · {t.version} {entry.consent.version}
          </summary>
          {entry.consent.displayText.map((text) => (
            <p key={text}>{text}</p>
          ))}
          {entry.consent.acknowledgements.map((text, index) => (
            <p key={text}>
              {input.consentAcknowledgements[index] ? t.approved : t.notApproved} —{" "}
              {text}
            </p>
          ))}
          <p>{entry.consent.hash}</p>
        </details>
      )}
      <p>
        {t.nextStep}
      </p>
    </section>
  );
}
