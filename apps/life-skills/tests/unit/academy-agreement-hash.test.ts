import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {academyAgreementBundleSchema,academyTermsHash,agreementHash} from '../../src/features/fishing/academy-agreements.ts';
import {agreementBundleFixture} from '../fixtures/academy-agreements.ts';

describe('imported Academy agreement source hash',()=>{
 it('survives schema parsing and JSON object-key reordering without changing the approved content',()=>{
  const bundle=agreementBundleFixture(),body='Fixture terms body';
  const parsed=academyAgreementBundleSchema.parse(bundle);
  const reordered={...bundle,documents:bundle.documents.map(d=>({sha256:d.sha256,body:d.body,language:d.language,version:d.version,kind:d.kind}))};
  expect(academyTermsHash({document:{body},owner03Bundle:bundle})).toBe(academyTermsHash({document:{body},owner03Bundle:parsed}));
  expect(academyTermsHash({document:{body},owner03Bundle:reordered})).toBe(academyTermsHash({document:{body},owner03Bundle:parsed}));
 });
 it('binds document bytes, operator identity and bundle version',()=>{
  const bundle=agreementBundleFixture(),terms={document:{body:'Fixture terms body'},owner03Bundle:bundle},original=academyTermsHash(terms);
  const changed=structuredClone(bundle);changed.documents[0]!.body+=' changed';changed.documents[0]!.sha256=agreementHash(changed.documents[0]!.body);
  expect(academyTermsHash({...terms,owner03Bundle:changed})).not.toBe(original);
  expect(academyTermsHash({...terms,owner03Bundle:{...bundle,legalOperator:'Different Fixture Corporation'}})).not.toBe(original);
  expect(academyTermsHash({...terms,owner03Bundle:{...bundle,version:'different-version'}})).not.toBe(original);
 });
 it('preserves historical body-only source hashes exactly',()=>{
  const body='Historical body\nגוף מסמך';
  expect(academyTermsHash({document:{body}})).toBe(createHash('sha256').update(body,'utf8').digest('hex'));
 });
 it('rejects a malformed bundle rather than hashing an unreviewable source',()=>{
  const bundle=agreementBundleFixture();bundle.documents.pop();
  expect(()=>academyTermsHash({document:{body:'Fixture'},owner03Bundle:bundle})).toThrow();
 });
});
