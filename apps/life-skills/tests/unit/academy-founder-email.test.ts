import {test} from 'vitest';
import assert from 'node:assert/strict';
import {founderEmailContent,type FounderMail} from '../../src/features/group-application/academy-founder-email.ts';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import exactCopy from '../../src/features/group-application/academy-exact-email-copy.json';
import {floridaCalendarDays,floridaDeadline} from '../../src/features/group-application/academy-founder-contract.ts';
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

const acceptedSend={sentAt:'2026-10-30T16:00:00.000Z',deadline:'2026-11-06T17:00:00.000Z'};
const version='JLFA-EXACT-COPY-20261026-05' as const;
const kinds={R00:'interest',R01:'interest_reminder',R02:'interest_reminder',R03:'ack'} as const;
const make=(templateId:keyof typeof kinds,locale:'en'|'he'='en',status:FounderMail['status']='reserved'):FounderMail=>({...base,locale,status,kind:kinds[templateId],transactional:{version,templateId,parentFirstName:'Ari',acceptedSend,confirmed:templateId==='R03',founderRateReserved:status==='reserved'}});
test('exact bilingual template artifact remains bound to the reviewed packet extraction',()=>{
 const bytes=readFileSync(new URL('../../src/features/group-application/academy-exact-email-copy.json',import.meta.url));
 assert.equal(createHash('sha256').update(bytes.toString('utf8').replace(/\r\n/g,'\n')).digest('hex'),'175d4bbc87d94d2632c6a1be0092784ad14e4eb7dbc25825c6ec0106d2f3e1ea');
 assert.equal(exactCopy.sourceSha256,'771152d0aef0550bd369ea132b472e5bfcc1d44514ebb7815c1e47a7abd41466');
});
for(const locale of ['en','he'] as const)for(const id of ['R00','R01','R02','R03'] as const)for(const status of ['reserved','interest_list','pending_verification'] as const){
 test(`${locale}/${id}/${status} uses only exact transactional copy and runtime evidence`,()=>{
  const message=founderEmailContent(make(id,locale,status),'https://bneineviimacademy.org');
  const copy=exactCopy.locales[locale],template=copy.templates[id];
  assert.equal(message.subject,template.subject);assert.ok('preview' in message&&'html' in message);
  const actual=message as {subject:string;text:string;preview:string;html:string};
  assert.equal(actual.preview,template.preview.replace('{interest_deadline_eastern}',floridaDeadline(acceptedSend.deadline,locale)));
  assert.ok(!/\{(?:parent_first_name|reservation_sentence|interest_deadline_eastern|confirmed_founder_sentence)\}/.test(actual.text));
  assert.equal((actual.html.match(/<a /g)??[]).length,id==='R03'?0:1);
  assert.equal(actual.text.includes(copy.confirmedFounderSentence),id==='R03'&&status==='reserved');
  if(id==='R00')assert.ok(actual.text.includes(copy.reservationSentences[status]));
  if(id!=='R03')assert.ok(actual.text.includes(floridaDeadline(acceptedSend.deadline,locale)));
  assert.ok(actual.html.includes('dir="'+(locale==='he'?'rtl':'ltr')+'"'));
  assert.ok(!actual.html.includes('<script'));
 });
}
test('day three and day six remain distinct templates with the same accepted deadline',()=>{
 const day3=founderEmailContent(make('R01'),'https://bneineviimacademy.org'),day6=founderEmailContent(make('R02'),'https://bneineviimacademy.org');
 assert.notEqual(day3.subject,day6.subject);assert.notEqual(day3.text,day6.text);
 assert.ok(day3.text.includes('Are you still interested'));assert.ok(day6.text.includes("I haven't received"));
});
test('missing name uses exact fallback and dynamic HTML is escaped',()=>{
 for(const locale of ['en','he'] as const){
  const p=make('R03',locale);delete p.transactional!.parentFirstName;
  assert.ok(founderEmailContent(p,'https://bneineviimacademy.org').text.startsWith(locale==='he'?'שלום,':'Hi,'));
 }
 const p=make('R03');p.transactional!.parentFirstName='<img src=x onerror=alert(1)>';
 const result=founderEmailContent(p,'https://bneineviimacademy.org') as {html:string};
 assert.ok(result.html.includes('&lt;img'));assert.ok(!result.html.includes('<img'));
});
test('an allocated-looking status alone never adds confirmed-founder or acknowledgement claims',()=>{
 const p=make('R03');delete p.transactional!.founderRateReserved;
 assert.ok(!founderEmailContent(p,'https://bneineviimacademy.org').text.includes(exactCopy.locales.en.confirmedFounderSentence));
 delete p.transactional!.confirmed;
 assert.throws(()=>founderEmailContent(p,'https://bneineviimacademy.org'),/CONFIRMATION_REQUIRED/);
});
test('R00 cannot silently start its clock at queue or reservation time',()=>{
 const p=make('R00');delete p.transactional!.acceptedSend;
 assert.throws(()=>founderEmailContent(p,'https://bneineviimacademy.org'),/ACCEPTED_SEND_REQUIRED/);
 p.transactional!.acceptedSend={...acceptedSend,deadline:'2026-11-06T16:59:59.000Z'};
 assert.throws(()=>founderEmailContent(p,'https://bneineviimacademy.org'),/DEADLINE_MISMATCH/);
 p.transactional!.acceptedSend={...acceptedSend,deadline:'2026-11-06T17:00:01.000Z'};
 assert.throws(()=>founderEmailContent(p,'https://bneineviimacademy.org'),/DEADLINE_MISMATCH/);
 p.transactional!.acceptedSend={sentAt:'2026-02-30T16:00:00.000Z',deadline:'2026-03-09T16:00:00.000Z'};
 assert.throws(()=>founderEmailContent(p,'https://bneineviimacademy.org'),/ACCEPTED_SEND_REQUIRED/);
 assert.equal(floridaCalendarDays(new Date(acceptedSend.sentAt),7).toISOString(),acceptedSend.deadline);
});
test('new payloads reject kind, version, token and untrusted origin mismatches',()=>{
 const p=make('R01');p.kind='payment_reminder';assert.throws(()=>founderEmailContent(p,'https://bneineviimacademy.org'),/KIND_MISMATCH/);
 const wrong=make('R00');(wrong.transactional as {version:string}).version='old';assert.throws(()=>founderEmailContent(wrong,'https://bneineviimacademy.org'),/VERSION_REQUIRED/);
 const tokenless=make('R00');delete tokenless.token;assert.throws(()=>founderEmailContent(tokenless,'https://bneineviimacademy.org'),/TOKEN_REQUIRED/);
 for(const origin of ['http://bneineviimacademy.org','https://attacker.invalid','https://user@bneineviimacademy.org','https://bneineviimacademy.org/path'])assert.throws(()=>founderEmailContent(make('R00'),origin),/ORIGIN_INVALID/);
});
test('legacy queued payloads do not acquire a new template, language, preheader or HTML',()=>{
 const old=founderEmailContent(base,'https://bneineviimacademy.org');
 assert.deepEqual(Object.keys(old),['subject','text']);
 assert.equal(old.subject,'Confirm your free Fishing Academy registration');
 assert.ok(old.text.startsWith('Hello,\n\nYour Jewish Leadership Fishing Academy registration reference is synthetic-reference'));
 assert.ok(old.text.includes('seven calendar days after this email is successfully sent'));
});

