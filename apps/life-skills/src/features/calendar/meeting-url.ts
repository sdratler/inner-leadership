/** Display only an already-authorized provider result. This function does not grant access. */
export function verifiedGoogleMeetUrl(value: string | null | undefined): string | null {
 if (!value) return null;
 try {
   const url = new URL(value);
   if (url.protocol !== "https:" || url.hostname !== "meet.google.com" || url.username || url.password || url.port || url.hash || url.search) return null;
   return /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/i.test(url.pathname) ? url.href : null;
 } catch { return null; }
}
