import {defineConfig,devices} from "@playwright/test";

export default defineConfig({
 testDir:"./tests/visual",
 testMatch:"usability.spec.ts",
 fullyParallel:false,
 reporter:"list",
 use:{baseURL:"http://127.0.0.1:3001",trace:"retain-on-failure"},
 projects:[
  {name:"desktop",use:{...devices["Desktop Chrome"],viewport:{width:1440,height:900}}},
  {name:"mobile",use:{...devices["Desktop Chrome"],viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
 ],
 webServer:{command:"npm run dev",url:"http://127.0.0.1:3001/he/dev/ui/workspace?role=parent",reuseExistingServer:false,timeout:120000,env:{LS_APP_MODE:"foundation_preview",LS_APP_ORIGIN:"http://127.0.0.1:3001",NEXT_TELEMETRY_DISABLED:"1"}},
});
