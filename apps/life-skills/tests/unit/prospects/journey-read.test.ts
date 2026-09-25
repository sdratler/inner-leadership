import {describe,expect,it} from "vitest";
import {readProspectJourneys} from "../../../src/features/prospects/journey-read.ts";
import type {IdentityStore} from "../../../src/features/identity/store.ts";

describe("CRM journey projection",()=>{
 it("does not query PostgreSQL for an empty CRM result",async()=>{
  const store:IdentityStore={transaction:async()=>{throw new Error("unexpected query")}};
  expect((await readProspectJourneys(store,"workspace",[])).size).toBe(0);
 });
 it("encodes lead IDs as JSON text for the Drizzle/PostgreSQL boundary",async()=>{
  let statement="",values:readonly unknown[]=[];
  const store:IdentityStore={transaction:async work=>work({query:async <T extends object>(sql:string,args:readonly unknown[]=[])=>{
   statement=sql;values=args;return [{leadId:"LS-LEAD-a",state:"active",paymentVerified:true}] as T[];
  }})};
  const result=await readProspectJourneys(store,"workspace",["LS-LEAD-a","LS-LEAD-b"]);
  expect(statement).toContain("jsonb_array_elements_text($2::jsonb)");
  expect(values).toEqual(["workspace",'["LS-LEAD-a","LS-LEAD-b"]']);
  expect(result.get("LS-LEAD-a")).toEqual({journeyState:"active",paymentVerified:true});
 });
});
