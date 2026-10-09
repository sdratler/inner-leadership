import "server-only";
import { crmBridge } from "../prospects/bridge.ts";
import type {
  FacebookPagePublicationReadModel,
  FacebookPagePublicationRecord,
  FacebookPagePublicationState,
} from "./contracts.ts";

const STATES = new Set<FacebookPagePublicationState>([
  "UNCONFIGURED_DESTINATION", "ASSET_HELD", "MEDIA_EVIDENCE_UNAVAILABLE",
  "CAPTION_UNAVAILABLE", "SCHEDULE_UNAVAILABLE", "BLOCKED",
  "UNKNOWN_DELIVERY_NO_RETRY", "READBACK_UNAVAILABLE",
  "PUBLISHED_READBACK_VERIFIED", "READY_PREVIEW_DISABLED",
  "RESERVED_PROVIDER_EVIDENCE_ABSENT", "PROVIDER_EVIDENCE_ABSENT",
]);
const LIFECYCLE = new Set<FacebookPagePublicationRecord["state"]>([
  "BLOCKED", "READY", "RESERVED", "ACCEPTED", "SCHEDULED", "SENDING",
  "PUBLISHED", "FAILED", "UNKNOWN",
]);
const ROOT_KEYS = [
  "state", "reason", "lifecycleState", "mode", "destinationConfigured",
  "providerEvidenceAvailable", "externalWriteEnabled", "externalWritePerformed",
  "noBlindRetry", "recentRecords",
] as const;
const RECORD_KEYS = [
  "id", "state", "localBusinessDate", "scheduledAt", "providerReadAt",
  "publishedAt", "noBlindRetry",
] as const;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactOwnKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function nullableIso(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}
function nullableDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function unavailableFacebookPagePublicationState(): FacebookPagePublicationReadModel {
  return {
    state: "BRIDGE_UNAVAILABLE", lifecycleState: "BLOCKED", reason: null,
    destinationConfigured: false, providerEvidenceAvailable: false,
    externalWriteEnabled: false, externalWritePerformed: false,
    noBlindRetry: false, recentRecords: [],
  };
}

export function parseFacebookPagePublicationState(value: unknown): FacebookPagePublicationReadModel {
  if (!object(value) || !exactOwnKeys(value, ROOT_KEYS)) throw new Error("facebook_page_readback_invalid");
  if (!STATES.has(value.state as FacebookPagePublicationState)) throw new Error("facebook_page_readback_invalid");
  if (!LIFECYCLE.has(value.lifecycleState as FacebookPagePublicationRecord["state"])) throw new Error("facebook_page_readback_invalid");
  if (value.mode !== "disabled_read_only") throw new Error("facebook_page_readback_invalid");
  if (value.reason !== null && (typeof value.reason !== "string" || value.reason.length > 200)) throw new Error("facebook_page_readback_invalid");
  for (const key of ["destinationConfigured", "providerEvidenceAvailable", "noBlindRetry"] as const) {
    if (typeof value[key] !== "boolean") throw new Error("facebook_page_readback_invalid");
  }
  if (value.externalWriteEnabled !== false || value.externalWritePerformed !== false) throw new Error("facebook_page_external_write_rejected");
  if (value.state === "UNKNOWN_DELIVERY_NO_RETRY" && value.noBlindRetry !== true) throw new Error("facebook_page_retry_safety_invalid");
  if (value.state === "PUBLISHED_READBACK_VERIFIED" && (value.lifecycleState !== "PUBLISHED" || value.providerEvidenceAvailable !== true)) throw new Error("facebook_page_publication_evidence_invalid");
  if (value.state === "UNCONFIGURED_DESTINATION" && value.destinationConfigured !== false) throw new Error("facebook_page_destination_state_invalid");
  if (!Array.isArray(value.recentRecords) || value.recentRecords.length > 50) throw new Error("facebook_page_readback_invalid");
  const recentRecords = value.recentRecords.map((entry): FacebookPagePublicationRecord => {
    if (!object(entry) || !exactOwnKeys(entry, RECORD_KEYS)) throw new Error("facebook_page_record_invalid");
    const validId = entry.id === null
      || typeof entry.id === "string" && entry.id.length >= 1 && entry.id.length <= 128
      || typeof entry.id === "number" && Number.isSafeInteger(entry.id) && entry.id >= 0;
    if (!validId) throw new Error("facebook_page_record_invalid");
    if (!LIFECYCLE.has(entry.state as FacebookPagePublicationRecord["state"])) throw new Error("facebook_page_record_invalid");
    if (!nullableDate(entry.localBusinessDate) || !nullableIso(entry.scheduledAt) || !nullableIso(entry.providerReadAt) || !nullableIso(entry.publishedAt) || typeof entry.noBlindRetry !== "boolean") throw new Error("facebook_page_record_invalid");
    if (entry.state === "UNKNOWN" && entry.noBlindRetry !== true) throw new Error("facebook_page_record_retry_safety_invalid");
    return {
      state: entry.state as FacebookPagePublicationRecord["state"],
      localBusinessDate: entry.localBusinessDate,
      scheduledAt: entry.scheduledAt,
      providerReadAt: entry.providerReadAt,
      publishedAt: entry.publishedAt,
      noBlindRetry: entry.noBlindRetry,
    };
  });
  return {
    state: value.state as FacebookPagePublicationState,
    lifecycleState: value.lifecycleState as FacebookPagePublicationRecord["state"],
    reason: value.reason as string | null,
    destinationConfigured: value.destinationConfigured as boolean,
    providerEvidenceAvailable: value.providerEvidenceAvailable as boolean,
    externalWriteEnabled: false,
    externalWritePerformed: false,
    noBlindRetry: value.noBlindRetry as boolean,
    recentRecords,
  };
}

export async function loadFacebookPagePublicationState(): Promise<FacebookPagePublicationReadModel> {
  try {
    const result = await crmBridge<{success: true; publication: unknown}>("/api/bna/life-skills-app/marketing/facebook-page-publication");
    if (!object(result) || !Object.hasOwn(result, "publication")) throw new Error("facebook_page_readback_invalid");
    return parseFacebookPagePublicationState(result.publication);
  } catch {
    return unavailableFacebookPagePublicationState();
  }
}
