import {createHash} from 'node:crypto';
export * from './academy-agreement-contract.ts';
import {academyAgreementBundleSchema,academyAgreementAcceptanceSchema,type AcademyAgreementBundle} from './academy-agreement-contract.ts';
export const agreementHash=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
export function readAcademyAgreementBundle(raw:unknown):AcademyAgreementBundle|null{
 const parsed=academyAgreementBundleSchema.safeParse(raw);if(!parsed.success)return null;const b=parsed.data;
 if([b.legalOperator,...b.releasedParties].some(v=>/\b(TBD|TODO|placeholder|name of released|synthetic)\b|[<>\[\]]/i.test(v)))return null;
 if(b.statutoryWarning!==b.statutoryWarning.toUpperCase()||!b.statutoryWarning.startsWith('NOTICE TO THE MINOR CHILD')||!b.releasedParties.every(v=>b.statutoryWarning.includes(v.toUpperCase())))return null;
 if(new Set(b.documents.map(d=>d.kind+':'+d.language)).size!==10||b.documents.some(d=>agreementHash(d.body)!==d.sha256))return null;
 return b;
}
export function verifyAcademyAgreementAcceptance(bundle:AcademyAgreementBundle,raw:unknown){
 const b=readAcademyAgreementBundle(bundle),a=academyAgreementAcceptanceSchema.parse(raw);if(!b||a.bundleVersion!==b.version)throw Error('AGREEMENT_REVIEW_REQUIRED');
 const expected=b.documents.filter(d=>d.language===a.language);
 if(new Set(a.documentRefs.map(d=>d.kind)).size!==5||expected.some(d=>!a.documentRefs.some(v=>v.kind===d.kind&&v.version===d.version&&v.sha256===d.sha256)))throw Error('AGREEMENT_REVIEW_REQUIRED');
 return a;
}
/** New source hashes cover both the displayed contract and all translations,
 * versions, identities and review references. Legacy body hashes stay readable. */
export function academyTermsHash(terms:{document?:{body:string}|undefined;owner03Bundle?:AcademyAgreementBundle|undefined}){
 // Schema parsing gives imports and database readback the same field order.
 // Historical terms without a bundle retain their original body-only hash.
 return terms.owner03Bundle?agreementHash(JSON.stringify({body:terms.document?.body??'',bundle:academyAgreementBundleSchema.parse(terms.owner03Bundle)})):agreementHash(terms.document?.body??'');
}
