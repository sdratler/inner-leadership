import {describe,expect,it} from "vitest";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {syntheticChildFailure} from "../../e2e/group-interest/synthetic-child-output.ts";
describe("isolated child failure diagnostics",()=>{
 it("retains both streams and the actual failure",()=>{
  const value=syntheticChildFailure({stdout:"locator assertion failed",stderr:"browser child exited1"});
  expect(value).toContain("[stdout tail]\nlocator assertion failed");expect(value).toContain("[stderr tail]\nbrowser child exited1");
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
 it("redacts the exact reviewer escaped-quote case and backslash variants",()=>{
  for(const password of ['safe-prefix"SYNTHETIC_SECRET_SUFFIX','safe-prefix\\"SYNTHETIC_SECRET_SUFFIX','safe-prefix\\SYNTHETIC_SECRET_SUFFIX']){
   const value=syntheticChildFailure({stdout:JSON.stringify({password})});expect(value).not.toContain("SYNTHETIC_SECRET_SUFFIX");
  }
 });
 it("retains both exact reviewer stream sentinels under a noisy stderr bound",()=>{
  const value=syntheticChildFailure({stdout:"PRIMARY_ASSERTION_SENTINEL",stderr:"e".repeat(20000)+"SECONDARY_STDERR_SENTINEL"});
  expect(value).toContain("PRIMARY_ASSERTION_SENTINEL");expect(value).toContain("SECONDARY_STDERR_SENTINEL");expect(value.length).toBeLessThanOrEqual(16000);
 });
 it("keeps a bounded sanitized no-output cause and safe metadata",()=>{
  const value=syntheticChildFailure(Object.assign(new Error("SYNTHETIC_SPAWN_FAILURE"),{code:"ENOENT",signal:"SIGTERM",killed:true}));
  expect(value).toContain("SYNTHETIC_SPAWN_FAILURE");expect(value).toContain("code=ENOENT");expect(value).toContain("signal=SIGTERM");expect(value).toContain("killed=true");
  const bounded=syntheticChildFailure({message:'m'.repeat(30000)+' {"password":"SYNTHETIC_SECRET"}',code:{private:"not scalar"},signal:"not a safe signal"});
  expect(bounded).not.toContain("SYNTHETIC_SECRET");expect(bounded).not.toContain("not scalar");expect(bounded).not.toContain("not a safe signal");expect(bounded.length).toBeLessThanOrEqual(16000);
 });
 it("preserves a short stderr when stdout is noisy and bounds all sections",()=>{
  const value=syntheticChildFailure({stdout:"o".repeat(20000)+"STDOUT_END",stderr:"STDERR_END",message:"m".repeat(20000),code:1});
  expect(value).toContain("STDOUT_END");expect(value).toContain("STDERR_END");expect(value).toContain("code=1");expect(value.length).toBeLessThanOrEqual(16000);
 });
 it("captures an actual failed synthetic child without converting failure to success",async()=>{
  const output=await promisify(execFile)(process.execPath,["-e","process.stdout.write('ACTUAL_SYNTHETIC_STDOUT');process.stderr.write('ACTUAL_SYNTHETIC_STDERR');process.exit(1)"],
   {env:{SystemRoot:process.env.SystemRoot},windowsHide:true,timeout:5000,maxBuffer:1024}).then(()=>{throw Error("SYNTHETIC_CHILD_UNEXPECTEDLY_PASSED");},error=>syntheticChildFailure(error));
  expect(output).toContain("ACTUAL_SYNTHETIC_STDOUT");expect(output).toContain("ACTUAL_SYNTHETIC_STDERR");expect(output).toContain("code=1");
 });
});
