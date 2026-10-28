import type { Locale, Role } from "../session-workflow/types.ts";
/** Wire into the existing authenticated app manifest response after client/child routes are implemented. */
export function privateAppManifest(locale: Locale, role: Role) {
    const start = role === "practitioner" ? "app/calendar" : role === "parent" ? "family/schedule" : "client";
    return { id: "/life-skills", name: locale === "he" ? "האקדמיה לדיג" : "Fishing Academy", short_name: locale === "he" ? "האקדמיה לדיג" : "Fishing Academy", lang: locale, dir: locale === "he" ? "rtl" : "ltr", start_url: `/${locale}/${start}`, scope: "/", display: "standalone", background_color: "#ffffff", theme_color: "#245159", icons: [{ src: "/groups/brand/jlfa-logo-locked-v1.png", sizes: "1254x1254", type: "image/png", purpose: "any" }] };
}
/** Notification copy is deliberately independent of provider payload content. */
export function genericNotification(locale: Locale) { return { title: locale === "he" ? "האקדמיה לדיג" : "Fishing Academy", body: locale === "he" ? "יש עדכון באפליקציה. יש להיכנס כדי לצפות בו." : "There is an update in the app. Sign in to view it." }; }
