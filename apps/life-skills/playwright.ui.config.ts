import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'./tests/ui',testMatch:'gallery.spec.ts',fullyParallel:false,workers:1,retries:0,
 use:{baseURL:'http://127.0.0.1:3001',headless:true,trace:'retain-on-failure'},
 reporter:[['list'],['json',{outputFile:'test-results/ls020-browser.json'}]],
 webServer:{
  command:'npm run dev',url:'http://127.0.0.1:3001/he/dev/ui?role=parent',reuseExistingServer:false,timeout:180000,
  env:{LS_APP_MODE:'foundation_preview',LS_APP_ORIGIN:'http://127.0.0.1:3001',NEXT_TELEMETRY_DISABLED:'1'},
 },
});
