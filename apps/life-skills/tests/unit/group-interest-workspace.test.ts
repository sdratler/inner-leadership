import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it} from "vitest";
import {interestNotice} from "../../src/features/group-interest/contract.ts";
import {classifyGroupInterestSaveFailure,GroupInterestWorkspace,permissionLanguageChanged} from "../../src/features/group-interest/workspace.tsx";

describe("group interest owner form",()=>{
 it("binds the displayed permission to the admitted canonical notice version",()=>{
  expect(interestNotice.version).toBe("ls-group-interest-20261007-01-v1");
  expect(interestNotice.en).toContain("administrative interest only");
  expect(interestNotice.he).toContain("התעניינות מנהלית בלבד");
  expect(interestNotice.en).not.toContain("Candidate");
 });
 it.each(["en","he"] as const)("requires an explicit permission language before the exact notice can be confirmed in %s",locale=>{
  const html=renderToStaticMarkup(createElement(GroupInterestWorkspace,{locale}));
  expect(html).toContain(`<option value="${locale}" selected="">`);
  expect(html).toContain('name="permissionLanguage"');
  expect(html).toContain('<option value="he">');
  expect(html).toContain('<option value="en">');
  expect(html).toMatch(/<input[^>]*disabled=""[^>]*name="permission"/);
  expect(html).toContain(locale==="he"?"בחרו את שפת ההסכמה":"Select the permission language");
 });
 it("requires the exact notice to be reconfirmed after every permission-language change",()=>{
  const confirmed={language:"en" as const,confirmed:true};
  expect(confirmed.confirmed).toBe(true);
  expect(permissionLanguageChanged("he")).toEqual({language:"he",confirmed:false});
  expect(permissionLanguageChanged("en")).toEqual({language:"en",confirmed:false});
 });
 it("distinguishes confirmed client failures from unknown write outcomes",()=>{
  expect(classifyGroupInterestSaveFailure(false)).toBe("reauth");
  expect(classifyGroupInterestSaveFailure(true,401)).toBe("reauth");
  for(const status of [400,403,404,409,429])expect(classifyGroupInterestSaveFailure(true,status)).toBe("correctable");
  for(const status of [500,503,undefined])expect(classifyGroupInterestSaveFailure(true,status)).toBe("unconfirmed");
 });
});