test('conditional R00 exception replaces only the approved-relative sentence and leaves exact05 catalog untouched',()=>{
 const receipt='e'.repeat(64);
 for(const locale of ['en','he'] as const){
  const p=make('R00',locale);delete p.transactional!.acceptedSend;
  p.transactional!.r00Exception={version:'JLFA-R00-RELATIVE-SEND-CLOCK-20261027-01',approvalReceiptSha256:receipt};
  const actual=founderEmailContent(p,'https://bneineviimacademy.org') as {subject:string;text:string;preview:string;html:string};
  const relative=locale==='en'?'You have seven calendar days after this email is successfully sent. Your exact Florida deadline appears on the confirmation page.':'לרשותכם שבעה ימים קלנדריים לאחר שליחת הודעה זו בהצלחה. המועד המדויק לפי שעון פלורידה מופיע בעמוד האישור.';
  const original=locale==='en'?'Confirm by {interest_deadline_eastern}.':'יש לאשר עד {interest_deadline_eastern}.';
  const copy=exactCopy.locales[locale],template=copy.templates.R00;
  const expected=template.blocks.map(b=>b.text.replace(original,relative).replace('{parent_first_name}','Ari').replace('{reservation_sentence}',copy.reservationSentences.reserved)+(b.kind==='action'?': https://bneineviimacademy.org'+(locale==='he'?'/he':'')+'/fishing-academy/confirm-interest#'+token:'')).join('\n\n');
  assert.equal(actual.text,expected);assert.equal(actual.subject,template.subject);assert.equal(actual.preview,template.preview);
  assert.ok(actual.html.includes(relative));assert.equal((actual.html.match(/<a /g)??[]).length,1);
  assert.ok(!actual.text.includes('{interest_deadline_eastern}'));assert.ok(!actual.text.includes(floridaDeadline(acceptedSend.deadline,locale)));
 }
});
test('conditional exception rejects a fabricated clock, wrong identity, missing receipt and use on other templates',()=>{
 const p=make('R00');p.transactional!.r00Exception={version:'JLFA-R00-RELATIVE-SEND-CLOCK-20261027-01',approvalReceiptSha256:'e'.repeat(64)};
 assert.throws(()=>founderEmailContent(p,'https://bneineviimacademy.org'),/EXCEPTION_INVALID/);
 delete p.transactional!.acceptedSend;p.transactional!.r00Exception.approvalReceiptSha256='';
 assert.throws(()=>founderEmailContent(p,'https://bneineviimacademy.org'),/EXCEPTION_INVALID/);
 p.transactional!.r00Exception.approvalReceiptSha256='e'.repeat(64);(p.transactional!.r00Exception as {version:string}).version='unreviewed';
 assert.throws(()=>founderEmailContent(p,'https://bneineviimacademy.org'),/EXCEPTION_INVALID/);
 for(const id of ['R01','R02','R03'] as const){const other=make(id);other.transactional!.r00Exception={version:'JLFA-R00-RELATIVE-SEND-CLOCK-20261027-01',approvalReceiptSha256:'e'.repeat(64)};assert.throws(()=>founderEmailContent(other,'https://bneineviimacademy.org'),/EXCEPTION_INVALID/);}
});

