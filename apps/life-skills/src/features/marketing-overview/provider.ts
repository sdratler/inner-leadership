import "server-only";
import type { MarketingInventory, MarketingSnapshot } from "./contracts.ts";
import { crmBridge } from "../prospects/bridge.ts";
import { readDirectMetaAds } from "./meta-provider.ts";

type RegistryReadback = {
  success: true;
  snapshot: {
    fetchedAt: string;
    workbookUrl: string;
    creatives: MarketingSnapshot["creatives"];
    publications: MarketingSnapshot["publications"];
    inventory: MarketingInventory;
  };
};

const empty: MarketingSnapshot = {
  source: "registry_only",
  fetchedAt: null,
  creatives: [],
  publications: [],
  ads: [],
  adSeries: [],
  workbookUrl: null,
  connectionErrors: [],
  scout: { readyDrafts: null, sourceUrl: null, lastChecked: null, status: "unbound" },
};

export async function loadMarketingSnapshot(): Promise<MarketingSnapshot> {
  const [registryResult, metaResult] = await Promise.allSettled([
    crmBridge<RegistryReadback>("/api/bna/life-skills-app/marketing"),
    readDirectMetaAds(),
  ]);
  const registry = registryResult.status === "fulfilled" ? registryResult.value.snapshot : null;
  const meta = metaResult.status === "fulfilled" ? metaResult.value : null;
  const errors = [
    !registry ? "creative_inventory_unavailable" : null,
    !meta ? "direct_meta_readback_unavailable" : null,
  ].filter((value): value is string => Boolean(value));
  if (!registry && !meta) return { ...empty, connectionErrors: errors };
  return {
    ...empty,
    source: "provider_readback",
    fetchedAt: [registry?.fetchedAt, meta?.fetchedAt].filter(Boolean).sort().at(-1) ?? null,
    creatives: registry?.creatives ?? [],
    publications: registry?.publications ?? [],
    ...(registry?.inventory ? { inventory: registry.inventory } : {}),
    workbookUrl: registry?.workbookUrl ?? null,
    ads: meta?.ads ?? [],
    adSeries: meta?.adSeries ?? [],
    connectionErrors: errors,
  };
}
