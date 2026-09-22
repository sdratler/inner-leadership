/** The invitation credential belongs only in the browser fragment. */
export function respondentLink(origin: string, token: string, locale: "he" | "en" = "he"): string | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return new URL(`/${locale}/intake`, origin).toString() + "#" + token;
}
