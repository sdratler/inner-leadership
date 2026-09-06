import { defineConfig,devices } from "@playwright/test";
export default defineConfig({
 testDir:"./tests/e2e",testIgnore:"**/locked.spec.ts",fullyParallel:true,
 retries:0,reporter:[["list"],["html",{open:"never"}]],
 use:{baseURL:"http://127.0.0.1:3001",trace:"retain-on-failure",screenshot:"only-on-failure"},
 projects:[{name:"desktop",use:{...devices["Desktop Chrome"],viewport:{width:1440,height:1000}}},{name:"mobile",use:{...devices["Desktop Chrome"],viewport:{width:390,height:844},isMobile:true,hasTouch:true}}],
 webServer:{command:"npm run build && npm start",url:"http://127.0.0.1:3001/he/foundation",reuseExistingServer:false,timeout:180000,env:{LS_APP_MODE:"foundation_preview",LS_APP_ORIGIN:"http://127.0.0.1:3001",NEXT_TELEMETRY_DISABLED:"1"}},
});
