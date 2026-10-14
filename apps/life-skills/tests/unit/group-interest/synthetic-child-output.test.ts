import {describe,expect,it} from "vitest";
import {syntheticChildFailure} from "../../e2e/group-interest/synthetic-child-output.ts";
describe("isolated child failure diagnostics",()=>{
 it("retains both streams and the actual failure",()=>{
  const value=syntheticChildFailure({stdout:"locator assertion failed",stderr:"browser child exited1"});
  expect(value).toContain("locator assertion failed\nbrowser child exited1");
 });
 it("does not pretend absent or nontext output passed",()=>{
  for(const value of [null,new Error("failure"),{stdout:123}])expect(syntheticChildFailure(value)).toContain("No text child output was captured");
 });
 it("redacts credential-shaped diagnostics",()=>{
  const value=syntheticChildFailure({stdout:'{"token":"synthetic-token","password":"synthetic-password","csrfToken":"synthetic-csrf"}\nAuthorization: Bearer synthetic-bearer\nLS_IDENTITY_DATA_KEYS=synthetic-key\ncookie: ls_session=synthetic-cookie\npostgresql://synthetic:synthetic-db-password@127.0.0.1/test'});
  for(const secret of ["synthetic-token","synthetic-password","synthetic-csrf","synthetic-bearer","synthetic-key","synthetic-cookie","synthetic-db-password"])expect(value).not.toContain(secret);
  expect(value).toContain("127.0.0.1/test");expect(value).toContain("[REDACTED]");
 });
 it("bounds output while keeping the failure tail",()=>{
  const value=syntheticChildFailure({stdout:"x".repeat(32000)+"ASSERTION_FAILED"});
  expect(value.endsWith("ASSERTION_FAILED")).toBe(true);expect(value.length).toBeLessThan(16100);
 });
 it("redacts before clipping and preserves ordinary synthetic labels",()=>{
  const value=syntheticChildFailure({stdout:'{"token":"'+"private".repeat(5000)+'"}\nSynthetic fishing en: assertion failed'});
  expect(value).not.toContain("private");expect(value).toContain("Synthetic fishing en: assertion failed");
 });
});
