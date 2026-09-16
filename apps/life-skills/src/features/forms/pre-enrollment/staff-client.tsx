"use client";
import { useEffect, useRef, useState } from "react";
import {
  accountAction,
  publicAuthAction,
  sessionInfo,
  takeAuthTokenFragment,
} from "@/features/identity/client.ts";
import type { PreEnrollmentInput } from "./schema.ts";
import { respondentLink } from "./staff-link.ts";
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
const days = [
  ["sun", "א׳"],
  ["mon", "ב׳"],
  ["tue", "ג׳"],
  ["wed", "ד׳"],
  ["thu", "ה׳"],
  ["fri", "ו׳"],
  ["sat", "ש׳"],
] as const;
const windows = [
  ["morning", "בוקר"],
  ["afternoon", "צהריים"],
  ["evening", "ערב"],
] as const;
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
export function IntakeStaffClient() {
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
        .catch(() => setStatus("קישור ההפעלה אינו זמין כרגע."));
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
  }, []);
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
        setStatus("לא ניתן להיכנס. נדרש חשבון מלווה מורשה.");
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
      setStatus("נדרש קישור תקף ושתי סיסמאות תואמות בנות 15 תווים לפחות.");
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
      setStatus("הפעולה הושלמה. אפשר להיכנס עם הסיסמה החדשה.");
    } catch {
      setStatus("לא ניתן להשלים את ההפעלה כרגע.");
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
        setStatus("לא ניתן לפתוח את הפנייה כעת.");
    }
  }
  async function refresh() {
    const epoch = sessionEpoch.current;
    try {
      const list = await staff<Receipt[]>("/api/intake/staff");
      if (epoch === sessionEpoch.current) setItems(list);
    } catch {
      if (epoch === sessionEpoch.current) setStatus("לא ניתן לרענן כרגע.");
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
      setStatus("נותקת.");
    } catch {
      setStatus(
        "המידע הוסר מהמסך, אך לא ניתן לאשר יציאה מהשרת. סגרו את החלון.",
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
      setStatus("יש לבחור לפחות יום וחלון זמן.");
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
        setStatus("נוסף תיקון מיוחס. הפנייה המקורית וההסכמה נשמרו ללא שינוי.");
        await refresh();
      }
    } catch {
      if (epoch === sessionEpoch.current)
        setStatus(
          "לא ניתן לאשר שמירת תיקון. רעננו את ההיסטוריה לפני ניסיון נוסף.",
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
      setStatus("נדרש מזהה פנייה תקין ומספר ילדים בין 1 ל־8.");
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
      const href = respondentLink(window.location.origin, issued.token);
      if (!href) throw Error("unavailable");
      if (epoch !== sessionEpoch.current) return;
      setIssuedLink({
        href,
        expiresAt: issued.expiresAt,
      });
      setIssueState("issued");
      setStatus(
        "נוצר קישור פרטי. העתיקו או פתחו אותו לפני שיתוף ידני בערוץ מאומת.",
      );
    } catch {
      if (epoch !== sessionEpoch.current) return;
      setIssueState("uncertain");
      setStatus(
        "לא ניתן לאשר אם הקישור נוצר. אין לנסות שוב מאותו מסך; רעננו ובדקו את מצב ההנפקות מול הרשומה הפרטית.",
      );
    }
  }
  async function copyIssuedLink() {
    if (!issuedLink) return;
    try {
      await navigator.clipboard.writeText(issuedLink.href);
      setStatus("הקישור הועתק. הוא לא נשמר בדפדפן לאחר סגירת או רענון הדף.");
    } catch {
      setStatus(
        "לא ניתן להעתיק אוטומטית. אפשר לפתוח את הקישור ולשתף אותו ידנית בערוץ מאומת.",
      );
    }
  }
  if (mode !== "login")
    return (
      <form className={styles.card} action={(form) => void activate(form)}>
        <h1>{mode === "invite" ? "הפעלת חשבון" : "איפוס סיסמה"}</h1>
        <label>
          סיסמה חדשה
          <input
            name="password"
            type="password"
            minLength={15}
            required
            autoComplete="new-password"
          />
        </label>
        <label>
          אימות סיסמה
          <input
            name="confirmation"
            type="password"
            minLength={15}
            required
            autoComplete="new-password"
          />
        </label>
        <button disabled={pending} type="submit">
          שמירה
        </button>
        <p role="alert">{status}</p>
      </form>
    );
  if (!session)
    return (
      <form className={styles.card} action={(form) => void login(form)}>
        <h1>פניות פרטיות — כישורי חיים</h1>
        <p>כניסה למלווה מורשה בלבד.</p>
        <label>
          דוא״ל
          <input name="email" type="email" required autoComplete="username" />
        </label>
        <label>
          סיסמה
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </label>
        <button disabled={pending} type="submit">
          כניסה
        </button>
        <p role="alert">{status}</p>
      </form>
    );
  const latest = selection?.entries.at(-1)?.input;
  return (
    <main className={styles.shell}>
      <header>
        <h1>פניות פרטיות</h1>
        <button disabled={pending} type="button" onClick={() => void logout()}>
          יציאה
        </button>
        <p>תיאום ידני בלבד. אין כאן קביעת פגישה או אישור תשלום.</p>
      </header>
      <section className={styles.card}>
        <h2>הנפקת קישור פרטי</h2>
        <p>
          למלווה מורשה בלבד. הפעולה אינה שולחת הודעה, אינה יוצרת חשבון הורה
          ואינה קובעת פגישה.
        </p>
        <form onSubmit={(event) => void issueInvitation(event)}>
          <fieldset disabled={issueState !== "idle"}>
            <label>
              מזהה פנייה יציב
              <input
                name="stableLeadRef"
                required
                pattern="LS-(LEAD|WAPI)-[A-Za-z0-9_-]+"
                maxLength={160}
                autoComplete="off"
              />
            </label>
            <label>
              מספר ילדים
              <select name="childCount" defaultValue="1">
                {Array.from({ length: 8 }, (_, index) => (
                  <option key={index + 1} value={index + 1}>
                    {index + 1}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">
              {issueState === "issuing" ? "מנפיקים…" : "הנפקת קישור"}
            </button>
          </fieldset>
        </form>
      {issuedLink && (
        <div className={styles.issued}>
            <p>
              תוקף הקישור:{" "}
              {new Date(issuedLink.expiresAt).toLocaleString("he-IL", {
                timeZone: "Asia/Jerusalem",
              })}
            </p>
          <button type="button" onClick={() => void copyIssuedLink()}>
            העתקת קישור
          </button>
          <label>קישור פרטי להעתקה ידנית<input value={issuedLink.href} readOnly aria-label="קישור פרטי להעתקה ידנית" /></label>
          <a href={issuedLink.href} target="_blank" rel="noreferrer">
              פתיחת הטופס
            </a>
          </div>
        )}
        {issueState === "uncertain" && (
          <p role="alert">הנפקה במצב לא ודאי; אין לחזור עליה כאן.</p>
        )}
      </section>
      <section className={styles.card}>
        <h2>פניות שהתקבלו</h2>
        <button type="button" disabled={pending} onClick={() => void refresh()}>
          רענון
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
                  פתיחה ·{" "}
                  {new Date(item.receivedAt).toLocaleDateString("he-IL")} ·{" "}
                  {item.amendmentCount} עדכונים
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>אין פניות להצגה.</p>
        )}
      </section>
      {selection?.entries.map((entry) => (
        <HistoryEntry key={entry.entryId} entry={entry} />
      ))}
      {latest && !editing && (
        <button type="button" onClick={() => setEditing(true)}>
          תיקון פרטי תיאום תוך שמירת היסטוריה
        </button>
      )}
      {latest && editing && (
        <form
          key={selection!.receiptId}
          className={styles.card}
          onSubmit={(event) => void amend(event)}
        >
          <h2>תיקון פרטי תיאום בלבד</h2>
          <fieldset disabled={pending}>
            <legend>הסכמה וזהות הילד לא משתנות</legend>
            <label>
              מיקום מועדף
              <input
                name="locationPreference"
                required
                maxLength={500}
                defaultValue={latest.locationPreference}
              />
            </label>
            <label>
              חניה ונגישות
              <textarea
                name="arrivalNeeds"
                maxLength={500}
                defaultValue={latest.arrivalNeeds}
              />
            </label>
            <p>ימים נוחים — Asia/Jerusalem</p>
            {days.map(([value, label]) => (
              <label key={value}>
                <input
                  type="checkbox"
                  name="days"
                  value={value}
                  defaultChecked={latest.availableDays.includes(value)}
                />
                {label}
              </label>
            ))}
            <p>חלונות זמן</p>
            {windows.map(([value, label]) => (
              <label key={value}>
                <input
                  type="checkbox"
                  name="windows"
                  value={value}
                  defaultChecked={latest.timeWindows.includes(value)}
                />
                {label}
              </label>
            ))}
            <label>
              הערת זמינות
              <textarea
                name="availabilityNote"
                maxLength={1000}
                defaultValue={latest.availabilityNote}
              />
            </label>
          </fieldset>
          <button disabled={pending} type="submit">
            שמירת תיקון
          </button>
          <button
            disabled={pending}
            type="button"
            onClick={() => setEditing(false)}
          >
            ביטול עריכה
          </button>
        </form>
      )}
      <p role="status">{status}</p>
    </main>
  );
}
function HistoryEntry({ entry }: { entry: Entry }) {
  const input = entry.input;
  return (
    <section className={styles.card}>
      <h2>
        {entry.kind === "original" ? "פנייה מקורית" : "תיקון של מלווה מורשה"}
      </h2>
      <p>
        {new Date(entry.createdAt).toLocaleString("he-IL", {
          timeZone: "Asia/Jerusalem",
        })}{" "}
        · Asia/Jerusalem
      </p>
      <p>
        הורה: {input.parentName} · {input.contactNumber} ·{" "}
        {input.email || "ללא דוא״ל"} · {input.preferredLanguage}
      </p>
      <p>
        ילדים:{" "}
        {input.children
          .map((child) => child.firstName + " (" + child.age + ")")
          .join(", ")}
      </p>
      <p>מיקום: {input.locationPreference}</p>
      <p>חניה/נגישות: {input.arrivalNeeds || "לא צוין"}</p>
      <p>
        זמינות:{" "}
        {input.availableDays
          .map((value) => days.find((day) => day[0] === value)?.[1])
          .join(", ")}{" "}
        ·{" "}
        {input.timeWindows
          .map((value) => windows.find((time) => time[0] === value)?.[1])
          .join(", ")}
      </p>
      <p>{input.availabilityNote}</p>
      <p>הקשר פרטי: {input.privateContext || "לא צוין"}</p>
      <p>
        הורה נוסף: {input.cp01} · אפשרות קשר: {input.willingToBeContacted} ·
        צורך בנגישות: {input.accessSupportNeeded}
      </p>
      {entry.consent && (
        <details>
          <summary>
            אישור הורה: {input.signerName} · גרסה {entry.consent.version}
          </summary>
          {entry.consent.displayText.map((text) => (
            <p key={text}>{text}</p>
          ))}
          {entry.consent.acknowledgements.map((text, index) => (
            <p key={text}>
              {input.consentAcknowledgements[index] ? "אושר" : "לא אושר"} —{" "}
              {text}
            </p>
          ))}
          <p>{entry.consent.hash}</p>
        </details>
      )}
      <p>
        השלב הבא: צרו קשר בערוץ מאומת, אשרו זמן ומקום, ותעדו בנפרד אישור מועד
        ואימות תשלום. אין כאן פגישה מאושרת.
      </p>
    </section>
  );
}
