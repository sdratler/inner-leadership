"use client";
import { useEffect, useState } from "react";
import type { Locale } from "../../features/session-workflow/types.ts";
import { word } from "./primitives.tsx";
type InstallEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{
        outcome: "accepted" | "dismissed";
    }>;
};
export function InstallApp({ locale }: {
    locale: Locale;
}) {
    const [event, setEvent] = useState<InstallEvent | null>(null), [installed, setInstalled] = useState(false), [help, setHelp] = useState(false);
    useEffect(() => { const before = (e: Event) => { e.preventDefault(); setEvent(e as InstallEvent); }; const onInstalled = () => { setInstalled(true); setEvent(null); }; const timer = setTimeout(() => setInstalled(window.matchMedia('(display-mode: standalone)').matches), 0); window.addEventListener('beforeinstallprompt', before); window.addEventListener('appinstalled', onInstalled); return () => { clearTimeout(timer); window.removeEventListener('beforeinstallprompt', before); window.removeEventListener('appinstalled', onInstalled); }; }, []);
    if (installed)
        return <p>{word(locale, "Life Skills is installed on this device.", "כישורי חיים מותקנת במכשיר הזה.")}</p>;
    return <div><button type="button" onClick={async () => {
            if (event) {
                await event.prompt();
                await event.userChoice;
                setEvent(null);
            }
            else
                setHelp(true);
        }}>{word(locale, "Install Life Skills", "התקנת כישורי חיים")}</button>{help && <p>{word(locale, "On iPhone: open the secure app in Safari, choose Share, then Add to Home Screen. On Android: use your browser's Install app or Add to Home Screen action. Notifications require your separate permission.", "באייפון: פותחים את האפליקציה המאובטחת ב-Safari, בוחרים שיתוף ואז הוספה למסך הבית. באנדרואיד: בוחרים התקנת אפליקציה או הוספה למסך הבית בתפריט הדפדפן. התראות דורשות הרשאה נפרדת.")}</p>}</div>;
}
