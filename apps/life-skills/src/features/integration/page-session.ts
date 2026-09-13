import "server-only";
import { headers } from "next/headers";
import { AppError } from "../../lib/errors.ts";
import { SESSION_COOKIE } from "../../lib/security/session.ts";
import { TOKEN_PATTERN } from "../identity/crypto.ts";
import { identityRuntime } from "../identity/runtime.ts";

export async function requireWorkspaceRole(role: "parent" | "practitioner") {
  const values = (new Headers(await headers()).get("cookie") ?? "").split(";")
    .map(value => value.trim()).filter(value => value.startsWith(`${SESSION_COOKIE}=`));
  if (values.length !== 1) throw new AppError("UNAUTHENTICATED");
  const token = values[0]!.slice(SESSION_COOKIE.length + 1);
  if (!TOKEN_PATTERN.test(token)) throw new AppError("UNAUTHENTICATED");
  const identity = await identityRuntime(), actor = await identity.services.sessions.actor(token);
  if (actor.role !== role) throw new AppError("NOT_FOUND");
  return Object.freeze({ role, locale: actor.locale });
}
