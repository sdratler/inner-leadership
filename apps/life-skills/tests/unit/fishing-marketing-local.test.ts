import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {fishingMarketingSnapshotSchema as schema} from '../../src/features/fishing-marketing/contract.ts';
import {FishingMarketingPanel} from '../../src/features/fishing-marketing/panel.tsx';
import {localOutcome,localWorkerView} from '../../src/features/fishing-marketing/local-worker-panel.tsx';
import {localMarketingFixture} from '../fixtures/fishing-marketing-local.ts';

it('accepts current no-cap evidence while retaining conservative per-group admission',()=>{
 const s=localMarketingFixture();expect(schema.parse(s)).toEqual(s);
 for(const patch of [{dailyCap:5},{cooldownDays:7},{startHour:9},{wakeHours:[10,13]}])expect(schema.safeParse({...s,schedule:{...s.schedule,...patch}}).success).toBe(false);
 const target=s.targets[0]!;
 for(const patch of [{minimumGapDays:1},{visibility:'unknown'},{permission:'unknown'},{moderation:'approval_required'},{complete:false},{interval:'unknown'},
  {rulesUrl:'https://www.facebook.com/groups/other/about'},{rulesCheckedAt:'2026-11-11T00:00:00Z'},{nextEligibleAt:'2026-11-10T14:00:00Z'}]){
  expect(schema.safeParse({...s,targets:[{...target,campaign:{...target.campaign,...patch}}]}).success,JSON.stringify(patch)).toBe(false);
 }
 expect(schema.safeParse({...s,targets:[{...target,campaign:{...target.campaign,visibility:'private',permission:'explicit'}}]}).success).toBe(true);
 expect(schema.safeParse({...s,targets:[{...target,campaign:{...target.campaign,visibility:'private'}}]}).success).toBe(false);
 expect(schema.safeParse({...s,targets:[{...target,eligible:false,hold:'review',campaign:{...target.campaign,status:'held',nextEligibleAt:null}}]}).success).toBe(true);
});
it('rejects invented confirmed outcomes, future evidence and unsupported private data',()=>{
 const s=localMarketingFixture();
 for(const state of ['pending_admin_approval','declined_by_group','submission_unknown'])expect(schema.safeParse({...s,history:[{...s.history[0],state}]}).success).toBe(false);
 expect(schema.safeParse({...s,history:[{...s.history[0],postUrl:'https://www.facebook.com/groups/other/posts/456'}]}).success).toBe(false);
 expect(schema.safeParse({...s,history:[{...s.history[0],recordedAt:'2026-11-11T00:00:00Z'}]}).success).toBe(false);
 expect(schema.safeParse({...s,worker:{...s.worker,cookies:'forbidden'}}).success).toBe(false);
 expect(schema.safeParse({...s,worker:{...s.worker,login:{state:'verified',checkedAt:null}}}).success).toBe(false);
 expect(schema.safeParse({...s,worker:{...s.worker,login:{state:'verified',checkedAt:'2026-11-10T14:30:00Z'}}}).success).toBe(false);
 expect(schema.safeParse({...s,worker:{...s.worker,login:{state:'needs_login',checkedAt:null}}}).success).toBe(false);
 expect(schema.safeParse({...s,program:'bna'}).success).toBe(false);
});
it('does not upgrade unknown login, old activity or failed outcomes to a live healthy worker',()=>{
 const s=localMarketingFixture(),now=Date.parse(s.generatedAt);
 expect(localWorkerView(s,now)).toMatchObject({fresh:true,loginRecent:false,status:'idle',counts:{published:1,pending:1,declined:1,unknown:1},due:1});
 expect(localWorkerView(s,now+91*60_000)).toMatchObject({fresh:false,status:'stale',loginRecent:false});
 s.schedule.enabled=false;expect(localWorkerView(s,now).status).toBe('paused');s.schedule.enabled=true;
 s.worker.slot='reconcile_submission';expect(localWorkerView(s,now).status).toBe('reconcile');
 s.worker.account={state:'held',reason:'identity_review',detectedAt:s.generatedAt};s.worker.login={state:'needs_login',checkedAt:null};expect(localWorkerView(s,now).status).toBe('needs_login');
 expect(localOutcome({state:'pending_admin_approval',publicationEvidence:'browser_readback'})).toBe('pending');
});
it('renders distinct outcomes, rules, real links and manual text in EN and HE without cross-program management',()=>{
 const snapshot=localMarketingFixture();
 for(const locale of ['en','he'] as const){
  const html=renderToStaticMarkup(createElement(FishingMarketingPanel,{locale,data:{snapshot,receivedAt:snapshot.generatedAt},renderedAt:Date.parse(snapshot.generatedAt)}));
  expect(html).toContain(`dir="${locale==='he'?'rtl':'ltr'}"`);expect(html).toContain('name="marketingState"');expect(html).toContain('value="declined"');expect(html).toContain('value="unknown"');
  expect(html).toContain(locale==='en'?'No total daily cap':'ללא מגבלה יומית כוללת');expect(html).toContain(locale==='en'?'Current login is unknown':'מצב הכניסה הנוכחי אינו ידוע');
  expect(html).toContain(locale==='en'?'Declined by group':'נדחה על ידי הקבוצה');expect(html).toContain(locale==='en'?'Pending moderator approval':'ממתין לאישור מנהל הקבוצה');
  expect(html).toContain('href="https://www.facebook.com/groups/123/about"');expect(html).toContain('href="https://www.facebook.com/groups/991/posts/456"');expect(html).toContain('rel="noreferrer"');
  expect(html).toContain('&lt;script&gt;');expect(html).toContain('&lt;img');expect(html).not.toContain('<script>');expect(html).not.toContain('<img');
  expect(html).toContain('readOnly=""');expect(html).toContain('id="fishing-copy-he"');expect(html).not.toContain('marketingProgram');expect(html).not.toContain('BNA');expect(html).not.toContain('Start worker');
 }
});
it('filters declined and unknown separately and never calls their links verified',()=>{
 const snapshot=localMarketingFixture();snapshot.history[2]!.postUrl='https://www.facebook.com/groups/993/posts/457';
 const html=renderToStaticMarkup(createElement(FishingMarketingPanel,{locale:'en',data:{snapshot,receivedAt:snapshot.generatedAt},filters:{state:'declined'},renderedAt:Date.parse(snapshot.generatedAt)}));
 expect(html).toContain('Open recorded link');expect(html).not.toContain('Open verified post');expect(html).toContain('/groups/993/posts/457');expect(html).not.toContain('/groups/991/posts/456');
 for(const filters of [{program:'bna'},{channel:'page'}])expect(renderToStaticMarkup(createElement(FishingMarketingPanel,{locale:'en',data:{snapshot,receivedAt:snapshot.generatedAt},filters}))).not.toContain('Synthetic approved');
});
it('shows absent and failed reads honestly, with a real retry and no false zero counts',()=>{
 for(const unavailable of [false,true])for(const locale of ['en','he'] as const){
  const html=renderToStaticMarkup(createElement(FishingMarketingPanel,{locale,data:null,unavailable,section:'content_calendar'}));
  expect(html).toContain('href="?section=content_calendar"');expect(html).toContain('role="status"');expect(html).toContain(`dir="${locale==='he'?'rtl':'ltr'}"`);expect(html).not.toContain('lsw-credit-number');
 }
});

