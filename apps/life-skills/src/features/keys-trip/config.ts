/** Public presentation only. Prices, private quotes and family records do not belong here. */
export const keysTripPublic = Object.freeze({
  title: "Extreme Saltwater Bridge Fishing",
  description: "Sunday, December 6, 2026. Full-day Florida Keys trip for boys ages 10–17. Early morning departure. Bring your own fishing rods.",
  publicUrl: "https://life-skills.bneineviimacademy.org/en/florida/keys",
  flyer: "/keys/keys-trip-20261206.png",
  logo: "/groups/brand/jlfa-logo-locked-v1.png",
  phone: "305-427-8909",
  phoneDigits: "13054278909",
});

/** Exact paths only; this never admits private records or directory-wide assets. */
export function keysPublicPath(path: string, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return ["/en/florida/keys", "/en/florida/keys/", "/he/florida/keys", "/he/florida/keys/", keysTripPublic.flyer].includes(path);
}

export function keysHasPassed(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}` > "2026-12-06";
}
