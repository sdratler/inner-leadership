'use strict';
// Regeneration hashes Git-clean candidate bytes; runtime verification hashes raw files only.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const c=require('./native-ci-contract.cjs');
const root=path.resolve(__dirname,'../..');
const profiles={
  "tests/database/fishing-payments/lifecycle.native.test.ts": "payment",
  "tests/database/fishing-payments/process-recovery.native.test.ts": "payment",
  "tests/database/fishing-payments/temporal-dues.native.test.ts": "payment",
  "tests/database/fishing-stage/academy-session-policy.native.test.ts": "stageCredit",
  "tests/database/fishing-stage/native-store.test.ts": "stage",
  "tests/database/calendar/fishing-resource-fence.test.ts": "program",
  "tests/database/fishing-payments/native-founder-activation-fence.test.ts": "program",
  "tests/database/fishing-payments/native-stripe-composition.test.ts": "program",
  "tests/database/fishing-payments/native-stripe-receipt-ledger.test.ts": "program",
  "tests/database/fishing-payments/stripe-test-checkout-fulfillment.native.test.ts": "program",
  "tests/database/fishing-payments/stripe-test-checkout-native.native.test.ts": "program",
  "tests/database/fishing-payments/stripe-test-mounted-inbox.test.ts": "program",
  "tests/database/fishing/academy-billing.native.test.ts": "program",
  "tests/database/fishing/academy-enrollment.native.test.ts": "program",
  "tests/database/fishing/academy-family.native.test.ts": "program",
  "tests/database/fishing/academy-group-calendar-publication.native.test.ts": "program",
  "tests/database/fishing/academy-group-calendar-travel.native.test.ts": "program",
  "tests/database/fishing/academy-group-calendar.native.test.ts": "program",
  "tests/database/fishing/academy-monthly-block.native.test.ts": "program",
  "tests/database/fishing/academy-monthly-ordinary.native.test.ts": "program",
  "tests/database/fishing/academy-offer.native.test.ts": "program",
  "tests/database/fishing/academy-original-obligation.native.test.ts": "program",
  "tests/database/fishing/academy-parent-drive.native.test.ts": "program",
  "tests/database/fishing/academy-refund-execution.native.test.ts": "program",
  "tests/database/fishing/academy-refund-ordinary.native.test.ts": "program",
  "tests/database/fishing/academy-refund-preparation-ordinary.native.test.ts": "program",
  "tests/database/fishing/academy-refund-preparation.native.test.ts": "program",
  "tests/database/fishing/academy-refund.native.test.ts": "program",
  "tests/database/fishing/academy-safety-ordinary.native.test.ts": "program",
  "tests/database/fishing/academy-shared-calendar.native.test.ts": "program",
  "tests/database/fishing/academy-shared-service.native.test.ts": "program",
  "tests/database/fishing/academy-travel-credit.native.test.ts": "program",
  "tests/database/fishing/native-program.test.ts": "program",
  "tests/database/fishing/native-stripe-hosted.native.test.ts": "program",
  "tests/database/fishing/program-calendar-http.native.test.ts": "program",
  "tests/database/resources/classroom-family-retained-history-http.test.ts": "program",
  "tests/database/resources/classroom-family-withdrawal-http.test.ts": "program",
  "tests/database/resources/classroom-retained-history-native.test.ts": "program",
  "tests/database/resources/classroom-withdrawal-native.test.ts": "program",
  "tests/database/fishing/child-context-http.native.test.ts": "base",
  "tests/database/fishing/native-child-context.test.ts": "base",
  "tests/database/fishing/native-stripe-bindings.test.ts": "base",
  "tests/database/fishing/academy-schema-preflight.native.test.ts": "base",
  "tests/database/fishing/academy-group-calendar-publication-upgrade.native.test.ts": "base",
  "tests/database/fishing/academy-group-calendar-upgrade.native.test.ts": "base",
  "tests/database/fishing/academy-owner03-upgrade.native.test.ts": "base",
  "tests/database/fishing/academy-travel-credit-upgrade.native.test.ts": "base"
};
function git(args,input){return cp.execFileSync('git',args,{cwd:root,input,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe']});}
const tracked=git(['ls-files','-z','apps/life-skills/src','apps/life-skills/tests','apps/life-skills/scripts','apps/life-skills/migrations','apps/life-skills/package.json','apps/life-skills/package-lock.json','apps/life-skills/vitest.db.config.ts','apps/life-skills/tsconfig.json']).toString().split('\0').filter(Boolean);
const extra=['.github/workflows/pr-ci.yml','tools/ci/verify-ci-boundary.py','tools/ci/ci-native.cjs','tools/ci/native-ci-contract.cjs','tools/ci/native-ci-contract.d.cts','tools/ci/native-ci-contract.test.cjs','tools/ci/generate-native-ci-inventory.cjs','apps/life-skills/tests/database/native-ci-admission.ts','apps/life-skills/tests/unit/fishing/academy-calendar-fixture-times.test.ts'];
const inputs=[...new Set([...tracked,...extra])].sort();
if(inputs.some(p=>/[\r\n"]/.test(p)))throw Error('UNSUPPORTED_SOURCE_PATH');
const ids=git(['hash-object','-w','--stdin-paths'],inputs.join('\n')+'\n').toString().trim().split(/\r?\n/);
if(ids.length!==inputs.length||ids.some(x=>!/^[a-f0-9]{40}$/.test(x)))throw Error('GIT_SOURCE_IDS');
const batch=git(['cat-file','--batch'],ids.join('\n')+'\n');let offset=0;
const sources=inputs.map((p,i)=>{
 const end=batch.indexOf(10,offset),header=batch.subarray(offset,end).toString().split(' '),size=Number(header[2]);
 if(header[0]!==ids[i]||header[1]!=='blob'||!Number.isSafeInteger(size)||size<0)throw Error('GIT_SOURCE_BLOB');
 const bytes=batch.subarray(end+1,end+1+size);offset=end+size+2;
 return {path:p,sha256:c.sha(bytes)};
});
if(offset!==batch.length)throw Error('GIT_SOURCE_BATCH_TRAILER');
const suites=sources.filter(x=>/^apps\/life-skills\/tests\/database\/.+\.test\.ts$/.test(x.path)).map(x=>({path:x.path.slice('apps/life-skills/'.length),profile:profiles[x.path.slice('apps/life-skills/'.length)]||'ordinary'}));
const inventory={version:c.VERSION,sourceBundleSha256:c.sourceDigest(sources),sources,suites};
c.validateInventory(inventory,suites.map(x=>x.path));
fs.writeFileSync(path.join(__dirname,'native-ci-inventory.json'),JSON.stringify(inventory,null,2)+'\n');
process.stdout.write(JSON.stringify({sources:sources.length,suites:suites.length,native:suites.filter(x=>x.profile!=='ordinary').length})+'\n');