it('keeps a stopped run and its required action in the first status block',()=>{
 const snapshot=localMarketingFixture();snapshot.worker.lastRun={id:'synthetic-run',startedAt:'2026-11-10T14:50:00Z',evidenceAt:'2026-11-10T14:59:00Z',endedAt:null,state:'stopped',reason:'composer_unavailable',groupId:'123'};
 const now=Date.parse(snapshot.generatedAt);expect(localWorkerView(snapshot,now).status).toBe('needs_review');
 const html=renderToStaticMarkup(createElement(FishingMarketingPanel,{locale:'en',data:{snapshot,receivedAt:snapshot.generatedAt},renderedAt:now}));
 expect(html.indexOf('Last run needs review')).toBeLessThan(html.indexOf('Facebook login'));
 expect(html.indexOf('The group composer did not open')).toBeLessThan(html.indexOf('Facebook login'));
 snapshot.worker.publisher='busy';expect(localWorkerView(snapshot,now).status).toBe('running');
});
it('bounds visible history without hiding the matching count or inventing missing outcomes',()=>{
 const snapshot=localMarketingFixture();snapshot.history=Array.from({length:53},(_,i)=>({...snapshot.history[0]!,id:(i+1).toString(16).padStart(64,'0')}));
 const html=renderToStaticMarkup(createElement(FishingMarketingPanel,{locale:'en',data:{snapshot,receivedAt:snapshot.generatedAt},renderedAt:Date.parse(snapshot.generatedAt)}));
 expect(html.match(/<li>/g)).toHaveLength(50);expect(html).toContain('Showing the latest 50 of 53 matching records');
 expect(localWorkerView(snapshot,Date.parse(snapshot.generatedAt)).counts.published).toBe(53);
});
