import {expect,it} from "vitest";
import {accountExitDestination} from "../../../src/ui/workspace/account-exit.ts";

for(const locale of ["he","en"] as const){
 it(`${locale}: shared account logout returns every role to ordinary login`,()=>{
  expect(accountExitDestination(locale)).toBe(`/${locale}/login`);
  expect(accountExitDestination(locale)).not.toContain("/intake/staff");
 });
}
