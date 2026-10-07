import "server-only";
import { AppError } from "../../../lib/errors.ts";
import { SESSION_COOKIE } from "../../../lib/security/session.ts";
import { TOKEN_PATTERN } from "../../identity/crypto.ts";
import { identityRuntime } from "../../identity/runtime.ts";
import { assertGate, indexGate, authorize } from "./shared.ts";
export async function providerOwnerContext(headers: Headers) {
  const matches = (headers.get("cookie") ?? "").split(";").map(s => s.trim()).filter(s => s.startsWith(`${SESSION_COOKIE}=`));
  if (matches.length !== 1) throw new AppError("UNAUTHENTICATED");
  const token = matches[0]!.slice(SESSION_COOKIE.length + 1);
  if (!TOKEN_PATTERN.test(token)) throw new AppError("UNAUTHENTICATED");
  const identity = await identityRuntime(), actor = await identity.services.sessions.actor(token), gate = indexGate(process.env, identity.config);
  assertGate(actor, gate);
  await identity.store.transaction(tx => authorize(tx, actor, gate, identity.clock));
  return { token, identity, actor, gate };
}
