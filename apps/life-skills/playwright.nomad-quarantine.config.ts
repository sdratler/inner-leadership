import {defineConfig,devices} from "@playwright/test";

export default defineConfig({
 testDir:"./tests/e2e/contact-ops",testMatch:"nomad-quarantine.spec.tsx",fullyParallel:false,workers:1,retries:0,reporter:"line",
 outputDir:"test-results/nomad-quarantine",
 use:{...devices["Desktop Chrome"],trace:"retain-on-failure",screenshot:"only-on-failure"},
});
