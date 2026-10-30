import {defineConfig,devices} from "@playwright/test";
const education=process.env.LS_EDUCATION_UI_ONLY==="true";
const community=process.env.LS_COMMUNITY_UI_ONLY==="true";
const academy=process.env.LS_ACADEMY_FREE_UI_ONLY==="true";
const bnaReplies=process.env.LS_BNA_REPLIES_UI_ONLY==="true";
const academyCrm=process.env.LS_ACADEMY_CRM_UI_ONLY==="true";
// Optional local renderer for this isolated harness when the pinned browser CDN
// is unavailable. CI keeps its ordinary pinned Chromium when this is absent.
const browserExecutable=process.env.LS_ACADEMY_CRM_BROWSER_EXECUTABLE;
if(browserExecutable&&(!(academyCrm||bnaReplies)||process.env.LS_GROUP_INTEREST_TEST_RUNNER_ACTIVE!=="true"))throw Error("ACADEMY_CRM_BROWSER_OVERRIDE_REQUIRES_ISOLATED_HARNESS");
export default defineConfig({testDir:academyCrm||bnaReplies?"../contact-ops":community?"../community":education?"../resources":process.env.LS_FISHING_LEAD_UI_ONLY==="true"?"../contact-ops":".",testMatch:bnaReplies?"bna-replies.journey.ts":academyCrm?"academy-crm.spec.ts":academy?"academy-free-registration.journey.ts":community?"inbox-journey.focused.ts":education?"education-lesson.spec.ts":process.env.LS_FISHING_LEAD_UI_ONLY==="true"?"fishing-lead-controls.spec.ts":"group-interest.spec.ts",fullyParallel:false,workers:1,retries:0,timeout:education||academy||academyCrm||bnaReplies?120000:60000,
 reporter:[["list"]],outputDir:"test-results/group-interest",use:{baseURL:"https://localhost:3105",ignoreHTTPSErrors:true,trace:"retain-on-failure",video:"off",screenshot:"only-on-failure",...(browserExecutable?{launchOptions:{executablePath:browserExecutable}}:{})},
 projects:[{name:"desktop",use:{...devices["Desktop Chrome"],viewport:{width:1440,height:education||community?900:1000}}},...(process.env.LS_GROUP_INTEREST_INCLUDE_TABLET==="true"?[{name:"tablet768",use:{...devices["Desktop Chrome"],viewport:{width:768,height:1024},hasTouch:true}}]:[]),{name:"mobile390",use:{...devices["Desktop Chrome"],viewport:{width:390,height:844},isMobile:true,hasTouch:true}},{name:"mobile340",use:{...devices["Desktop Chrome"],viewport:{width:340,height:844},isMobile:true,hasTouch:true}}]});
