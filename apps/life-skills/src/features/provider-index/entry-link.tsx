import "server-only";
import { headers } from "next/headers";
import { providerOwnerContext } from "./server/context.ts";
import { loadCase } from "../cases/data.ts";
import { caseAccess } from "../cases/policy.ts";
import { asId } from "../../lib/ids.ts";
/** Optional entry point; actual page/API authorization is independently enforced. */
export async function ProviderIndexEntryLink({ locale, caseId }: { locale: "he" | "en"; caseId?: string }) {
  if (process.env.LS_PROVIDER_INDEX_ENABLED !== "true") return null;
  let allowed = false;
  try {
    const { identity, actor } = await providerOwnerContext(new Headers(await headers()));
    if (caseId) await identity.store.transaction(async tx => { caseAccess(actor, await loadCase(tx, actor.workspaceId, asId(caseId, "case")), [], "write"); });
    allowed = true;
  } catch { return null; }
  if (!allowed) return null;
  return <nav aria-label={locale === "he" ? "נותני שירות — פרטי" : "Private providers"} className="lsw-toolbar">
    <a className="lsw-button lsw-button--secondary" href={caseId ? `/${locale}/app/cases/${caseId}/provider-referrals` : `/${locale}/app/providers`}>
      {caseId ? (locale === "he" ? "הפניות לנותני שירות" : "Provider referrals") : (locale === "he" ? "מאגר נותני שירות פרטי" : "Private provider index")}
    </a>
  </nav>;
}

