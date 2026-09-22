import test from 'node:test';
import assert from 'node:assert/strict';
import {primaryNavigation,navigationGroups,settingsItems,workspaceHref,selectedCaseId,breadcrumbItems,activeItem,isCaseId} from '../../src/ui/workspace/navigation-model.ts';
import {updatePreference,preferenceFingerprint,duplicatePreferences,validQuietHours,type Preference} from '../../src/ui/workspace/preference-model.ts';
import {verifiedGoogleMeetUrl} from '../../src/features/calendar/meeting-url.ts';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
for(const locale of ['en','he'] as const){
 test(`${locale}: four parent destinations`,()=>{assert.equal(primaryNavigation.parent.length,4);assert.deepEqual(primaryNavigation.parent.map(x=>x.key),['home','practice','feedback','schedule']);});
 for(const role of ['parent','practitioner'] as const){
  test(`${locale}/${role}: unique, localized navigation`,()=>{const rows=[...primaryNavigation[role],...navigationGroups[role].flatMap(x=>x.items),...settingsItems(role)];assert.equal(new Set(rows.map(x=>x.path)).size,rows.length);assert.ok(rows.every(x=>x.en&&x.he));assert.ok(rows.every(x=>workspaceHref(locale,x.path,a).endsWith(`?caseId=${a}`)));});
  test(`${locale}/${role}: settings breadcrumbs`,()=>{const base=role==='parent'?'family':'app';const crumbs=breadcrumbItems(locale,role,`/${locale}/${base}/settings/notifications`);assert.equal(crumbs.length,3);assert.equal(crumbs[1]?.path,`${base}/settings`);assert.equal(crumbs[2]?.path,undefined);});
  test(`${locale}/${role}: settings root has no fabricated active subsection`,()=>{const base=role==='parent'?'family':'app';assert.equal(activeItem(`/${locale}/${base}/settings`,locale,role),undefined);assert.equal(breadcrumbItems(locale,role,`/${locale}/${base}/settings`).at(-1)?.path,undefined);});
 }
 test(`${locale}: case details selects Clients`,()=>{assert.equal(activeItem(`/${locale}/app/cases/${a}`,locale,'practitioner')?.key,'clients');assert.equal(breadcrumbItems(locale,'practitioner',`/${locale}/app/cases/${a}`).length,3);});
 test(`${locale}: settings never grant parent availability`,()=>{assert.ok(!settingsItems('parent').some(x=>x.key==='availability'));assert.ok(settingsItems('practitioner').some(x=>x.key==='availability'));});
}
test('case path wins over conflicting query context',()=>assert.equal(selectedCaseId(`/en/app/cases/${a}`,b),a));
test('valid query context survives ordinary navigation',()=>assert.equal(selectedCaseId('/en/family/forms',a),a));
test('invalid context is not propagated',()=>{for(const v of ['bad','../private',a+'x','',null])assert.equal(selectedCaseId('/en/app/calendar',v),null);});
test('UUID predicate does not accept arbitrary strings',()=>{assert.ok(isCaseId(a));assert.equal(isCaseId({id:a}),false);});
for(const path of ['https://evil.example','//evil.example','app/../private','app/settings?role=practitioner','app\\settings','javascript:alert(1)'])test(`reject unsafe navigation ${path}`,()=>assert.throws(()=>workspaceHref('en',path,a)));
const rows:Preference[]=[{eventType:'new_reply',channel:'email',enabled:false,locale:'en',timezone:'Asia/Jerusalem',quietStart:null,quietEnd:null},{eventType:'new_reply',channel:'whatsapp',enabled:false,locale:'en',timezone:'Asia/Jerusalem',quietStart:null,quietEnd:null}];
test('preference update changes one existing channel only',()=>{const next=updatePreference(rows,'new_reply','email',true);assert.equal(next[0]?.enabled,true);assert.equal(next[1]?.enabled,false);assert.equal(rows[0]?.enabled,false);});
test('missing row is not fabricated',()=>assert.deepEqual(updatePreference(rows,'practice_due','email',true),rows));
test('fingerprint is independent of provider ordering',()=>assert.equal(preferenceFingerprint(rows),preferenceFingerprint([...rows].reverse())));
test('fingerprint captures quiet-hour and channel changes',()=>assert.notEqual(preferenceFingerprint(rows),preferenceFingerprint(updatePreference(rows,'new_reply','email',true))));
test('duplicate rows detected',()=>{assert.equal(duplicatePreferences(rows),false);assert.equal(duplicatePreferences([...rows,rows[0]!]),true);});
for(const [start,end,expected] of [['','',true],['20:00','08:00',true],['08:00','12:00',true],['20:00','',false],['','08:00',false],['25:00','08:00',false],['09:00','09:00',false],['9:00','12:00',false],['09:61','12:00',false]] as const)test(`quiet hours ${start}/${end}`,()=>assert.equal(validQuietHours(start,end),expected));
for(const value of ['https://meet.google.com/abc-defg-hij','https://meet.google.com/abc-defg-hij/'])test(`valid meeting link ${value}`,()=>assert.equal(verifiedGoogleMeetUrl(value),value));
for(const value of [null,undefined,'','http://meet.google.com/abc-defg-hij','https://meet.google.com.evil.example/abc-defg-hij','https://u:p@meet.google.com/abc-defg-hij','https://meet.google.com:8443/abc-defg-hij','https://meet.google.com/abc-defg-hij?redirect=x','https://meet.google.com/abc-defg-hij#x','https://meet.google.com/','javascript:alert(1)','https://meet.google.com/abc-defg-hij/extra'])test(`unsafe/noncanonical meeting ${String(value)}`,()=>assert.equal(verifiedGoogleMeetUrl(value),null));
