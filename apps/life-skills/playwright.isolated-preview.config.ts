import { defineConfig,devices } from "@playwright/test";
const key="synthetic_isolated_preview_key_1234567890";
export default defineConfig({
 testDir:"./tests/isolated-preview",
 fullyParallel:true,
 workers:2,
 reporter:"line",
 use:{baseURL:"http://127.0.0.1:3003",httpCredentials:{username:"preview",password:key},trace:"retain-on-failure"},
 projects:[{name:"desktop",use:{...devices["Desktop Chrome"],viewport:{width:1440,height:1000}}},{name:"mobile",use:{...devices["Desktop Chrome"],viewport:{width:390,height:844},isMobile:true,hasTouch:true}}],
 webServer:{command:"npm run build && npm run start:railway",url:"http://127.0.0.1:3003/api/health",reuseExistingServer:false,timeout:180000,env:{NODE_ENV:"production",PORT:"3003",LS_APP_MODE:"isolated_preview",LS_APP_ORIGIN:"https://preview.example.test",LS_PREVIEW_ACCESS_KEY:key,NEXT_TELEMETRY_DISABLED:"1"}},
});
