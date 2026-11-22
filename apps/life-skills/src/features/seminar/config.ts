export const seminar = Object.freeze({
  academy: "Jewish Leadership Fishing Academy",
  title: "Bass Fishing Seminar",
  hook: "How to Get a Bite on Every Cast",
  audience: "For boys ages 8–15",
  date: "2026-11-22",
  startsAt: "2026-11-22T14:30:00-05:00",
  dateLabel: "Sunday, November 22, 2026",
  dateShort: "November 22, 2026",
  shareDate: "Sunday, November 22 at 2:30 PM",
  timeLabel: "2:30 PM · Eastern Time",
  timeZone: "America/New_York",
  place: "Sierra Lake, Boca Raton",
  reminder: "Bring your fishing tackle.",
  host: "Rabbi Shlomo Dratler",
  phone: "305-427-8909",
  phoneDigits: "13054278909",
  publicUrl: "https://bneineviimacademy.org/fish",
  flyer: "/seminar/bass-fishing-seminar-20261122.jpg",
  qrPng: "/seminar/seminar-page-qr.png",
  qrSvg: "/seminar/seminar-page-qr.svg",
  logo: "/groups/brand/jlfa-logo-locked-v1.png",
  directions: "https://www.google.com/maps/dir/?api=1&destination=26.3539417,-80.162461",
});
export function seminarHasPassed(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: seminar.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}` > seminar.date;
}
export function seminarInvitation(past = false): string {
  return past
    ? `Interested in the next Bass Fishing Seminar with Rabbi Shlomo? Ask for details: ${seminar.publicUrl}`
    : `Join ${seminar.host} for ${seminar.title}! ${seminar.audience}. ${seminar.shareDate}, ${seminar.place}. ${seminar.reminder} Details and directions: ${seminar.publicUrl}`;
}
export const seminarDescription = "Nov 22 · 2:30 PM · Sierra Lake, Boca Raton. Boys ages 8–15 with Rabbi Shlomo.";
export function contactUrl(past = false): string {
  const text = past ? "Hi Rabbi Shlomo, please send me details about the next Bass Fishing Seminar." : "Hi Rabbi Shlomo, I saw the Bass Fishing Seminar flyer. Please send me the details.";
  return `https://wa.me/${seminar.phoneDigits}?text=${encodeURIComponent(text)}`;
}
export function seminarPublicPath(path: string, method: string): boolean {
  return ["GET", "HEAD"].includes(method) && ["/fish", "/fish/", "/en/florida/seminar", "/en/florida/seminar/", seminar.flyer, seminar.qrPng, seminar.qrSvg].includes(path);
}
