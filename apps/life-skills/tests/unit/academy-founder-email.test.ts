import {test} from 'vitest';
import assert from 'node:assert/strict';
import {founderEmailContent,isAnnouncementR00,R00_ANNOUNCEMENT_CLOCK,type FounderMail} from '../../src/features/group-application/academy-founder-email.ts';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import exactCopy from '../../src/features/group-application/academy-exact-email-copy.json';
import {floridaDeadline} from '../../src/features/group-application/academy-founder-contract.ts';
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
const make=(templateId:keyof typeof kinds,locale:'en'|'he'='en',status:FounderMail['status']='reserved'):FounderMail=>({...base,locale,status,kind:kinds[templateId],transactional:{version,templateId,parentFirstName:'Ari',...(templateId==='R00'?{r00Exception:{version:R00_ANNOUNCEMENT_CLOCK,approvalReceiptSha256:'caeab55524e61c98273b01c9884f15b707e502bc6e145360ebf4575ba55bde3a'}}:{acceptedSend}),confirmed:templateId==='R03',founderRateReserved:status==='reserved'}});
test('exact bilingual catalog preserves packet provenance and adds the current clock amendment',()=>{
 const bytes=readFileSync(new URL('../../src/features/group-application/academy-exact-email-copy.json',import.meta.url));
 assert.equal(createHash('sha256').update(bytes.toString('utf8').replace(/\r\n/g,'\n')).digest('hex'),'250632ed159824f47fcd8d44d2ef2fbb636ffc4544ef0715666917950942d82b');
 assert.equal(exactCopy.sourceSha256,'771152d0aef0550bd369ea132b472e5bfcc1d44514ebb7815c1e47a7abd41466');
 assert.deepEqual(exactCopy.amendment,{version:R00_ANNOUNCEMENT_CLOCK,approvalReceiptSha256:'caeab55524e61c98273b01c9884f15b707e502bc6e145360ebf4575ba55bde3a'});
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
  assert.ok(!actual.text.includes(floridaDeadline(acceptedSend.deadline,locale)));
  assert.ok(!actual.text.includes('{interest_deadline_eastern}'));
  assert.ok(actual.html.includes('dir="'+(locale==='he'?'rtl':'ltr')+'"'));
  assert.ok(!actual.html.includes('<script'));
 });
}
test('interest reminders stay distinct and contain no confirmation deadline',()=>{
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
test('R00 has no initial clock and reminders require actual initial-send provenance only',()=>{
 const p=make('R00');assert.equal(p.transactional!.acceptedSend,undefined);assert.equal(isAnnouncementR00(p),true);
 assert.ok(!founderEmailContent(p,'https://bneineviimacademy.org').text.includes('Confirm by'));
 p.transactional!.acceptedSend=acceptedSend;assert.throws(()=>founderEmailContent(p,'https://bneineviimacademy.org'),/ANNOUNCEMENT_CLOCK_REQUIRED/);
 for(const id of ['R01','R02'] as const){const reminder=make(id);const original=founderEmailContent(reminder,'https://bneineviimacademy.org');
  reminder.transactional!.acceptedSend={sentAt:acceptedSend.sentAt};assert.deepEqual(founderEmailContent(reminder,'https://bneineviimacademy.org'),original);
  reminder.transactional!.acceptedSend={sentAt:acceptedSend.sentAt,deadline:'obsolete-not-an-expiry'};assert.deepEqual(founderEmailContent(reminder,'https://bneineviimacademy.org'),original);
  delete reminder.transactional!.acceptedSend;assert.throws(()=>founderEmailContent(reminder,'https://bneineviimacademy.org'),/ACCEPTED_SEND_REQUIRED/);
  reminder.transactional!.acceptedSend={sentAt:'2026-02-30T16:00:00.000Z'};assert.throws(()=>founderEmailContent(reminder,'https://bneineviimacademy.org'),/ACCEPTED_SEND_REQUIRED/);
 }
});
test('new payloads reject kind, version, token and untrusted origin mismatches',()=>{
 const p=make('R01');p.kind='payment_reminder';assert.throws(()=>founderEmailContent(p,'https://bneineviimacademy.org'),/KIND_MISMATCH/);
 const wrong=make('R00');(wrong.transactional as {version:string}).version='old';assert.throws(()=>founderEmailContent(wrong,'https://bneineviimacademy.org'),/VERSION_REQUIRED/);
 const tokenless=make('R00');delete tokenless.token;assert.throws(()=>founderEmailContent(tokenless,'https://bneineviimacademy.org'),/TOKEN_REQUIRED/);
 for(const origin of ['http://bneineviimacademy.org','https://attacker.invalid','https://user@bneineviimacademy.org','https://bneineviimacademy.org/path'])assert.throws(()=>founderEmailContent(make('R00'),origin),/ORIGIN_INVALID/);
});
test('legacy signup rendering never leaks obsolete deadlines or gains a new payload identity',()=>{
 const old=founderEmailContent(base,'https://bneineviimacademy.org');
 assert.deepEqual(Object.keys(old),['subject','text']);
 assert.equal(old.subject,'Confirm your free Fishing Academy registration');
 assert.ok(old.text.startsWith('Hello,\n\nYour Jewish Leadership Fishing Academy registration reference is synthetic-reference'));
 assert.ok(old.text.includes('Once we announce it'));
 assert.ok(!old.text.includes('after this email is successfully sent'));
 assert.throws(()=>founderEmailContent({...base,kind:'interest_deadline_receipt',deadline:acceptedSend.deadline},'https://bneineviimacademy.org'),/INTEREST_DEADLINE_SUPERSEDED/);
});

test('current announcement copy is exact in the chosen language and old receipt identities fail closed',()=>{
 for(const locale of ['en','he'] as const){const p=make('R00',locale);const actual=founderEmailContent(p,'https://bneineviimacademy.org');
  const sentence=locale==='en'?"We expect to announce the start date within the next couple of weeks. Once we announce it, you’ll have seven days to pay and secure your place.":"אנו מצפים להודיע על מועד הפתיחה בשבועיים הקרובים. מרגע שנודיע עליו, יהיו לכם שבעה ימים לשלם ולהבטיח את מקומכם.";
  assert.ok(actual.text.includes(sentence));assert.ok(!actual.text.includes(floridaDeadline(acceptedSend.deadline,locale)));
  assert.equal(actual.subject,exactCopy.locales[locale].templates.R00.subject);assert.equal(p.transactional!.r00Exception!.version,R00_ANNOUNCEMENT_CLOCK);
  for(const bad of [{version:'JLFA-R00-RELATIVE-SEND-CLOCK-20261027-01',approvalReceiptSha256:'7dfc71f18f0f853bb11f4bc1de0547484c13a9bbfa1f82eeab30d0eaf95aca87'},{version:R00_ANNOUNCEMENT_CLOCK,approvalReceiptSha256:'f'.repeat(64)}]){
   const q=structuredClone(p);q.transactional!.r00Exception=bad as NonNullable<NonNullable<FounderMail['transactional']>['r00Exception']>;assert.equal(isAnnouncementR00(q),false);assert.throws(()=>founderEmailContent(q,'https://bneineviimacademy.org'),/ANNOUNCEMENT_CLOCK_REQUIRED/);
  }
  const missing=structuredClone(p);delete missing.transactional!.r00Exception;assert.throws(()=>founderEmailContent(missing,'https://bneineviimacademy.org'),/ANNOUNCEMENT_CLOCK_REQUIRED/);
 }
 for(const id of ['R01','R02','R03'] as const){const p=make(id);p.transactional!.r00Exception=make('R00').transactional!.r00Exception!;assert.throws(()=>founderEmailContent(p,'https://bneineviimacademy.org'),/ANNOUNCEMENT_CLOCK_REQUIRED/);}
});

test('exact EN/HE action is a readable email-safe button link with escaped text and unchanged plain body',()=>{
 for(const locale of ['en','he'] as const){const p=make('R00',locale);p.transactional!.parentFirstName='<Ari & \"test\">';const result=founderEmailContent(p,'https://bneineviimacademy.org') as {text:string;html:string};
  assert.ok(result.html.includes('dir="'+(locale==='he'?'rtl':'ltr')+'"'));assert.ok(result.html.includes('&lt;Ari &amp; &quot;test&quot;&gt;'));assert.ok(!result.html.includes('<Ari'));
  const link=result.html.match(/<a href="([^"]+)" style="([^"]+)">([^<]+)<\/a>/);assert.ok(link);assert.ok(link[1]!.endsWith('/confirm-interest#'+token));for(const value of ['background-color:#FDC844','color:#041858','min-height:48px','border-radius:8px','font-size:16px','padding:12px 24px'])assert.ok(link[2]!.includes(value));
  const expected=exactCopy.locales[locale].templates.R00.blocks.map(b=>b.text.replace('{parent_first_name}',p.transactional!.parentFirstName!).replace('{reservation_sentence}',exactCopy.locales[locale].reservationSentences.reserved).replace('{interest_deadline_eastern}',floridaDeadline(acceptedSend.deadline,locale))+(b.kind==='action'?': https://bneineviimacademy.org'+(locale==='he'?'/he':'')+'/fishing-academy/confirm-interest#'+token:'')).join('\n\n');assert.equal(result.text,expected);assert.ok(!result.html.includes('<script'));assert.ok(!result.text.includes('style='));
 }
});
