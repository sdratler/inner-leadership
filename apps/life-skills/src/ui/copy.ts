import messages from "./copy.json";
import type { Locale } from "../lib/locale.ts";
export function copy(locale: Locale) { return messages[locale]; }
export type Copy = ReturnType<typeof copy>;
