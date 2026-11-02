import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {expect,test} from '@playwright/test';
import {syntheticChildFailure} from './synthetic-child-output.ts';

test('Trip390 interest and ordinary owner readback',async({},info)=>{
 test.setTimeout(300000);
 const project=info.project.name==='mobile'?'mobile390':info.project.name;
 const result=await promisify(execFile)(process.execPath,['--conditions=react-server','--import','tsx','tests/e2e/group-interest/run.ts'],{
  timeout:270000,maxBuffer:2*1024*1024,env:{...process.env,LS_GROUP_INTEREST_TEST_PROJECT:project,
   LS_GROUP_INTEREST_TEST_ALLOW:'true',LS_CALENDAR_TEST_ALLOW:'true',LS_ACADEMY_TRIP390_UI_ONLY:'true'},
 }).catch(error=>{const diagnostic=syntheticChildFailure(error);console.error(diagnostic);throw new Error(diagnostic);});
 expect(result.stdout).toContain('ACADEMY_TRIP390_BROWSER_ACCEPTANCE_PASS project='+project);
});
