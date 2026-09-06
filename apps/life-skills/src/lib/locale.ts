export const locales = ["he", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "he";
export function isLocale(value: string): value is Locale { return value === "he" || value === "en"; }
export function direction(locale: Locale): "rtl" | "ltr" { return locale === "he" ? "rtl" : "ltr"; }
export function otherLocale(locale: Locale): Locale { return locale === "he" ? "en" : "he"; }
