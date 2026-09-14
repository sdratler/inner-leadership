import { describe,it,expect } from "vitest";
import { parseEnvironment } from "../../src/lib/env/schema.ts";
describe("environment",()=>{
 it("defaults to a locked app",()=>expect(parseEnvironment({}).LS_APP_MODE).toBe("foundation_locked"));
 it("allows optional empty DB settings without connecting",()=>expect(parseEnvironment({LS_DATABASE_URL:"",LS_MIGRATION_DATABASE_URL:""}).LS_DATABASE_URL).toBeUndefined());
 it("allows an explicit loopback preview",()=>expect(parseEnvironment({LS_APP_MODE:"foundation_preview",LS_APP_ORIGIN:"http://127.0.0.1:3001"}).LS_APP_MODE).toBe("foundation_preview"));
 it("blocks an externally hosted preview",()=>expect(()=>parseEnvironment({LS_APP_MODE:"foundation_preview",LS_APP_ORIGIN:"https://workspace.example.test"})).toThrow("PREVIEW_REQUIRES_LOOPBACK_ORIGIN"));
 it("allows a separately gated HTTPS isolated preview",()=>expect(parseEnvironment({LS_APP_MODE:"isolated_preview",LS_APP_ORIGIN:"https://workspace.example.test",LS_PREVIEW_ACCESS_KEY:"a".repeat(32)}).LS_APP_MODE).toBe("isolated_preview"));
 it.each([{LS_APP_ORIGIN:"http://127.0.0.1:3001",LS_PREVIEW_ACCESS_KEY:"a".repeat(32)},{LS_APP_ORIGIN:"https://workspace.example.test",LS_PREVIEW_ACCESS_KEY:"short"}])("rejects an incomplete isolated preview configuration: %o",values=>expect(()=>parseEnvironment({LS_APP_MODE:"isolated_preview",...values})).toThrow("ISOLATED_PREVIEW_CONFIGURATION_REQUIRED"));
 it("requires secure external origins",()=>expect(()=>parseEnvironment({LS_APP_ORIGIN:"http://workspace.example.test"})).toThrow("APP_HTTPS_REQUIRED"));
 it.each(["https://workspace.example.test/path","https://workspace.example.test/?x=1","https://synthetic:secret@workspace.example.test"])("rejects non-origin %s",origin=>expect(()=>parseEnvironment({LS_APP_ORIGIN:origin})).toThrow());
 it("prevents disabling remote database TLS",()=>expect(()=>parseEnvironment({LS_DATABASE_URL:"postgres://db.example.test/synthetic_test",LS_DATABASE_TLS:"disable"})).toThrow("REMOTE_DATABASE_TLS_REQUIRED"));
 it("rejects SSL URL parameters that override explicit pg settings",()=>expect(()=>parseEnvironment({LS_DATABASE_URL:"postgres://db.example.test/synthetic_test?sslmode=require"})).toThrow("DATABASE_URL_PARAMETERS_FORBIDDEN"));
 it("does not include bad environment values in errors",()=>{try{parseEnvironment({LS_APP_MODE:"SYNTHETIC_PRIVATE_VALUE"});}catch(error){expect(String(error)).not.toContain("SYNTHETIC_PRIVATE_VALUE");}});
});
