import {afterEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {crmBridge,crmBridgeImage,crmBridgeWhatsAppRoster,listProspects,createProspect,updateProspect} from "../../../src/features/prospects/bridge.ts";
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
test("old credentials cannot reactivate retired CRM reads, writes, assets or roster",async()=>{
 const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
 vi.stubEnv("LIFE_SKILLS_CRM_BRIDGE_ORIGIN","https://retired.example");vi.stubEnv("LIFE_SKILLS_APP_BRIDGE_SECRET","x".repeat(32));
 const calls=[()=>listProspects(),()=>createProspect({name:"Synthetic",phone:"+12025550123",language:"en",source:"manual",notes:"",nextAction:"",dueDate:""}),()=>updateProspect("retired-lead",{stage:"contacted"}),()=>crmBridge("/api/bna/life-skills-app/marketing"),()=>crmBridge("/api/bna/life-skills-app/prospects/retired-lead/send",{method:"POST"}),()=>crmBridgeWhatsAppRoster()];
 for(const call of calls)await expect(call()).rejects.toMatchObject({code:"UNAVAILABLE"});
 await expect(crmBridgeImage("retired-asset",1,"a".repeat(64))).rejects.toMatchObject({code:"NOT_FOUND"});
 expect(fetch).not.toHaveBeenCalled();
});
