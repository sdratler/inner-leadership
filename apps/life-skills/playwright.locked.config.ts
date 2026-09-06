import { defineConfig } from "@playwright/test";
export default defineConfig({
 testDir:"./tests/e2e",testMatch:"**/locked.spec.ts",use:{baseURL:"http://127.0.0.1:3002"},
 webServer:{command:"npx --no-install next start --hostname 127.0.0.1 --port 3002",url:"http://127.0.0.1:3002/api/health",reuseExistingServer:false,timeout:60000,env:{LS_APP_MODE:"foundation_locked",LS_APP_ORIGIN:"http://127.0.0.1:3002",NEXT_TELEMETRY_DISABLED:"1"}},
});
