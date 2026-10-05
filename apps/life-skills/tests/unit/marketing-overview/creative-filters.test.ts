import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {MarketingDashboard} from '../../../src/ui/revamp/marketing-dashboard.tsx';
import {actionableCreative,creativeFilters,creativeMetadataOptions,creativePlacement,creativeReviewState,filterCreatives,creativePage} from '../../../src/features/marketing-overview/creative-filters.ts';
import type {CreativeVersion,MarketingSnapshot} from '../../../src/features/marketing-overview/contracts.ts';
const asset=(patch:Partial<CreativeVersion>={}):CreativeVersion=>({assetId:'DEMO-one',revision:1,locale:'he',width:1080,height:1350,imageUrl:null,title:'DEMO — שלום',caption:'First public caption',contentDigest:'a'.repeat(64),approvedDigest:null,review:'draft',surface:'FACEBOOK_FEED',...patch});
describe('registered creative filters',()=>{
 it.each(['en','he'] as const)('keeps the %s gallery compact without losing selected controls or hiding inventory failures',locale=>{
  const snapshot:MarketingSnapshot={source:'registry_only',fetchedAt:null,creatives:[asset()],publications:[],ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:'unbound'},inventoryReadback:{status:'error',lastSuccessfulReadAt:null,lastAttemptAt:'2026-10-05T14:00:00Z',errorCode:'creative_inventory_unavailable'},connectionErrors:['direct_meta_readback_unavailable','creative_inventory_unavailable']};
  const html=renderToStaticMarkup(createElement(MarketingDashboard,{locale,snapshot,initialSection:'creatives',creativeQuery:{language:'he',concept:'3',search:'DEMO'},renderedAt:'2026-10-05T14:00:00Z'}));
  expect(html).toContain('<details class="lsr-creative-primary-filters"><summary>');expect(html).not.toContain('<details class="lsr-creative-primary-filters" open');
  expect(html.indexOf('name="search"')).toBeLessThan(html.indexOf('class="lsr-creative-primary-filters"'));expect(html).toContain('value="DEMO"');expect(html).toContain('value="he" selected');expect(html).toContain('value="3" selected');
  const sourceStart=html.indexOf('<details class="lsr-source-detail"'),sourceEnd=html.indexOf('</details>',sourceStart),failure=locale==='he'?'מלאי הקריאייטיב אינו זמין כרגע.':'Creative inventory is temporarily unavailable.';
  expect(sourceStart).toBeGreaterThan(-1);expect(html.slice(sourceStart,sourceEnd)).toContain(locale==='he'?'נתוני Meta הישירים אינם זמינים כרגע':'Direct Meta metrics are temporarily unavailable');expect(html.indexOf(failure)).toBeGreaterThan(sourceEnd);
  expect(html).not.toContain('class="lsr-inventory-readback"');expect(html).not.toContain('<h2>');expect(html.match(/type="submit"/g)).toHaveLength(1);
 });
 it.each(['en','he'] as const)('does not pretend an older bridge supplied an empty %s secondary catalog',locale=>{
  const snapshot:MarketingSnapshot={source:'synthetic',fetchedAt:null,creatives:[asset()],publications:[],ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:'unbound'}};
  const html=renderToStaticMarkup(createElement(MarketingDashboard,{locale,snapshot,initialSection:'creatives',creativeQuery:{collection:'history'},renderedAt:'2026-10-05T14:00:00Z'}));expect(html).toContain(locale==='he'?'לא סיפק את המלאי המשני':'has not supplied the secondary catalog');expect(html).not.toContain(locale==='he'?'אין גרסאות רשומות המתאימות לסינון':'No registered revisions match these filters');
 });
 it('keeps source originals and rejected history out of current/review views without changing stored metadata',()=>{
  const current=asset({concept:3,cycle:'DEMO cycle — one'}),template=asset({assetId:'DEMO-template',collection:'templates',concept:3,cycle:'DEMO cycle — one'}),history=asset({assetId:'DEMO-history',collection:'history',review:'retired',libraryState:'OWNER_DISCARDED'}),rows=Object.freeze([Object.freeze(current),Object.freeze(template),Object.freeze(history)]);
  expect(filterCreatives(rows,creativeFilters({}))).toEqual([current]);expect(filterCreatives(rows,creativeFilters({collection:'templates'}))).toEqual([template]);expect(filterCreatives(rows,creativeFilters({collection:'history'}))).toEqual([history]);expect(actionableCreative(template,rows)).toBe(false);expect(creativeReviewState(history)).toBe('rejected');
  expect(creativeFilters({collection:'history',approval:'needs_approval'}).collection).toBe('current');expect(filterCreatives(rows,creativeFilters({collection:'history'},true))).toEqual([current]);
  expect(filterCreatives(rows,creativeFilters({concept:'3',cycle:'cycle:DEMO cycle — one'}))).toEqual([current]);expect(filterCreatives(rows,creativeFilters({concept:'unrecorded',cycle:'unrecorded',collection:'history'}))).toEqual([history]);expect(creativeMetadataOptions(rows)).toEqual({concepts:[3],cycles:['DEMO cycle — one']});expect(template.review).toBe('draft');
 });
 it('preserves empty results for a valid stale metadata filter and rejects malformed selectors rather than selecting a guessed cycle',()=>{
  const rows=[asset({concept:3,cycle:null})];expect(filterCreatives(rows,creativeFilters({concept:'4'}))).toEqual([]);expect(filterCreatives(rows,creativeFilters({cycle:'cycle:Unloaded owner cycle'}))).toEqual([]);
  for(const bad of ['constructor','__proto__','-1','0','1.5','1000000'])expect(creativeFilters({concept:bad}).concept).toBe('all');
  for(const bad of ['__proto__','2026-10-04','cycle:','cycle:bad\ntext','cycle:'+'a'.repeat(121)])expect(creativeFilters({cycle:bad}).cycle).toBe('all');
 });
 it.each(['en','he'] as const)('renders secondary %s library, source-bound metadata filters and deep links without mixing delivery counts',locale=>{
  const snapshot:MarketingSnapshot={source:'synthetic',fetchedAt:null,creatives:[asset({title:'DEMO active delivery'})],library:Array.from({length:13},(_,i)=>asset({assetId:`DEMO-master-${i}`,title:`DEMO master ${i}`,collection:'templates',concept:3,cycle:'DEMO cycle',registeredRevisionLabel:'r1'})),publications:[],ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:'unbound'}};
  const html=renderToStaticMarkup(createElement(MarketingDashboard,{locale,snapshot,initialSection:'creatives',creativeQuery:{collection:'templates',concept:'3',cycle:'cycle:DEMO cycle'},renderedAt:'2026-10-05T14:00:00Z'}));
  expect(html.match(/class="lsr-creative-card"/g)).toHaveLength(12);expect(html).not.toContain('DEMO active delivery');expect(html).toContain('collection=templates');expect(html).toContain('concept=3');expect(html).toContain('cycle=cycle%3ADEMO+cycle');expect(html).toContain('name="concept"');expect(html).toContain('name="cycle"');expect(html).toContain(locale==='he'?'מקורות והיסטוריה בלבד':'Reference/history only');
 });
 it('preserves legacy records and stored approval while refusing false exact-version or actionable evidence',()=>{
  const row=Object.freeze(asset({registeredRevision:false,review:'approved',approvedDigest:'a'.repeat(64)}));
  expect(creativeReviewState(row)).toBe('unknown');expect(actionableCreative(row,[row])).toBe(false);
  expect(filterCreatives([row],creativeFilters({approval:'all'}))).toEqual([row]);expect(filterCreatives([row],creativeFilters({approval:'approved'}))).toEqual([]);
  expect(row.review).toBe('approved');expect(row.revision).toBe(1);expect(row.approvedDigest).toBe('a'.repeat(64));
 });
 it('converts existing channel links into visible editable filters without leaving a hidden preset',()=>{
  expect(creativeFilters({filter:'he_status'})).toEqual({language:'he',placement:'whatsapp_status',approval:'all',search:'',collection:'current',concept:'all',cycle:'all'});
  expect(creativeFilters({filter:'en_feed',language:'all',placement:'all'})).toMatchObject({language:'all',placement:'all'});
 });
 it('rejects inherited-property values and unsafe or oversized search while preserving unknown source text',()=>{
  for(const value of ['__proto__','constructor','toString'])expect(creativeFilters({language:value,placement:value,approval:value})).toEqual(creativeFilters({}));
  expect(creativeFilters({search:'a'.repeat(201)}).search).toBe('');expect(creativeFilters({search:'bad\ntext'}).search).toBe('');
  const a=asset({surface:'Unmapped owner placement',libraryState:'Owner-specific state'});expect(creativePlacement(a)).toBe('other');expect(a.surface).toBe('Unmapped owner placement');
 });
 it('filters Hebrew/English, registered surfaces and Hebrew or English title/caption/id searches',()=>{
  const rows=[asset(),asset({assetId:'DEMO-two',locale:'en',title:'DEMO — English',caption:'Second caption',surface:'WHATSAPP_STATUS'}),asset({assetId:'DEMO-three',surface:'INSTAGRAM_FEED'})];
  expect(filterCreatives(rows,creativeFilters({language:'he',placement:'facebook_feed',search:'שלום'}))).toEqual([rows[0]]);
  expect(filterCreatives(rows,creativeFilters({search:'second CAPTION'}))).toEqual([rows[1]]);
  expect(filterCreatives(rows,creativeFilters({placement:'instagram_feed'}))).toEqual([rows[2]]);
 });
 it('excludes retired, rejected, unchanged approved and superseded revisions from actionable approval',()=>{
  const rows=[asset({assetId:'retired',review:'retired'}),asset({assetId:'rejected',libraryState:'REJECTED'}),asset({assetId:'approved',review:'approved',approvedDigest:'a'.repeat(64)}),asset({assetId:'versions'}),asset({assetId:'versions',revision:2,review:'approved',approvedDigest:'a'.repeat(64)}),asset({assetId:'review',review:'in_review'})];
  expect(filterCreatives(rows,creativeFilters({},true)).map(a=>a.assetId)).toEqual(['review']);
 });
 it('an edited current revision never inherits approval from an earlier digest',()=>{
  const edited=asset({review:'approved',approvedDigest:'b'.repeat(64)});expect(creativeReviewState(edited)).toBe('unapproved');expect(actionableCreative(edited,[edited])).toBe(true);
 });
 it('contradictory current digests, invalid revisions and unknown review states are not actionable',()=>{
  const a=asset(),b=asset({contentDigest:'b'.repeat(64)});expect(actionableCreative(a,[a,b])).toBe(false);
  expect(actionableCreative(asset({revision:0}),[])).toBe(false);expect(actionableCreative(asset({contentDigest:'bad'}),[])).toBe(false);
  const unknown=asset({review:'OWNER_UNKNOWN' as CreativeVersion['review']});expect(creativeReviewState(unknown)).toBe('unknown');expect(actionableCreative(unknown,[unknown])).toBe(false);
 });
 it('keeps owner-approved assets visible under other filters and does not mutate registry records',()=>{
  const row=Object.freeze(asset({review:'approved',approvedDigest:'a'.repeat(64),libraryState:'APPROVED'}));
  expect(filterCreatives(Object.freeze([row]),creativeFilters({approval:'approved'}))).toEqual([row]);expect(row.libraryState).toBe('APPROVED');
 });
 it('bounds the grid to twelve original images per deep-linkable page without discarding or duplicating revisions',()=>{
  const rows=Array.from({length:31},(_,index)=>asset({assetId:`DEMO-${index}`}));
  const first=creativePage(rows,'1'),second=creativePage(rows,'2'),last=creativePage(rows,'3');
  expect(first.items).toHaveLength(12);expect(second.items).toHaveLength(12);expect(last.items).toHaveLength(7);expect([...first.items,...second.items,...last.items]).toEqual(rows);
  for(const page of ['-1','1.5','__proto__','90000000','0',''])expect(creativePage(rows,page).page).toBe(1);
  expect(creativePage(rows,'4').page).toBe(3);expect(creativePage([], '2')).toMatchObject({items:[],page:1,pages:1,total:0});
 });
 it.each(['en','he'] as const)('renders bounded %s grid with saved filters, next/previous links and lazy originals',locale=>{
  const rows=Array.from({length:31},(_,index)=>asset({assetId:`DEMO-${index}`,imageUrl:'https://drive.google.com/file/d/synthetic_file/view'}));
  const snapshot:MarketingSnapshot={source:'synthetic',fetchedAt:null,creatives:rows,publications:[],ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:'unbound'}};
  const html=renderToStaticMarkup(createElement(MarketingDashboard,{locale,snapshot,initialSection:'creatives',creativeQuery:{page:'2',language:'he',search:'DEMO'},renderedAt:'2026-10-04T06:00:00Z'}));
  expect(html.match(/class="lsr-creative-card"/g)).toHaveLength(12);expect(html).toContain('page=1');expect(html).toContain('page=3');expect(html).toContain('language=he');expect(html).toContain('search=DEMO');expect(html).toContain('loading="lazy"');expect(html).not.toContain('DEMO-30-r1');
 });
 it.each(['en','he'] as const)('collapses successful-read timestamps but keeps actual %s inventory failure and recovery visible',locale=>{
  const snapshot:MarketingSnapshot={source:'registry_only',fetchedAt:null,creatives:[],publications:[],ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:'unbound'},inventoryReadback:{status:'error',lastSuccessfulReadAt:null,lastAttemptAt:'2026-10-04T07:00:00Z',errorCode:'creative_inventory_unavailable'},connectionErrors:['creative_inventory_unavailable']};
  const html=renderToStaticMarkup(createElement(MarketingDashboard,{locale,snapshot,initialSection:'content_calendar',renderedAt:'2026-10-04T07:00:00Z'}));
  expect(html).toContain('<details class="lsr-inventory-readback"><summary>');expect(html).not.toContain('<details class="lsr-inventory-readback" open');expect(html).toContain(locale==='he'?'הקריאה נכשלה':'Read failed');expect(html).toContain(locale==='he'?'מלאי הקריאייטיב אינו זמין כרגע.':'Creative inventory is temporarily unavailable.');expect(html).toContain('dir="ltr"');
 });
 it.each(['en','he'] as const)('renders dedicated compact filters and exact-revision actionable counts in %s',locale=>{
  const rows=[asset(),asset({assetId:'retired',review:'retired'}),asset({assetId:'rejected',libraryState:'REJECTED'})];
  const snapshot:MarketingSnapshot={source:'synthetic',fetchedAt:null,creatives:rows,publications:[],ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:'unbound'}};
  const html=renderToStaticMarkup(createElement(MarketingDashboard,{locale,snapshot,initialSection:'needs_approval',renderedAt:'2026-10-02T12:00:00Z'}));
  expect(html).toContain('name="language"');expect(html).toContain('name="placement"');expect(html).toContain('name="search"');expect(html).not.toContain('name="filter"');
  expect(html.match(/class="lsr-creative-card"/g)).toHaveLength(1);expect(html).not.toContain('value="retired"');
 });
});
