import "server-only";
import { headers } from "next/headers";
import { AppError } from "../../lib/errors.ts";
import { SESSION_COOKIE } from "../../lib/security/session.ts";
import { TOKEN_PATTERN } from "../identity/crypto.ts";
import { identityRuntime } from "../identity/runtime.ts";
import { publicGroupApplicationEnvironmentEnabled } from "../group-application/candidate.ts";
import { KeysInterestStore } from "./store.ts";

export function keysCollectionEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.LS_KEYS_INTEREST_ENABLED === "true" && publicGroupApplicationEnvironmentEnabled(environment);
}

export async function keysRuntime() {
  const identity = await identityRuntime();
  const store = new KeysInterestStore(identity.store, identity.config.workspaceId, identity.config.keyring,
    identity.config.lookupKey.toString("hex"), process.env.LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID ?? "", identity.clock);
  return { identity, store };
}

export async function keysCollectionRuntime() {
  if (!keysCollectionEnabled()) throw new AppError("NOT_FOUND");
  return keysRuntime();
}

export async function keysOwnerRuntime() {
  // Closing public intake must not hide previously saved inquiries from the owner.
  if (process.env.LS_PRIVATE_APP_ENABLED !== "true") throw new AppError("NOT_FOUND");
  return keysRuntime();
}

export async function requireKeysOwnerPage() {
  const cookies = (new Headers(await headers()).get("cookie") ?? "").split(";")
    .map(value => value.trim()).filter(value => value.startsWith(`${SESSION_COOKIE}=`));
  if (cookies.length !== 1) throw new AppError("UNAUTHENTICATED");
  const token = cookies[0]!.slice(SESSION_COOKIE.length + 1);
  if (!TOKEN_PATTERN.test(token)) throw new AppError("UNAUTHENTICATED");
  const { identity, store } = await keysOwnerRuntime();
  const actor = await identity.services.sessions.actor(token);
  if (actor.id !== process.env.LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID || actor.workspaceId !== identity.config.workspaceId || actor.role !== "practitioner") throw new AppError("NOT_FOUND");
  // Revalidate the real owner session in the same transaction used for the read.
  await store.listPage(actor);
}
