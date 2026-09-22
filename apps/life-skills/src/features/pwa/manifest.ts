import type { Locale, Role } from "../session-workflow/types.ts";
/** Wire into the existing authenticated app manifest response after client/child routes are implemented. */
export function privateAppManifest(locale: Locale, role: Role) {
    const start = role === "practitioner" ? "app/calendar" : role === "parent" ? "family" : "client";
    return { id: "/life-skills", name: locale === "he" ? "כישורי חיים" : "Life Skills", short_name: locale === "he" ? "כישורי חיים" : "Life Skills", lang: locale, dir: locale === "he" ? "rtl" : "ltr", start_url: `/${locale}/${start}`, scope: "/", display: "standalone", background_color: "#ffffff", theme_color: "#245159", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png" }] };
}
/** Notification copy is deliberately independent of provider payload content. */
export function genericNotification(locale: Locale) { return { title: locale === "he" ? "כישורי חיים" : "Life Skills", body: locale === "he" ? "יש עדכון באפליקציה. יש להיכנס כדי לצפות בו." : "There is an update in the app. Sign in to view it." }; }
