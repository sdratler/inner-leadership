import {defineConfig,devices} from "@playwright/test";
export default defineConfig({testDir:".",testMatch:"group-interest.spec.ts",fullyParallel:false,workers:1,retries:0,timeout:60000,
 reporter:[["list"]],outputDir:"test-results/group-interest",use:{baseURL:"https://localhost:3105",ignoreHTTPSErrors:true,trace:"retain-on-failure",video:"off",screenshot:"only-on-failure"},
 projects:[{name:"desktop",use:{...devices["Desktop Chrome"],viewport:{width:1440,height:1000}}},{name:"mobile",use:{...devices["Desktop Chrome"],viewport:{width:390,height:844},isMobile:true,hasTouch:true}}]});
