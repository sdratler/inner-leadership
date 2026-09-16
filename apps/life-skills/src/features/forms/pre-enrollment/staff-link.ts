/** The invitation credential belongs only in the browser fragment. */
export function respondentLink(origin: string, token: string): string | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return new URL("/he/intake", origin).toString() + "#" + token;
}
