import { describe,it,expect } from "vitest";
import { requireSession, sessionCookieOptions } from "../../src/lib/security/session.ts";
import { verifyMutationOrigin,verifyCsrfToken } from "../../src/lib/security/csrf.ts";
import { enforceRateLimit,opaqueRateLimitKey } from "../../src/lib/security/rate-limit.ts";
import { securityHeaders } from "../../src/lib/security/headers.ts";
import { assertSameWorkspace,closedCaseAuthorizer } from "../../src/lib/workspace.ts";
import { accountA,workspaceA,workspaceB,caseA } from "../fixtures.ts";
const token="a".repeat(43);
describe("closed-by-default security seams",()=>{
 it("has no default authenticator",async()=>{await expect(requireSession(token)).rejects.toMatchObject({code:"UNAVAILABLE"});});
 it("rejects absence, expired and revoked sessions",async()=>{
  await expect(requireSession(undefined)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
  await expect(requireSession(token,{resolve:async()=>({accountId:accountA,workspaceId:workspaceA,expiresAt:1,revoked:false})},2)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
  await expect(requireSession(token,{resolve:async()=>({accountId:accountA,workspaceId:workspaceA,expiresAt:100,revoked:true})},2)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
 });
 it("uses host-only secure cookies",()=>expect(sessionCookieOptions(3600)).toEqual({httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:3600}));
 it("rejects cross-workspace access and leaves case access closed",async()=>{
  expect(()=>assertSameWorkspace({accountId:accountA,workspaceId:workspaceA},workspaceB)).toThrow();
  await expect(closedCaseAuthorizer.authorize({accountId:accountA,workspaceId:workspaceA},caseA,"read")).rejects.toMatchObject({code:"UNAVAILABLE"});
 });
 it("requires exact origin on writes",()=>{
  expect(()=>verifyMutationOrigin(new Request("https://workspace.example.test/api",{method:"POST",headers:{origin:"https://other.example.test"}}),"https://workspace.example.test")).toThrow();
  expect(()=>verifyMutationOrigin(new Request("https://workspace.example.test/api",{method:"POST",headers:{origin:"https://workspace.example.test","sec-fetch-site":"same-origin"}}),"https://workspace.example.test")).not.toThrow();
 });
 it("rejects missing or unequal CSRF values",()=>{expect(()=>verifyCsrfToken(null,token)).toThrow();expect(()=>verifyCsrfToken("b".repeat(43),token)).toThrow();expect(()=>verifyCsrfToken(token,token)).not.toThrow();});
 it("fails closed on an unavailable rate-limit store",async()=>{const key=opaqueRateLimitKey("synthetic-subject","s".repeat(32));await expect(enforceRateLimit({consume:async()=>{throw new Error("offline");}},key,3,1000)).rejects.toMatchObject({code:"UNAVAILABLE"});});
 it("does not allow an exhausted budget",async()=>{const key=opaqueRateLimitKey("synthetic-subject","s".repeat(32));await expect(enforceRateLimit({consume:async()=>({count:4,retryAfterMs:1000})},key,3,1000)).rejects.toMatchObject({code:"RATE_LIMITED"});});
 it("has no unsafe script policy in production",()=>{const headers=securityHeaders("a".repeat(22)+"==",false,true);expect(headers["Content-Security-Policy"]).not.toContain("unsafe-eval");expect(headers["Content-Security-Policy"]).not.toContain("unsafe-inline");expect(headers["X-Robots-Tag"]).toContain("noindex");});
});
