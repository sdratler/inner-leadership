import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe,expect,it } from 'vitest';
import { INQUIRY_EMAIL_CONTROL_MIGRATIONS as selected } from '../../src/db/inquiry-email-control-history.ts';
import { owner305Hash,type Owner305ReleaseQuery } from '../../src/db/owner-305-schema-release.ts';
import { assertInquirySchemaApply,assertInquirySchemaProof,assertInquirySchemaProgress,expectedInquiryCatalog,inquiryEmailSchemaPlan,
 inquirySchemaProof,inquirySchemaTarget,inquirySchemaTargetBinding,readInquiryEmailCatalog,type InquirySchemaProof,type InquirySchemaStage } from '../../src/db/inquiry-email-control-schema-release.ts';

const manifest=JSON.parse(readFileSync('migrations/manifest.json','utf8')) as {name:string;sha256:string}[];
const currentFiles=manifest.map(f=>({name:f.name,checksum:f.sha256,sql:readFileSync('migrations/'+f.name,'utf8')}));
// The already-used 151/152 operator remains bound to its exact historical source inventory.
const files=currentFiles.slice(0,72);
const history=(prefix:number,installed:InquirySchemaStage=0)=>[...files.slice(0,prefix),...files.slice(70,70+installed)].map(({name,checksum})=>({name,checksum}));
const git='a'.repeat(40),deployment=randomUUID(),h=(s:string)=>owner305Hash(s);
const syntheticEnv={RAILWAY_PROJECT_ID:inquirySchemaTarget.projectId,RAILWAY_ENVIRONMENT_ID:inquirySchemaTarget.environmentId,
 RAILWAY_SERVICE_ID:inquirySchemaTarget.appServiceId,RAILWAY_DEPLOYMENT_ID:deployment,RAILWAY_GIT_COMMIT_SHA:git,LIFE_SKILLS_RELEASE_COMMIT:git,
 LS_APP_ORIGIN:inquirySchemaTarget.appOrigin,LS_DATABASE_TLS:'verify-full',LS_DATABASE_CA:'SYNTHETIC-CA',
 LS_DATABASE_URL:'postgresql://synthetic:synthetic@postgres.railway.internal:5432/railway',LS_INQUIRY_EMAIL_CONTROL_SCHEMA_APPLY_APPROVED:'true'};
const target={...inquirySchemaTargetBinding(syntheticEnv),sourceSha256:h('operator'),manifestSha256:h('manifest'),databaseSystemIdentifier:'12345'};
const baseline=h(JSON.stringify(history(67))),beforeCatalog=h('start'),now=new Date('2035-01-06T12:30:00Z');
function proof():InquirySchemaProof {
 return inquirySchemaProof.parse({kind:'fishing_inquiry_email_control_schema_v1',approvalId:randomUUID(),approvalReceiptSha256:h('approved'),
  projectId:inquirySchemaTarget.projectId,environmentId:inquirySchemaTarget.environmentId,appServiceId:inquirySchemaTarget.appServiceId,databaseServiceId:inquirySchemaTarget.databaseServiceId,
  deploymentId:target.deploymentId,mergedCommit:git,mergeReceiptSha256:h('merge'),protectedCiReceiptSha256:h('CI'),manifestSha256:target.manifestSha256,
  sourceSha256:target.sourceSha256,databaseBindingSha256:target.databaseBindingSha256,baselineStage:0,baselineLedgerSha256:baseline,baselineCatalogSha256:beforeCatalog,
  notBefore:'2035-01-06T12:00:00Z',expiresAt:'2035-01-06T13:00:00Z',receiptDirectory:'/synthetic/private',
  backup:{receiptId:'synthetic-backup',receiptSha256:h('backup-receipt'),archiveSha256:h('archive'),readbackAt:'2035-01-06T10:00:00Z',databaseSystemIdentifier:target.databaseSystemIdentifier},
  isolatedRestore:{sourceReceiptId:'synthetic-backup',receiptId:'synthetic-restore',receiptSha256:h('restore-receipt'),isolatedTargetReceiptSha256:h('restore-target'),
   archiveSha256:h('archive'),verifiedAt:'2035-01-06T11:00:00Z',verified:true,baselineLedgerSha256:baseline,
   baselineCatalogSha256:beforeCatalog,previousObjectsPreserved:true,stages:selected.map(m=>({...m,catalogSha256:h(m.name)}))},
  rollback:{receiptSha256:h('rollback'),reviewed:true,description:'Synthetic reviewed offline rollback procedure.'}});
}

