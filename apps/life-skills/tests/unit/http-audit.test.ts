import { describe,it,expect } from "vitest";
import { z } from "zod";
import { readJson,failureResponse } from "../../src/lib/http/json.ts";
import { writeAudit } from "../../src/lib/audit.ts";
import { AppError } from "../../src/lib/errors.ts";
const request=(body:string,type="application/json")=>new Request("https://workspace.example.test/api",{method:"POST",body,headers:{"content-type":type}});
describe("HTTP and audit boundaries",()=>{
 it("accepts a strict valid JSON boundary",async()=>expect(await readJson(request('{"enabled":true}'),z.strictObject({enabled:z.boolean()}))).toEqual({enabled:true}));
 it("rejects unknown keys",async()=>{await expect(readJson(request('{"enabled":true,"privateText":"synthetic"}'),z.strictObject({enabled:z.boolean()}))).rejects.toMatchObject({code:"INVALID_REQUEST"});});
 it("rejects content types, broken JSON and too many bytes",async()=>{
  await expect(readJson(request("{}","text/plain"),z.object({}))).rejects.toMatchObject({code:"UNSUPPORTED_MEDIA_TYPE"});
  await expect(readJson(request("{"),z.object({}))).rejects.toMatchObject({code:"INVALID_REQUEST"});
  await expect(readJson(request('{"x":"xxxxxxxx"}'),z.object({x:z.string()}),8)).rejects.toMatchObject({code:"PAYLOAD_TOO_LARGE"});
 });
 it("measures UTF-8 bytes rather than character count",async()=>{await expect(readJson(request('{"x":"שלום"}'),z.object({x:z.string()}),13)).rejects.toMatchObject({code:"PAYLOAD_TOO_LARGE"});});
 it("redacts exception details and marks responses private",async()=>{const response=failureResponse(new Error("SYNTHETIC_SECRET"),"synthetic-request");expect(response.status).toBe(500);expect(await response.text()).not.toContain("SYNTHETIC_SECRET");expect(response.headers.get("cache-control")).toContain("no-store");});
 it("retains a neutral recognized error code",async()=>expect((await failureResponse(new AppError("FORBIDDEN"),"synthetic-request").json()).error.code).toBe("FORBIDDEN"));
 it("rejects private payload fields in audit metadata",async()=>{await expect(writeAudit({write:async()=>undefined},{eventId:"11111111-1111-4111-8111-111111111111",requestId:"22222222-2222-4222-8222-222222222222",workspaceId:"33333333-3333-4333-8333-333333333333",actorAccountId:null,kind:"access_denied",outcome:"denied",occurredAt:"2026-09-06T10:00:00Z",clinicalText:"synthetic rejected text"})).rejects.toThrow("INVALID_AUDIT_EVENT");});
});
