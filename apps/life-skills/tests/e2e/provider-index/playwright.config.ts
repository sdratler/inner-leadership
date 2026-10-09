import {defineConfig,devices} from "@playwright/test";
export default defineConfig({testDir:".",testMatch:"provider-index.spec.ts",fullyParallel:false,workers:1,retries:0,timeout:90000,reporter:[["list"]],outputDir:"test-results/provider-index",use:{ignoreHTTPSErrors:true,trace:"retain-on-failure",video:"off",screenshot:"only-on-failure"},projects:[
 {name:"desktop",use:{...devices["Desktop Chrome"],viewport:{width:1440,height:1000}}},
 {name:"mobile390",use:{...devices["Desktop Chrome"],viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
 {name:"mobile340",use:{...devices["Desktop Chrome"],viewport:{width:340,height:844},isMobile:true,hasTouch:true}}
]});
