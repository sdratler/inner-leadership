"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../../lib/locale.ts";
import { publicAuthAction, sessionInfo, takeAuthTokenFragment } from "./client.ts";
import styles from "./login-client.module.css";

type Mode = "login" | "forgot" | "invite" | "reset";
type Role = Awaited<ReturnType<typeof sessionInfo>>["role"];

export function destinationForRole(locale: Locale, role: Role): string | null {
  if (role === "practitioner") return `/${locale}/app`;
  if (role === "parent") return `/${locale}/family`;
  if (role === "adult_client") return `/${locale}/client`;
  return null;
}

const copy = {
  en: {
    title: "Sign in to Life Skills",
    help: "Use the private account that was created or invited for you.",
    email: "Email",
    password: "Password",
    showPassword: "Show password",
    hidePassword: "Hide password",
    signIn: "Sign in",
    forgot: "Forgot password?",
    forgotTitle: "Reset your password",
    forgotHelp: "Enter the email address for your Life Skills account.",
    request: "Send reset email",
    back: "Back to sign in",
    resetAccepted: "If an eligible account exists, a reset email has been sent. The link expires after 15 minutes.",
    activation: "Activate your account",
    reset: "Choose a new password",
    newPassword: "New password — at least 6 characters",
    confirmation: "Confirm new password",
    save: "Save password",
    completed: "Password saved. You can sign in now.",
    invalid: "The details could not be verified. Check them and try again.",
    unavailable: "Sign-in is temporarily unavailable. Try again shortly.",
    token: "This private link is invalid or has expired. Request a new one.",
    unsupported: "This account type is not enabled for independent sign-in.",
    working: "Working…",
  },
  he: {
    title: "כניסה לכישורי חיים",
    help: "יש להשתמש בחשבון הפרטי שנוצר או הוזמן עבורכם.",
    email: "דוא״ל",
    password: "סיסמה",
    showPassword: "הצגת סיסמה",
    hidePassword: "הסתרת סיסמה",
    signIn: "כניסה",
    forgot: "שכחתי סיסמה",
    forgotTitle: "איפוס סיסמה",
    forgotHelp: "הזינו את כתובת הדוא״ל של חשבון כישורי חיים.",
    request: "שליחת הודעת איפוס",
    back: "חזרה לכניסה",
    resetAccepted: "אם קיים חשבון מתאים, נשלחה הודעת איפוס. הקישור תקף ל־15 דקות.",
    activation: "הפעלת החשבון",
    reset: "בחירת סיסמה חדשה",
    newPassword: "סיסמה חדשה — לפחות 6 תווים",
    confirmation: "אימות הסיסמה החדשה",
    save: "שמירת הסיסמה",
    completed: "הסיסמה נשמרה. אפשר להיכנס כעת.",
    invalid: "לא ניתן לאמת את הפרטים. בדקו אותם ונסו שוב.",
    unavailable: "הכניסה אינה זמינה כרגע. נסו שוב בעוד זמן קצר.",
    token: "הקישור הפרטי אינו תקף או שפג תוקפו. יש לבקש קישור חדש.",
    unsupported: "סוג חשבון זה אינו זמין לכניסה עצמאית.",
    working: "מעבד…",
  },
} as const;

