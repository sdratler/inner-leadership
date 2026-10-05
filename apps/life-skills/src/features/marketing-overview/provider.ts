import "server-only";
import type { MarketingInventory, MarketingSnapshot } from "./contracts.ts";
import { crmBridge } from "../prospects/bridge.ts";
import { readDirectMetaAds } from "./meta-provider.ts";
import {creativeMediaPath} from "./media-link.ts";
import {validateMarketingSnapshot} from "./read-model.ts";

type RegistryReadback = {
  success: true;
  snapshot: {
    fetchedAt: string;
    workbookUrl: string;
    creatives: MarketingSnapshot["creatives"];
    library?: MarketingSnapshot["library"];
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
// This process's last successful inventory read, not Meta freshness or a
// fabricated persistent sync. A restart honestly returns unknown until read.
let lastInventoryReadAt:string|null=null;

function registrySnapshot(result:PromiseSettledResult<RegistryReadback>):RegistryReadback["snapshot"]|null {
  if(result.status!=="fulfilled"||result.value?.success!==true)return null;
  try{
    const snapshot=result.value.snapshot;
    if(!snapshot||typeof snapshot.fetchedAt!=="string"||!Array.isArray(snapshot.creatives)||!Array.isArray(snapshot.publications)||snapshot.inventory===undefined)return null;
    if("library" in snapshot&&!Object.hasOwn(snapshot,"library"))return null;
    validateMarketingSnapshot({...empty,source:"provider_readback",fetchedAt:snapshot.fetchedAt,creatives:snapshot.creatives,publications:snapshot.publications,inventory:snapshot.inventory,...(snapshot.library!==undefined?{library:snapshot.library}:{})});
    // Validate the actual media mapping before advertising this read as fresh.
    const creatives=snapshot.creatives.map(asset=>({...asset,imageUrl:creativeMediaPath(asset)}));
    const library=snapshot.library?.map(asset=>({...asset,imageUrl:creativeMediaPath(asset)}));
    return {...snapshot,creatives,...(library?{library}:{})};
  }catch{return null;}
}

export async function loadMarketingSnapshot(): Promise<MarketingSnapshot> {
  const lastAttemptAt=new Date().toISOString();
  const [registryResult, metaResult] = await Promise.allSettled([
    crmBridge<RegistryReadback>("/api/bna/life-skills-app/marketing"),
    readDirectMetaAds(),
  ]);
  const registry = registrySnapshot(registryResult);
  if(registry&&(lastInventoryReadAt===null||Date.parse(registry.fetchedAt)>Date.parse(lastInventoryReadAt)))lastInventoryReadAt=registry.fetchedAt;
  const inventoryReadback:NonNullable<MarketingSnapshot["inventoryReadback"]>={status:registry?"available":"error",lastSuccessfulReadAt:lastInventoryReadAt,lastAttemptAt,errorCode:registry?null:"creative_inventory_unavailable"};
  const meta = metaResult.status === "fulfilled" ? metaResult.value : null;
  const errors = [
    !registry ? "creative_inventory_unavailable" : null,
    !meta ? "direct_meta_readback_unavailable" : null,
  ].filter((value): value is string => Boolean(value));
  if (!registry && !meta) return { ...empty, connectionErrors: errors,inventoryReadback };
  return {
    ...empty,
    source: "provider_readback",
    fetchedAt: [registry?.fetchedAt, meta?.fetchedAt].filter(Boolean).sort().at(-1) ?? null,
    creatives: registry?.creatives ?? [],
    ...(registry?.library?{library:registry.library}:{}),
    publications: registry?.publications ?? [],
    ...(registry?.inventory ? { inventory: registry.inventory } : {}),
    workbookUrl: registry?.workbookUrl ?? null,
    ads: meta?.ads ?? [],
    adSeries: meta?.adSeries ?? [],
    ...(meta?{adReporting:meta.adReporting}:{}),
    connectionErrors: errors,
    inventoryReadback,
  };
}
