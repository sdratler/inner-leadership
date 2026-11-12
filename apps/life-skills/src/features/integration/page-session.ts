import "server-only";
import { headers } from "next/headers";
import { AppError } from "../../lib/errors.ts";
import { SESSION_COOKIE } from "../../lib/security/session.ts";
import { TOKEN_PATTERN } from "../identity/crypto.ts";
import { identityRuntime } from "../identity/runtime.ts";

async function workspaceContext(){
  const values = (new Headers(await headers()).get("cookie") ?? "").split(";")
    .map(value => value.trim()).filter(value => value.startsWith(`${SESSION_COOKIE}=`));
  if (values.length !== 1) throw new AppError("UNAUTHENTICATED");
  const token = values[0]!.slice(SESSION_COOKIE.length + 1);
  if (!TOKEN_PATTERN.test(token)) throw new AppError("UNAUTHENTICATED");
  const identity = await identityRuntime(), actor = await identity.services.sessions.actor(token);
  return {identity,actor};
}
export async function requireWorkspaceRoles(roles: readonly ("parent" | "adult_client" | "child" | "practitioner")[]) {
  const {identity,actor}=await workspaceContext();
  if (!roles.includes(actor.role)) throw new AppError("NOT_FOUND");
  return Object.freeze({ role: actor.role, locale: actor.locale,...(identity.appScope?{fishingOwner:true as const}:{}) });
}
/** Internal server composition only; the selected native owner adapter is
 * required. Browser route, title and role never select this surface. */
export async function requireFishingOwnerPage(){
 const context=await workspaceContext();if(!context.identity.appScope)throw new AppError('NOT_FOUND');
 return {...context,scope:context.identity.appScope};
}

export function requireWorkspaceRole(role: "parent" | "adult_client" | "child" | "practitioner") {
  return requireWorkspaceRoles([role]);
}