export function LoginClient({ locale }: { locale: Locale }) {
  const router = useRouter();
  const query = useSearchParams();
  const requested = query.get("mode");
  const initialMode: Mode = requested === "invite" || requested === "reset" ? requested : "login";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [resetAccepted, setResetAccepted] = useState(false);
  const [tokenReady, setTokenReady] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const token = useRef<string | null>(null);
  const t = copy[locale];

  useEffect(() => {
    if (initialMode === "invite" || initialMode === "reset") {
      token.current = takeAuthTokenFragment(window.location, window.history);
      setTokenReady(Boolean(token.current));
      if (!token.current) setStatus(t.token);
      return;
    }
    void sessionInfo().then(current => {
      const destination = destinationForRole(locale, current.role);
      if (destination) router.replace(destination);
    }).catch(() => undefined);
  }, [initialMode, locale, router, t.token]);

  async function login(form: FormData) {
    if (busy) return;
    setBusy(true); setStatus("");
    try {
      await publicAuthAction("login", { email: form.get("email"), password: form.get("password") });
      const current = await sessionInfo();
      const destination = destinationForRole(locale, current.role);
      if (!destination) { setStatus(t.unsupported); return; }
      router.replace(destination); router.refresh();
    } catch (error) {
      setStatus(error instanceof Error && error.message === "UNAVAILABLE" ? t.unavailable : t.invalid);
    } finally { setBusy(false); }
  }

  async function requestReset(form: FormData) {
    if (busy || resetAccepted) return;
    setBusy(true); setStatus("");
    try {
      await publicAuthAction("reset/request", { email: form.get("email") }, locale);
      setResetAccepted(true); setStatus(t.resetAccepted);
    } catch { setStatus(t.unavailable); }
    finally { setBusy(false); }
  }

  async function complete(form: FormData) {
    const password = String(form.get("password") ?? "");
    if (busy || !token.current || [...password].length < 6 || password !== form.get("confirmation")) {
      setStatus(token.current ? t.invalid : t.token); return;
    }
    setBusy(true); setStatus("");
    try {
      await publicAuthAction(mode === "invite" ? "invites/accept" : "reset/complete", { token: token.current, password });
      token.current = null; setTokenReady(false); setPasswordVisible(false); setMode("login"); setStatus(t.completed);
      window.history.replaceState(null, "", `/${locale}/login`);
    } catch { setStatus(t.token); }
    finally { setBusy(false); }
  }

  const language = locale === "he" ? "en" : "he";
  return <main className={styles.page}>
    <section className={styles.card} aria-labelledby="login-title">
      <header className={styles.brand}>
        {/* Exact approved local brand asset, shared with the authenticated workspace. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/intake-brand/life-skills-logo.png" width={124} height={65} alt={locale === "he" ? "כישורי חיים" : "Life Skills"} />
        <div><strong>{locale === "he" ? "כישורי חיים" : "Life Skills"}</strong><small>{locale === "he" ? "המרחב הפרטי" : "Private app"}</small></div>
      </header>
      {mode === "invite" || mode === "reset" ? <form action={(form) => void complete(form)}>
        <h1 id="login-title">{mode === "invite" ? t.activation : t.reset}</h1>
        <label>{t.newPassword}<input id="new-password" name="password" type={passwordVisible ? "text" : "password"} minLength={6} maxLength={128} required autoComplete="new-password" /></label>
        <label>{t.confirmation}<input id="confirm-password" name="confirmation" type={passwordVisible ? "text" : "password"} minLength={6} maxLength={128} required autoComplete="new-password" /></label>
        <button className={styles.passwordToggle} type="button" aria-controls="new-password confirm-password" aria-pressed={passwordVisible} onClick={() => setPasswordVisible(value => !value)}>{passwordVisible ? t.hidePassword : t.showPassword}</button>
        <button disabled={busy || !tokenReady} type="submit">{busy ? t.working : t.save}</button>
      </form> : mode === "forgot" ? <form action={(form) => void requestReset(form)}>
        <h1 id="login-title">{t.forgotTitle}</h1><p>{t.forgotHelp}</p>
        <label>{t.email}<input name="email" type="email" required autoComplete="username" /></label>
        <button disabled={busy || resetAccepted} type="submit">{busy ? t.working : t.request}</button>
        <button className={styles.secondary} disabled={busy} type="button" onClick={() => { setPasswordVisible(false); setMode("login"); setStatus(""); }}>{t.back}</button>
      </form> : <form action={(form) => void login(form)}>
        <h1 id="login-title">{t.title}</h1><p>{t.help}</p>
        <label>{t.email}<input name="email" type="email" required autoComplete="username" /></label>
        <label>{t.password}<input id="login-password" name="password" type={passwordVisible ? "text" : "password"} required autoComplete="current-password" /></label>
        <button className={styles.passwordToggle} type="button" aria-controls="login-password" aria-pressed={passwordVisible} onClick={() => setPasswordVisible(value => !value)}>{passwordVisible ? t.hidePassword : t.showPassword}</button>
        <button disabled={busy} type="submit">{busy ? t.working : t.signIn}</button>
        <button className={styles.secondary} disabled={busy} type="button" onClick={() => { setPasswordVisible(false); setMode("forgot"); setStatus(""); }}>{t.forgot}</button>
      </form>}
      <p className={styles.status} role="status" aria-live="polite">{status}</p>
      {mode !== "invite" && mode !== "reset" && <Link className={styles.language} href={`/${language}/login`}>{language === "he" ? "עברית" : "English"}</Link>}
    </section>
  </main>;
}