test('exact EN/HE action is a readable email-safe button link with escaped text and unchanged plain body',()=>{
 for(const locale of ['en','he'] as const){const p=make('R00',locale);p.transactional!.parentFirstName='<Ari & \"test\">';const result=founderEmailContent(p,'https://bneineviimacademy.org') as {text:string;html:string};
  assert.ok(result.html.includes('dir="'+(locale==='he'?'rtl':'ltr')+'"'));assert.ok(result.html.includes('&lt;Ari &amp; &quot;test&quot;&gt;'));assert.ok(!result.html.includes('<Ari'));
  const link=result.html.match(/<a href="([^"]+)" style="([^"]+)">([^<]+)<\/a>/);assert.ok(link);assert.ok(link[1]!.endsWith('/confirm-interest#'+token));for(const value of ['background-color:#FDC844','color:#041858','min-height:48px','border-radius:8px','font-size:16px','padding:12px 24px'])assert.ok(link[2]!.includes(value));
  const expected=exactCopy.locales[locale].templates.R00.blocks.map(b=>b.text.replace('{parent_first_name}',p.transactional!.parentFirstName!).replace('{reservation_sentence}',exactCopy.locales[locale].reservationSentences.reserved).replace('{interest_deadline_eastern}',floridaDeadline(acceptedSend.deadline,locale))+(b.kind==='action'?': https://bneineviimacademy.org'+(locale==='he'?'/he':'')+'/fishing-academy/confirm-interest#'+token:'')).join('\n\n');assert.equal(result.text,expected);assert.ok(!result.html.includes('<script'));assert.ok(!result.text.includes('style='));
 }
});
