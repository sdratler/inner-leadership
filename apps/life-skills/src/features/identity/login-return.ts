import type { Locale } from "../../lib/locale.ts";

type Role = "practitioner" | "parent" | "adult_client" | "child";

/** A login return is a same-locale, same-role app path, never an arbitrary URL. */
export function loginReturnDestination(locale: Locale, role: Role, requested: string | null): string | null {
  const root = role === "practitioner" ? `/${locale}/app`
    : role === "parent" ? `/${locale}/family`
    : role === "adult_client" || role === "child" ? `/${locale}/client` : null;
  if (!root || !requested || requested.length > 2048 || !requested.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(requested)) return root;
  try {
    const url = new URL(requested, "https://life-skills.invalid");
    if (url.origin !== "https://life-skills.invalid" || url.hash || (url.pathname !== root && !url.pathname.startsWith(`${root}/`))) return root;
    return url.pathname + url.search;
  } catch { return root; }
}

export function practitionerReturnPath(locale: Locale, page: "calendar" | "clients", query: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  const one = (key: string) => typeof query[key] === "string" ? query[key] as string : "";
  if (page === "calendar") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(one("date"))) params.set("date", one("date"));
    if (["day", "week", "month", "agenda"].includes(one("view"))) params.set("view", one("view"));
    if (/^[0-9a-f-]{36}$/i.test(one("caseId"))) params.set("caseId", one("caseId"));
    if (one("context") === "client") params.set("context", "client");
  } else {
    if (["all", "prospects", "paid", "active", "archived"].includes(one("section"))) params.set("section", one("section"));
    if (["all", "today", "new", "intake", "payment", "booking", "archived"].includes(one("filter"))) params.set("filter", one("filter"));
  }
  const suffix = params.toString();
  return `/${locale}/app/${page}${suffix ? `?${suffix}` : ""}`;
}

export function loginHref(locale: Locale, returnPath: string): string {
  return `/${locale}/login?next=${encodeURIComponent(returnPath)}`;
}