describe('selected verification schema',()=>{
 it('pins the historical72 source and rejects the broadened current73 inventory',()=>{
  expect(currentFiles).toHaveLength(73);
  expect(h(JSON.stringify(manifest.slice(0,72)))).toBe('e09c4a9d43608609aaf83ca391168b60d4d7604a816c9744e50d73371134d3af');
  expect(()=>inquiryEmailSchemaPlan(currentFiles,history(67),0)).toThrow();
 });
 it.each([67,70])('selects only 151 and 152 after the exact %i-entry prefix',prefix=>{
  const list=inquiryEmailSchemaPlan(files,history(prefix),0);
  expect(list.pending.map(f=>f.name)).toEqual(selected.map(f=>f.name));
  expect(list.ledgerSha256).toBe(h(JSON.stringify(history(prefix))));
  expect(list.pending.some(f=>/^01(48|49|50)_/.test(f.name))).toBe(false);
 });
 it.each([67,70])('recognizes 151-only and completed/idempotent 152 at prefix %i',prefix=>{
  expect(inquiryEmailSchemaPlan(files,history(prefix,1),1).pending.map(f=>f.name)).toEqual([selected[1].name]);
  expect(inquiryEmailSchemaPlan(files,history(prefix,2),2).pending).toEqual([]);
 });
 it.each([66,68,69])('denies partial or different predecessor %i',prefix=>{
  for(const stage of [0,1,2] as const)expect(()=>inquiryEmailSchemaPlan(files,history(prefix,stage),stage)).toThrow();
 });
 it('denies foreign ledger rows, a gap in the selected pair, duplicate history or an inconsistent physical stage',()=>{
  const base=history(67),a={name:selected[0].name,checksum:selected[0].sha256},b={name:selected[1].name,checksum:selected[1].sha256};
  for(const rows of [[...base,{name:'0153_unknown.sql',checksum:h('foreign')}],[...base,b],[...base,a,a],[...base,b,a]])expect(()=>inquiryEmailSchemaPlan(files,rows,1)).toThrow();
  expect(()=>inquiryEmailSchemaPlan(files,[...base,a],0)).toThrow();
  expect(()=>inquiryEmailSchemaPlan(files,base,1)).toThrow();
 });
 it.each([0,66,67,68,69,70,71])('refuses actual source SQL or coordinated SQL+checksum drift at index %i',index=>{
  const sql=files[index]!.sql+'\n-- synthetic drift';
  for(const checksum of [files[index]!.checksum,h(sql)]){
   const changed=files.map((f,i)=>i===index?{...f,sql,checksum}:f);
   expect(()=>inquiryEmailSchemaPlan(changed,history(67),0)).toThrow();
  }
 });
 it('rejects reordered, missing, extra, or altered installed files',()=>{
  expect(()=>inquiryEmailSchemaPlan([...files].reverse(),history(67),0)).toThrow();
  expect(()=>inquiryEmailSchemaPlan(files.slice(0,-1),history(67),0)).toThrow();
  expect(()=>inquiryEmailSchemaPlan([...files,{name:'0153_fixture.sql',sql:'select 1',checksum:h('select 1')}],history(67),0)).toThrow();
  const drift=history(70);drift[68]!.checksum=h('different applied bytes');
  expect(()=>inquiryEmailSchemaPlan(files,drift,0)).toThrow();
 });
});
describe('exact release and finite approval',()=>{
 it.each(['RAILWAY_PROJECT_ID','RAILWAY_ENVIRONMENT_ID','RAILWAY_SERVICE_ID','LS_APP_ORIGIN','RAILWAY_DEPLOYMENT_ID','RAILWAY_GIT_COMMIT_SHA','LIFE_SKILLS_RELEASE_COMMIT','LS_DATABASE_TLS','LS_DATABASE_CA'] as const)('rejects wrong %s before any DB connection',key=>{
  expect(()=>inquirySchemaTargetBinding({...syntheticEnv,[key]:''})).toThrow();
 });
 it.each(['postgresql://synthetic:synthetic@elsewhere:5432/railway','postgresql://synthetic:synthetic@postgres.railway.internal/railway','postgresql://synthetic:synthetic@postgres.railway.internal:5432/other','postgresql://synthetic:synthetic@postgres.railway.internal:5432/railway?sslmode=disable','postgresql://postgres.railway.internal:5432/railway'])('rejects a different or weakened synthetic binding #%#',url=>{
  expect(()=>inquirySchemaTargetBinding({...syntheticEnv,LS_DATABASE_URL:url})).toThrow();
 });
 it('binds approved restore stages and historical catalogs without selecting deferred migrations',()=>{
  const p=proof();expect(()=>assertInquirySchemaProof(p,target)).not.toThrow();
  expect(expectedInquiryCatalog(p,0)).toBe(beforeCatalog);
  expect(expectedInquiryCatalog(p,1)).toBe(h(selected[0].name));expect(expectedInquiryCatalog(p,2)).toBe(h(selected[1].name));
  p.baselineStage=1;p.baselineLedgerSha256=h(JSON.stringify(history(67,1)));p.isolatedRestore.baselineLedgerSha256=p.baselineLedgerSha256;
  p.baselineCatalogSha256=h(selected[0].name);p.isolatedRestore.baselineCatalogSha256=p.baselineCatalogSha256;
  p.isolatedRestore.stages=p.isolatedRestore.stages.slice(1);
  expect(()=>assertInquirySchemaProof(p,target)).not.toThrow();expect(()=>expectedInquiryCatalog(p,0)).toThrow();
 });
 it.each(['deploymentId','mergedCommit','databaseBindingSha256','sourceSha256','manifestSha256','databaseSystemIdentifier'] as const)('denies proof/source target mismatch %s',key=>{
  expect(()=>assertInquirySchemaProof(proof(),{...target,[key]:'different'})).toThrow();
 });
 it('reconciles a partial commit read-only and requires a new exact proof before a 152-only apply',()=>{
  const p=proof(),rows=history(67,1),partial={...inquiryEmailSchemaPlan(files,rows,1),history:rows,catalogSha256:h(selected[0].name)};
  expect(()=>assertInquirySchemaProgress(p,partial)).not.toThrow();
  expect(()=>assertInquirySchemaProgress(p,partial,true)).toThrow('NEW_BASELINE_PROOF_REQUIRED');
  p.baselineStage=1;p.baselineCatalogSha256=partial.catalogSha256;p.baselineLedgerSha256=partial.ledgerSha256;
  p.isolatedRestore.baselineCatalogSha256=p.baselineCatalogSha256;p.isolatedRestore.baselineLedgerSha256=p.baselineLedgerSha256;
  p.isolatedRestore.stages.shift();
  expect(()=>assertInquirySchemaProof(p,target)).not.toThrow();expect(()=>assertInquirySchemaProgress(p,partial,true)).not.toThrow();
  expect(()=>assertInquirySchemaProgress(p,{...partial,catalogSha256:h('drift')},true)).toThrow();
  const complete=history(67,2);
  expect(()=>assertInquirySchemaProgress(p,{...inquiryEmailSchemaPlan(files,complete,2),history:complete,catalogSha256:h(selected[1].name)},true)).not.toThrow();
 });
 it.each(['backup receipt','archive','ledger','catalog','selected SQL','missing 152','restore before backup','reversed window'] as const)('rejects %s evidence mismatch',change=>{
  const p=proof(),r=p.isolatedRestore;
  if(change==='backup receipt')r.sourceReceiptId='different';
  else if(change==='archive')r.archiveSha256=h('different');
  else if(change==='ledger')r.baselineLedgerSha256=h('different');
  else if(change==='catalog')r.baselineCatalogSha256=h('different');
  else if(change==='selected SQL')r.stages[0]!.sha256=files[67]!.checksum;
  else if(change==='missing 152')r.stages.pop();
  else if(change==='restore before backup')r.verifiedAt='2035-01-05T10:00:00Z';
  else p.expiresAt=p.notBefore;
  expect(()=>assertInquirySchemaProof(p,target)).toThrow();
 });
 it('requires separate apply authorization, the reviewed time window, a current backup and inactive new runtime',()=>{
  const p=proof();
  expect(()=>assertInquirySchemaApply(p,syntheticEnv,now)).not.toThrow();
  expect(()=>assertInquirySchemaApply(p,{...syntheticEnv,LS_INQUIRY_EMAIL_CONTROL_SCHEMA_APPLY_APPROVED:''},now)).toThrow();
  for(const key of ['LS_ACADEMY_INQUIRY_EMAIL_CONTROL_ENABLED','LS_ACADEMY_INQUIRY_EMAIL_CONTROL_QUEUE_ENABLED'])expect(()=>assertInquirySchemaApply(p,{...syntheticEnv,[key]:'true'},now)).toThrow();
  for(const at of [new Date('2035-01-06T11:59:59Z'),new Date(p.expiresAt),new Date(NaN)])expect(()=>assertInquirySchemaApply(p,syntheticEnv,at)).toThrow();
  p.backup.readbackAt='2034-12-29T10:00:00Z';expect(()=>assertInquirySchemaApply(p,syntheticEnv,now)).toThrow();
 });
});
describe('read-only catalog classification',()=>{
 type Flags={base:boolean;verification:boolean;column:boolean;guard:boolean;uniqueIndex:boolean};
 function fake(flags:Flags,entries=[{kind:'column',name:'outbox.example',definition:'text'}]):Owner305ReleaseQuery{
  return {query:async <T extends object>(sql:string)=>({rows:(sql.includes('AS verification')?[flags]:entries) as T[]})};
 }
 const initial={base:true,verification:false,column:false,guard:false,uniqueIndex:false};
 it('classifies each complete stage and binds changes in actual catalog definitions',async()=>{
  for(const stage of [0,1,2]){
   const flags={base:true,verification:stage>0,column:stage===2,guard:stage===2,uniqueIndex:stage===2};
   const result=await readInquiryEmailCatalog(fake(flags));expect(result.stage).toBe(stage);
   expect((await readInquiryEmailCatalog(fake(flags,[{kind:'column',name:'outbox.example',definition:'changed'}]))).catalogSha256).not.toBe(result.catalogSha256);
  }
 });
 it('denies partial schema artifacts without making a repair',async()=>{
  for(const flags of [{...initial,base:false},{...initial,guard:true},{...initial,verification:true,uniqueIndex:true}])await expect(readInquiryEmailCatalog(fake(flags))).rejects.toThrow();
 });
});
