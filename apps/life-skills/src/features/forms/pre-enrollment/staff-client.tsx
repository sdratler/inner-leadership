"use client";

import { useState } from "react";
import { IdentityClientError, publicAuthAction, sessionInfo } from "@/features/identity/client.ts";
import styles from "./staff-client.module.css";

type Session = { role: "practitioner" | "parent" | "adult_client"; csrfToken: string };
type Receipt = { receiptId: string; receivedAt: string; stableLeadRef?: string };
type History = { parentName: string; contactNumber: string; children: { firstName: string; age: number }[]; locationPreference: string; arrivalNeeds: string; availableDays: string[]; timeWindows: string[]; availabilityNote: string; consentVersion: string };
const message = (error: unknown) => error instanceof IdentityClientError && error.code === "FORBIDDEN" ? "גישה זו מיועדת למלווה מורשה בלבד." : "לא ניתן להשלים את הפעולה כעת.";
async function staff<T>(path: string, init: RequestInit = {}): Promise<T> { const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", ...init.headers } }); const body = await response.json() as { ok?: boolean; data?: T }; if (!response.ok || !body.ok || !body.data) throw new Error("staff"); return body.data; }

export function IntakeStaffClient() {
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<Receipt[]>([]);
  const [selected, setSelected] = useState<History | null>(null);
  const [status, setStatus] = useState("");
  async function login(form: FormData) { try { await publicAuthAction("login", { email: form.get("email"), password: form.get("password") }); const current = await sessionInfo(); if (current.role !== "practitioner") { setStatus("גישה זו מיועדת למלווה מורשה בלבד."); return; } setSession(current); const list = await staff<Receipt[]>("/api/intake/staff"); setItems(list); } catch (error) { setStatus(message(error)); } }
  async function open(receiptId: string) { try { setSelected(await staff<History>(`/api/intake/staff?receiptId=${encodeURIComponent(receiptId)}`)); } catch { setStatus("לא ניתן לפתוח את הפנייה כעת."); } }
  if (!session) return <form className={styles.card} action={form => void login(form)}><h1>פניות פרטיות</h1><p>כניסה למלווה מורשה בלבד.</p><label>דוא״ל<input name="email" type="email" required autoComplete="username" /></label><label>סיסמה<input name="password" type="password" required autoComplete="current-password" /></label><button type="submit">כניסה</button><p role="alert">{status}</p></form>;
  return <main className={styles.shell}><header><h1>פניות פרטיות</h1><p>תיאום ידני בלבד. אין כאן קביעת פגישה או אישור תשלום.</p></header><section className={styles.card}><h2>פניות שהתקבלו</h2>{items.length ? <ul>{items.map(item => <li key={item.receiptId}><button onClick={() => void open(item.receiptId)} type="button">פתיחת פנייה מתאריך {new Date(item.receivedAt).toLocaleDateString("he-IL")}</button></li>)}</ul> : <p>אין פניות להצגה.</p>}</section>{selected && <section className={styles.card}><h2>פרטי תיאום</h2><p><b>הורה:</b> {selected.parentName} · {selected.contactNumber}</p><p><b>ילדים:</b> {selected.children.map(child => `${child.firstName} (${child.age})`).join(", ")}</p><p><b>מיקום:</b> {selected.locationPreference}</p><p><b>חניה/נגישות:</b> {selected.arrivalNeeds || "לא צוין"}</p><p><b>זמינות:</b> {selected.availableDays.join(", ")} · {selected.timeWindows.join(", ")}</p><p><b>העדפה:</b> {selected.availabilityNote || "לא צוינה"}</p><p><b>הסכמה:</b> {selected.consentVersion}</p><hr /><p>השלב הבא: צרו קשר בערוץ מאומת, אשרו זמן ומקום, ותעדו את ההחלטה במערכת המתאימה. אין לשלוח פרטים רגישים בערוץ לא מאומת.</p></section>}<p role="status">{status}</p></main>;
}
