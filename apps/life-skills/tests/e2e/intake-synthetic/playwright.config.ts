import {defineConfig,devices} from "@playwright/test";

export default defineConfig({
 testDir:".",testMatch:"intake-synthetic.spec.ts",fullyParallel:false,workers:1,retries:0,timeout:45_000,
 reporter:[["list"]],outputDir:"test-results/r43-intake-synthetic",
 use:{baseURL:"https://127.0.0.1:3471",ignoreHTTPSErrors:true,trace:"off",video:"off",screenshot:"off"},
 projects:[
  {name:"desktop",use:{...devices["Desktop Chrome"],viewport:{width:1440,height:900}}},
  {name:"mobile390",use:{...devices["Desktop Chrome"],viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
  {name:"mobile340",use:{...devices["Desktop Chrome"],viewport:{width:340,height:844},isMobile:true,hasTouch:true}},
 ],
});
