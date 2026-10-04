import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {MarketingDashboard} from '../../../src/ui/revamp/marketing-dashboard.tsx';
import {actionableCreative,creativeFilters,creativePlacement,creativeReviewState,filterCreatives,creativePage} from '../../../src/features/marketing-overview/creative-filters.ts';
import type {CreativeVersion,MarketingSnapshot} from '../../../src/features/marketing-overview/contracts.ts';
const asset=(patch:Partial<CreativeVersion>={}):CreativeVersion=>({assetId:'DEMO-one',revision:1,locale:'he',width:1080,height:1350,imageUrl:null,title:'DEMO — שלום',caption:'First public caption',contentDigest:'a'.repeat(64),approvedDigest:null,review:'draft',surface:'FACEBOOK_FEED',...patch});
describe('registered creative filters',()=>{
 it('converts existing channel links into visible editable filters without leaving a hidden preset',()=>{
  expect(creativeFilters({filter:'he_status'})).toEqual({language:'he',placement:'whatsapp_status',approval:'all',search:''});
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
 it.each(['en','he'] as const)('renders dedicated compact filters and exact-revision actionable counts in %s',locale=>{
  const rows=[asset(),asset({assetId:'retired',review:'retired'}),asset({assetId:'rejected',libraryState:'REJECTED'})];
  const snapshot:MarketingSnapshot={source:'synthetic',fetchedAt:null,creatives:rows,publications:[],ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:'unbound'}};
  const html=renderToStaticMarkup(createElement(MarketingDashboard,{locale,snapshot,initialSection:'needs_approval',renderedAt:'2026-10-02T12:00:00Z'}));
  expect(html).toContain('name="language"');expect(html).toContain('name="placement"');expect(html).toContain('name="search"');expect(html).not.toContain('name="filter"');
  expect(html.match(/class="lsr-creative-card"/g)).toHaveLength(1);expect(html).not.toContain('value="retired"');
 });
});
