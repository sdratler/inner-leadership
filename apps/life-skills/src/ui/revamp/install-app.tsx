"use client";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../../features/session-workflow/types.ts";
import { word } from "./primitives.tsx";
export type InstallEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{
        outcome: "accepted" | "dismissed";
    }>;
};
export async function requestAppInstallation(event: Pick<InstallEvent,"prompt"|"userChoice">): Promise<"accepted" | "dismissed"> {
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome !== "accepted" && choice.outcome !== "dismissed")
        throw new Error("INSTALL_RESULT_UNVERIFIED");
    return choice.outcome;
}
export function InstallApp({ locale }: {
    locale: Locale;
}) {
    const [event, setEvent] = useState<InstallEvent | null>(null), [installed, setInstalled] = useState(false), [help, setHelp] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState<"accepted" | "dismissed" | "error" | null>(null);
    const active = useRef(false), prompting = useRef(false);
    useEffect(() => {
        active.current = true;
        const before = (e: Event) => { const candidate = e as InstallEvent; if (typeof candidate.prompt !== "function" || typeof candidate.userChoice?.then !== "function") return; e.preventDefault(); setEvent(candidate); };
        const onInstalled = () => { setInstalled(true); setEvent(null); setNotice(null); setHelp(false); };
        const timer = setTimeout(() => setInstalled(window.matchMedia('(display-mode: standalone)').matches), 0);
        window.addEventListener('beforeinstallprompt', before); window.addEventListener('appinstalled', onInstalled);
        return () => { active.current = false; clearTimeout(timer); window.removeEventListener('beforeinstallprompt', before); window.removeEventListener('appinstalled', onInstalled); };
    }, []);
    if (installed)
        return <p role="status">{word(locale, "This browser reports Life Skills as installed on this device.", "הדפדפן מדווח שכישורי חיים מותקנת במכשיר הזה.")}</p>;
    async function install() {
        if (prompting.current) return;
        setNotice(null);
        if (!event) { setHelp(true); return; }
        prompting.current = true; setBusy(true); setEvent(null);
        try { const outcome = await requestAppInstallation(event); if (active.current) { setNotice(outcome); setHelp(true); } }
        catch { if (active.current) { setNotice("error"); setHelp(true); } }
        finally { prompting.current = false; if (active.current) setBusy(false); }
    }
    return <div><button type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => void install()}>{busy ? word(locale, "Waiting for the browser…", "ממתינים לדפדפן…") : word(locale, "Install Life Skills", "התקנת כישורי חיים")}</button>
        {notice && <p role={notice === "error" ? "alert" : "status"}>{notice === "accepted" ? word(locale, "The installation request was accepted. Installation is not yet confirmed; check your device's app list.", "בקשת ההתקנה התקבלה. ההתקנה עדיין לא אומתה; יש לבדוק ברשימת האפליקציות במכשיר.") : notice === "dismissed" ? word(locale, "Installation was dismissed. You can keep using the secure app in this browser.", "ההתקנה בוטלה. אפשר להמשיך להשתמש באפליקציה המאובטחת בדפדפן הזה.") : word(locale, "The browser installation request failed. Nothing is confirmed. Try your browser's Install app action, or reload this page for a fresh request.", "בקשת ההתקנה בדפדפן נכשלה. לא ניתן לאשר התקנה. אפשר להשתמש בפעולת התקנת אפליקציה בדפדפן, או לטעון מחדש לקבלת בקשה חדשה.")}</p>}
        {help && <p>{word(locale, "On iPhone: open the secure app in Safari, choose Share, then Add to Home Screen. On Android: use your browser's Install app or Add to Home Screen action. Notifications require your separate permission.", "באייפון: פותחים את האפליקציה המאובטחת ב-Safari, בוחרים שיתוף ואז הוספה למסך הבית. באנדרואיד: בוחרים התקנת אפליקציה או הוספה למסך הבית בתפריט הדפדפן. התראות דורשות הרשאה נפרדת.")}</p>}</div>;
}
