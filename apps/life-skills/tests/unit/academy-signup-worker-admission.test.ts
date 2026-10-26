import {describe,it,expect} from 'vitest';
import {createSignupWorkerAdmission,assertSignupWorkerAdmission,signupRecipientDigest,signupWorkerFamilyAllowed,signupWorkerMessageAllowed,signupWorkerReferences} from '../../src/features/group-application/academy-signup-worker-admission.ts';
const ids={workspaceId:'11111111-1111-4111-8111-111111111111',projectId:'22222222-2222-4222-8222-222222222222',environmentId:'33333333-3333-4333-8333-333333333333',serviceId:'44444444-4444-4444-8444-444444444444'};
const now=new Date('2026-10-25T12:00:00Z');
const context={...ids,enabled:true,freeEnabled:true,sendEnabled:true,founderApproved:true,sourceCommit:'a'.repeat(40),releaseCommit:'a'.repeat(40),origin:'https://bneineviimacademy.org',templateModuleSha256:'b'.repeat(64),templateContractSha256:'c'.repeat(64),templateCatalogSha256:'e'.repeat(64),templateFacadeSha256:'f'.repeat(64),templateVersion:'JLFA-EXACT-COPY-20261026-05',transportHashes:{gmail:'1'.repeat(64),contract:'2'.repeat(64),resend:'3'.repeat(64)}};
const policy={...ids,version:'JLFA-SIGNUP-WORKER-ADMISSION-v2',approvalReceiptSha256:'d'.repeat(64),sourceCommit:context.sourceCommit,origin:context.origin,sender:'office@bneineviimacademy.org',templateModuleSha256:context.templateModuleSha256,templateContractSha256:context.templateContractSha256,templateCatalogSha256:context.templateCatalogSha256,templateFacadeSha256:context.templateFacadeSha256,templateVersion:context.templateVersion,allowedTemplateIds:['R01','R02','R03'],transportHashes:context.transportHashes,cutoff:'2026-10-25T11:00:00.000Z',expiresAt:'2026-10-26T11:00:00.000Z',population:{mode:'future_submissions'}};
const family={reference:'55555555-5555-4555-8555-555555555555',submittedAt:policy.cutoff,email:'synthetic@example.invalid'};
describe('closed signup worker admission',()=>{
 it('rejects missing/unknown policy fields and each disabled effect flag',()=>{
  for(const p of [undefined,{}, {...policy,extra:true},{...policy,sender:'other@example.invalid'},{...policy,cutoff:'bad'}])expect(createSignupWorkerAdmission(p,context,now)).toBeNull();
  for(const key of ['enabled','freeEnabled','sendEnabled','founderApproved'] as const)expect(createSignupWorkerAdmission(policy,{...context,[key]:false},now)).toBeNull();
 });
 it('requires exact source, release, target, origin and both template module bindings',()=>{
  for(const key of ['sourceCommit','releaseCommit','workspaceId','projectId','environmentId','serviceId','origin','templateModuleSha256','templateContractSha256','templateCatalogSha256','templateFacadeSha256','templateVersion'] as const)expect(createSignupWorkerAdmission(policy,{...context,[key]:'wrong'},now)).toBeNull();
 });
 it('requires a current finite window and rejects future submissions or old families',()=>{
  expect(createSignupWorkerAdmission({...policy,cutoff:'2026-10-26T11:00:00.000Z'},context,now)).toBeNull();
  expect(createSignupWorkerAdmission({...policy,expiresAt:now.toISOString()},context,now)).toBeNull();
  const a=createSignupWorkerAdmission(policy,context,now)!;
  expect(signupWorkerFamilyAllowed(a,family,now)).toBe(true);
  expect(signupWorkerFamilyAllowed(a,{...family,submittedAt:'2026-10-25T10:59:59.999Z'},now)).toBe(false);
  expect(signupWorkerFamilyAllowed(a,{...family,submittedAt:'2026-10-25T12:00:00.001Z'},now)).toBe(false);
  expect(()=>assertSignupWorkerAdmission(a,ids.workspaceId,new Date(policy.expiresAt))).toThrow('SIGNUP_WORKER_NOT_ADMITTED');
 });
 it('binds reference mode to the exact stored recipient and preserves the cutoff',()=>{
  const p={...policy,population:{mode:'references',families:[{reference:family.reference,recipientSha256:signupRecipientDigest(family.email)}]}};
  const a=createSignupWorkerAdmission(p,context,now)!;
  expect(signupWorkerFamilyAllowed(a,family,now)).toBe(true);
  expect(signupWorkerFamilyAllowed(a,{...family,email:'other@example.invalid'},now)).toBe(false);
  expect(signupWorkerFamilyAllowed(a,{...family,reference:ids.workspaceId},now)).toBe(false);
  expect(signupWorkerFamilyAllowed(a,{...family,submittedAt:'2026-10-24T11:00:00.000Z'},now)).toBe(false);
  expect(createSignupWorkerAdmission({...p,population:{...p.population,families:[...p.population.families,...p.population.families]}},context,now)).toBeNull();
 });
 it('freezes issued authority and rejects serialized/forged or cross-workspace copies',()=>{
  const a=createSignupWorkerAdmission(policy,context,now)!;
  expect(Object.isFrozen(a)).toBe(true);expect(Object.isFrozen(a.population)).toBe(true);
  expect(()=>assertSignupWorkerAdmission({...a},ids.workspaceId,now)).toThrow('SIGNUP_WORKER_NOT_ADMITTED');
  expect(()=>assertSignupWorkerAdmission(a,ids.projectId,now)).toThrow('SIGNUP_WORKER_NOT_ADMITTED');
 });
});

