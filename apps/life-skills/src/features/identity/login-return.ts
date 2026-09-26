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

/** Preserve known parent destinations without forwarding arbitrary query text into login. */
export function parentReturnPath(locale: Locale, pathname: string, query: Record<string, string | undefined>): string {
  const root = `/${locale}/family`;
  const suffix = pathname.startsWith(`${root}/`) ? pathname.slice(root.length) : pathname === root ? "" : null;
  const allowed = new Set(["", "/schedule", "/practice", "/feedback", "/forms", "/resources", "/reports", "/settings", "/settings/account", "/settings/coordination", "/settings/credits", "/settings/notifications"]);
  if (suffix === null || !allowed.has(suffix)) return root;
  const params = new URLSearchParams();
  const uuid = (key: string) => { if (/^[0-9a-f-]{36}$/i.test(query[key] ?? "")) params.set(key, query[key]!); };
  if (["", "/schedule", "/practice", "/feedback", "/forms", "/resources", "/reports"].includes(suffix)) uuid("caseId");
  if (suffix === "/schedule") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(query.date ?? "")) params.set("date", query.date!);
    if (["day", "week", "month", "agenda"].includes(query.view ?? "")) params.set("view", query.view!);
  }
  if (["/practice", "/feedback", "/reports"].includes(suffix)) uuid("audienceId");
  if (suffix === "/practice") uuid("assignmentId");
  if (suffix === "/feedback") uuid("practiceVersionId");
  const search = params.toString();
  return root + suffix + (search ? `?${search}` : "");
}

export function loginHref(locale: Locale, returnPath: string): string {
  return `/${locale}/login?next=${encodeURIComponent(returnPath)}`;
}
