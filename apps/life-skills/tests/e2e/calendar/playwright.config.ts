import { defineConfig,devices } from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'calendar.spec.ts',fullyParallel:false,workers:1,retries:0,timeout:30000,
 reporter:[['list']],outputDir:'test-results/ls030-calendar',use:{baseURL:'https://127.0.0.1:3445',ignoreHTTPSErrors:true,trace:'off',video:'off',screenshot:'off'},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}},{name:'mobile',use:{...devices['Desktop Chrome'],viewport:{width:390,height:844},isMobile:true,hasTouch:true}}]});
