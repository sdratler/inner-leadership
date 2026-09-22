import {describe,expect,it} from "vitest";
import {feedbackContextReady} from "../../src/features/updates/updates-workspace.tsx";

describe("updates workspace reporting context",()=>{
 it("requires the selected case to match the published practice context",()=>{
  expect(feedbackContextReady("case-a","case-a","audience-a","version-a")).toBe(true);
  expect(feedbackContextReady("case-a","case-b","audience-a","version-a")).toBe(false);
 });
 it("does not permit a standalone feedback composer without the exact published audience and version",()=>{
  expect(feedbackContextReady("case-a","case-a","","version-a")).toBe(false);
  expect(feedbackContextReady("case-a","case-a","audience-a","")).toBe(false);
 });
});
