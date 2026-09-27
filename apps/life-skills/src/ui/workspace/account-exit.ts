import type { Locale } from "../../lib/locale.ts";

/** The shared account menu signs every role out to the ordinary app login. */
export function accountExitDestination(locale: Locale): string {
 return `/${locale}/login`;
}
