import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createInquiryEmailControlAdmission, EMAIL_CONTROL_ADMISSION, EMAIL_CONTROL_SENDER,
 emailControlDigest, inquiryEmailControlAllows, inquiryEmailControlRequestAllowed, inquiryEmailControlSecurityLifetimeMs,
 inquiryEmailControlSourceFiles, loadInquiryEmailControlAdmission, type EmailControlContext } from '../../src/features/group-application/academy-inquiry-email-control-admission.ts';
vi.mock('server-only',() => ({}));
const now = new Date('2040-01-02T03:00:00Z'), workspace = randomUUID(), ref = randomUUID(), recipient = 'synthetic@example.invalid';
const targets = {workspaceId:workspace,projectId:randomUUID(),environmentId:randomUUID(),serviceId:randomUUID(),origin:'https://bneineviimacademy.org'};
const hashes = Object.fromEntries(Object.keys(inquiryEmailControlSourceFiles).map(k => [k,emailControlDigest(k)]));
const context:EmailControlContext = {...targets,sourceCommit:'a'.repeat(40),releaseCommit:'a'.repeat(40),sourceHashes:hashes,
 enabled:true,queueEnabled:true,freeOff:true,founderOff:true,genericOff:true,oldAckOff:true,backendOrigin:'https://life-skills.bneineviimacademy.org',officeGmail:true,securityLifetimeMs:600000};
const base = {...targets,version:EMAIL_CONTROL_ADMISSION,purpose:'fishing_inquiry_email_control_v1',sourceCommit:context.sourceCommit,sourceHashes:hashes,
 approvalReceiptSha256:'b'.repeat(64),sender:EMAIL_CONTROL_SENDER,securityLifetimeMs:600000,notBefore:'2040-01-02T01:59:00Z',admittedAt:'2040-01-02T02:00:00Z'};
const controlled = {...base,expiresAt:'2040-01-02T03:30:00Z',population:{mode:'controlled_test',requests:[{reference:ref,recipientSha256:emailControlDigest(recipient)}]}};
const future = {...base,expiresAt:null,population:{mode:'future_requests'}};
describe('signup email verification admission',() => {
 it('denies absent settings and distinguishes the security token lifetime from a payment deadline',() => {
  expect(loadInquiryEmailControlAdmission({},now)).toBeNull();
  for (const value of ['', '0','999','1e4','86400001','-1000',' 1000']) expect(inquiryEmailControlSecurityLifetimeMs({LS_ACADEMY_INQUIRY_EMAIL_CONTROL_SECURITY_LIFETIME_MS:value})).toBeNull();
  for (const value of ['1000','86400000']) expect(inquiryEmailControlSecurityLifetimeMs({LS_ACADEMY_INQUIRY_EMAIL_CONTROL_SECURITY_LIFETIME_MS:value})).toBe(Number(value));
 });
 it.each(['enabled','queueEnabled','freeOff','genericOff','founderOff','oldAckOff','officeGmail'] as const)('requires the separate current %s boundary',key => {
  expect(createInquiryEmailControlAdmission(future,{...context,[key]:false},now)).toBeNull();
 });
 it.each(['releaseCommit','sourceCommit','workspaceId','projectId','environmentId','serviceId','origin','backendOrigin','securityLifetimeMs'] as const)('denies %s mismatch',key => {
  expect(createInquiryEmailControlAdmission(future,{...context,[key]:key === 'securityLifetimeMs' ? 1200 : 'different'},now)).toBeNull();
 });
 it('rejects changed/missing/injected file pins and older purposes',() => {
  const {gmail,...rest} = hashes; expect(gmail).toBeDefined();
  for (const sourceHashes of [rest,{...hashes,formatter:'c'.repeat(64)},{...hashes,unapproved:'b'.repeat(64)}])
   expect(createInquiryEmailControlAdmission({...future,sourceHashes},context,now)).toBeNull();
  expect(createInquiryEmailControlAdmission({...future,purpose:'trip390_reservation_acknowledgment'},context,now)).toBeNull();
 });
 it('binds actual issued policy, explicit recipient and reference, finite test time and new-save cutoff',() => {
  const admitted = createInquiryEmailControlAdmission(controlled,context,now)!;
  const request = {reference:ref,recipient,savedAt:new Date(base.notBefore)};
  expect(inquiryEmailControlRequestAllowed(admitted,workspace,request,now)).toBe(true);
  expect(inquiryEmailControlRequestAllowed({...admitted},workspace,request,now)).toBe(false);
  expect(inquiryEmailControlRequestAllowed(admitted,workspace,{...request,reference:randomUUID()},now)).toBe(false);
  expect(inquiryEmailControlRequestAllowed(admitted,workspace,{...request,recipient:'someone@example.invalid'},now)).toBe(false);
  expect(inquiryEmailControlRequestAllowed(admitted,workspace,{...request,savedAt:new Date(Date.parse(base.notBefore)-1)},now)).toBe(false);
  expect(inquiryEmailControlAllows(admitted,workspace,new Date(controlled.expiresAt))).toBe(false);
  expect(createInquiryEmailControlAdmission({...controlled,expiresAt:null},context,now)).toBeNull();
  expect(createInquiryEmailControlAdmission({...controlled,expiresAt:'2040-01-02T04:00:00.001Z'},context,now)).toBeNull();
 });
 it('admits only approved future saves from the same target and valid time',() => {
  const admitted = createInquiryEmailControlAdmission(future,context,now)!;
  const f = {reference:ref,recipient,savedAt:now};
  expect(inquiryEmailControlRequestAllowed(admitted,workspace,f,now)).toBe(true);
  expect(inquiryEmailControlRequestAllowed(admitted,randomUUID(),f,now)).toBe(false);
  expect(inquiryEmailControlRequestAllowed(admitted,workspace,{...f,savedAt:new Date(now.getTime()+1)},now)).toBe(false);
 });
});
