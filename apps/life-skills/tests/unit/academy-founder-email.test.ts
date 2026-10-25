import {test} from 'vitest';
import assert from 'node:assert/strict';
import {founderEmailContent,type FounderMail} from '../../src/features/group-application/academy-founder-email.ts';
const token='synthetic_'.padEnd(43,'x');
const base:FounderMail={familyId:'synthetic-family',generation:1,kind:'interest',locale:'en',to:'synthetic@example.invalid',reference:'synthetic-reference',status:'reserved',token};
for(const origin of ['https://life-skills.bneineviimacademy.org','https://bneineviimacademy.org'])for(const locale of ['en','he'] as const){
 test(`Academy ${locale} confirmation mail uses public domain from ${origin}`,()=>{
  for(const kind of ['interest','interest_reminder'] as const){
   const mail=founderEmailContent({...base,locale,kind},origin);
   const links=mail.text.match(/https:\/\/\S+/g);
   assert.deepEqual(links,[`https://bneineviimacademy.org${locale==='he'?'/he':''}/fishing-academy/confirm-interest#${token}`]);
   const link=new URL(links![0]!);assert.equal(link.search,'');assert.equal(link.hash,'#'+token);
  }
 });
}
test('local fixture confirmation stays on its own origin and creates no production link',()=>{
 const mail=founderEmailContent({...base,locale:'he'},'https://127.0.0.1:44555');
 assert.ok(mail.text.includes('https://127.0.0.1:44555/he/florida/confirm-interest#'+token));
 assert.ok(!mail.text.includes('bneineviimacademy.org'));
});
test('acknowledgment adds no confirmation action or payment link',()=>{
 const mail=founderEmailContent({...base,kind:'ack'},'https://life-skills.bneineviimacademy.org');
 assert.ok(!mail.text.includes(token));assert.ok(!mail.text.includes('https://'));assert.match(mail.text,/No payment is due/);
});
