'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {tmpdir}=require('node:os');
const path=require('node:path');const c=require('./native-ci-contract.cjs');
function fixture(){
 const hex='a'.repeat(32),nonce='b'.repeat(64),root=path.join(tmpdir(),'ls-native-ci-'+'c'.repeat(32));
 const inventory={version:c.VERSION,sourceBundleSha256:'d'.repeat(64),suites:[{path:'tests/database/native.test.ts',profile:'base'}]};
 const target={version:c.VERSION,suite:inventory.suites[0].path,profile:'base',database:'ls_native_ci_'+hex+'_test',role:'ls_native_ci_'+hex,nonceSha256:c.sha(nonce),sourceBundleSha256:inventory.sourceBundleSha256,serverAddress:'172.17.0.2',serverPort:5432,clientAddress:'172.17.0.1',artifactDirectory:path.join(root,hex),roleOid:'21',databaseOid:'22',preparedCatalogSha256:'e'.repeat(64)};
 const env={CI:'true',LS_APP_MODE:'foundation_locked',LS_DATABASE_TLS:'disable',LS_DATABASE_URL:c.ADMIN_URL,LS_MIGRATION_DATABASE_URL:c.MIGRATION_URL,LS_TEST_DATABASE_URL:c.ADMIN_URL,LS_NATIVE_CI_ADMISSION:c.VERSION,LS_NATIVE_CI_TARGET:JSON.stringify(target),LS_NATIVE_CI_NONCE:nonce,LS_NATIVE_CI_ARTIFACT_ROOT:root,TEST_DATABASE_URL:'postgresql://'+target.role+':synthetic@127.0.0.1:5432/'+target.database};
 return {env,inventory,target};
}
test('no CI admission record leaves private execution entirely separate',()=>assert.equal(c.parseTarget({},{}),null));
test('closed inventory rejects source digest tampering, missing or duplicate suites and invalid profiles',()=>{
 const suites=Array.from({length:127},(_,n)=>({path:'tests/database/case'+n+'.test.ts',profile:n<80?'ordinary':'base'}));
 const sources=suites.map(s=>({path:'apps/life-skills/'+s.path,sha256:'a'.repeat(64)}));
 const inventory={version:c.VERSION,suites,sources,sourceBundleSha256:c.sourceDigest(sources)},files=suites.map(x=>x.path);
 assert.equal(c.validateInventory(inventory,files),inventory);
 for(const change of [{sourceBundleSha256:'0'.repeat(64)},{sources:[...sources,{...sources[0]}]},{suites:suites.slice(1)},{suites:[...suites.slice(1),suites[1]]},{suites:suites.map((s,n)=>n===0?{...s,profile:'unknown'}:s)}])assert.throws(()=>c.validateInventory({...inventory,...change},files),/NATIVE_CI_/);
 assert.throws(()=>c.validateInventory(inventory,files.slice(1)),/SUITE_INVENTORY/);
});
test('only an exact process/URL/nonce/profile/source/artifact record parses',()=>{
 const f=fixture();assert.equal(c.parseTarget(f.env,f.inventory).serverAddress,'172.17.0.2');
 for(const change of [{CI:'false'},{LS_DATABASE_TLS:'require'},{DATABASE_URL:c.ADMIN_URL},{BUFFER_API_KEY:'not-a-real-key'},{LS_NATIVE_CI_NONCE:'0'.repeat(64)},{TEST_DATABASE_URL:c.MIGRATION_URL}])assert.throws(()=>c.parseTarget({...f.env,...change},f.inventory),/NATIVE_CI_/);
 for(const change of [{profile:'ordinary'},{role:'synthetic'},{sourceBundleSha256:'0'.repeat(64)},{artifactDirectory:path.dirname(f.target.artifactDirectory)},{databaseOid:'wrong'},{serverAddress:'999.1.1.1'},{extra:true}])assert.throws(()=>c.parseTarget({...f.env,LS_NATIVE_CI_TARGET:JSON.stringify({...f.target,...change})},f.inventory),/NATIVE_CI_/);
});
test('actual database ownership, server identity, role privilege or marker drift denies',async()=>{
 const f=fixture(),row={database_oid:'22',database:f.target.database,database_owner:f.target.role,role:f.target.role,role_oid:'21',rolsuper:false,rolcreatedb:false,rolcanlogin:true,rolcreaterole:false,rolreplication:false,rolbypassrls:false,rolinherit:true,database_marker:c.marker(f.target),role_marker:c.marker(f.target),server_address:f.target.serverAddress,server_port:5432,client_address:f.target.clientAddress};
 await c.verifyOwnedTarget({query:async()=>({rows:[row]})},f.target);
 for(const change of [{database_owner:'other'},{rolsuper:true},{rolcreatedb:true},{database_marker:'other'},{role_marker:'other'},{server_address:'172.17.0.9'},{client_address:'127.0.0.1'},{database_oid:'23'},{rolcreaterole:true},{rolbypassrls:true}])await assert.rejects(c.verifyOwnedTarget({query:async()=>({rows:[{...row,...change}]})},f.target),/ACTUAL_(?:OWNED_TARGET|ROLE_PRIVILEGES)/);
});
test('HBA uses the first matching actual client/database/role rule, never password_encryption alone',()=>{
 const i={database:'owned',role:'owned_role',clientAddress:'172.17.0.1'},rule=(address,netmask,auth_method)=>({type:'host',database:['all'],user_name:['all'],address,netmask,auth_method,error:null});
 assert.equal(c.hbaUsesScram([rule('127.0.0.1','255.255.255.255','trust'),rule('all',null,'scram-sha-256')],i),true);
 assert.equal(c.hbaUsesScram([rule('all',null,'trust'),rule('all',null,'scram-sha-256')],i),false);
 assert.equal(c.hbaUsesScram([rule('192.168.0.0','255.255.0.0','scram-sha-256')],i),false);
 assert.equal(c.hbaUsesScram([rule('::1','ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff','trust'),rule('all',null,'scram-sha-256')],i),true);
});
test('coverage rejects missing/duplicate/unexpected/zero suites; skipped and failed assertions cannot pass',()=>{
 const names=['tests/database/a.test.ts','tests/database/b.test.ts'];const file=(name,status='passed')=>({name:'/repo/apps/life-skills/'+name,assertionResults:[{status}]});
 const reports=[{testResults:names.map(n=>file(n))}];assert.deepEqual(c.accountReports(names,reports),{files:2,passed:2,failed:0,skipped:0,accepted:true});
 assert.throws(()=>c.accountReports(names,[{testResults:[file(names[0])]}]),/MISSING_SUITES/);
 assert.throws(()=>c.accountReports(names,[{testResults:[file(names[0]),file(names[0])]}]),/RESULT_SUITE/);
 assert.throws(()=>c.accountReports(names,[{testResults:[file('tests/database/other.test.ts')]}]),/RESULT_SUITE/);
 assert.throws(()=>c.accountReports(names,[{testResults:[{name:'/repo/'+names[0],assertionResults:[]}]}]),/ZERO_ASSERTIONS/);
 assert.equal(c.accountReports(names,[{testResults:[file(names[0],'pending'),file(names[1])]}]).accepted,false);
 assert.equal(c.accountReports(names,[{testResults:[file(names[0],'failed'),file(names[1])]}]).accepted,false);
});