describe('exact05 content and transport admission is additive and closed',()=>{
 it('rejects old policy version, missing catalog/facade and every transport mismatch',()=>{
  expect(createSignupWorkerAdmission({...policy,version:'JLFA-SIGNUP-WORKER-ADMISSION-v1'},context,now)).toBeNull();
  for(const key of ['templateCatalogSha256','templateFacadeSha256'] as const)expect(createSignupWorkerAdmission({...policy,[key]:undefined},context,now)).toBeNull();
  for(const key of ['gmail','contract','resend'] as const)expect(createSignupWorkerAdmission(policy,{...context,transportHashes:{...context.transportHashes,[key]:'4'.repeat(64)}},now)).toBeNull();
  for(const key of ['enabled','freeEnabled','sendEnabled','founderApproved'] as const)for(const value of [undefined,'true',1])expect(createSignupWorkerAdmission(policy,{...context,[key]:value} as unknown as typeof context,now)).toBeNull();
 });
 it('cannot admit R00, unknown IDs, duplicate IDs or an empty allowlist',()=>{
  for(const ids of [[],['R00'],['R01','R00'],['R04'],['R03','R03']])expect(createSignupWorkerAdmission({...policy,allowedTemplateIds:ids},context,now)).toBeNull();
 });
 it('accepts only already-recorded exact identity in the approved subset, never legacy inference',()=>{
  const a=createSignupWorkerAdmission({...policy,allowedTemplateIds:['R03']},context,now)!;
  const identity={version:context.templateVersion,templateId:'R03',templateCatalogSha256:context.templateCatalogSha256};
  expect(signupWorkerMessageAllowed(a,identity,now)).toBe(true);
  for(const message of [undefined,{}, {...identity,templateId:'R00'},{...identity,templateId:'R01'},{...identity,templateCatalogSha256:'0'.repeat(64)},{...identity,version:'legacy'},{...identity,extra:true}])expect(signupWorkerMessageAllowed(a,message,now)).toBe(false);
  expect(signupWorkerMessageAllowed({...a},identity,now)).toBe(false);
  expect(signupWorkerMessageAllowed(a,identity,new Date(policy.expiresAt))).toBe(false);
  expect(signupWorkerMessageAllowed(a,identity,new Date('invalid'))).toBe(false);
  expect(signupWorkerMessageAllowed(a,identity,new Date('2026-10-25T10:59:59.999Z'))).toBe(false);
 });
 it('issued authority cannot be changed through original inputs or returned reference lists',()=>{
  const input=structuredClone({...policy,population:{mode:'references',families:[{reference:family.reference,recipientSha256:signupRecipientDigest(family.email)}]}});
  const a=createSignupWorkerAdmission(input,context,now)!;input.allowedTemplateIds.length=0;input.transportHashes.gmail='4'.repeat(64);input.population.families[0]!.recipientSha256='0'.repeat(64);
  expect(a.allowedTemplateIds).toEqual(['R01','R02','R03']);expect(a.transportHashes.gmail).toBe(context.transportHashes.gmail);expect(signupWorkerFamilyAllowed(a,family,now)).toBe(true);
  expect(Object.isFrozen(a.allowedTemplateIds)).toBe(true);expect(Object.isFrozen(a.transportHashes)).toBe(true);
  const refs=signupWorkerReferences(a)!;refs.length=0;expect(signupWorkerReferences(a)).toEqual([family.reference]);
 });
});
