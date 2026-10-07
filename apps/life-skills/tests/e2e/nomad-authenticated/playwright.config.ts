import {defineConfig,devices} from "@playwright/test";
import {dirname,join} from "node:path";
import {loadRuntime} from "./guards.ts";
const {path}=loadRuntime(process.env);
export default defineConfig({testDir:".",testMatch:"acceptance.pw.ts",fullyParallel:false,workers:1,retries:0,timeout:90000,reporter:[["list"]],outputDir:join(dirname(path),"test-results"),use:{ignoreHTTPSErrors:true,trace:"off",video:"off",serviceWorkers:"block"},projects:[{name:"desktop",use:{...devices["Desktop Chrome"],viewport:{width:1440,height:1000}}},{name:"mobile390",use:{...devices["Desktop Chrome"],viewport:{width:390,height:844},isMobile:true,hasTouch:true}}]});
