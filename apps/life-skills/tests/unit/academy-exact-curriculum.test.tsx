import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {AcademyStage} from '../../src/features/group-application/academy-stage.tsx';
import {AcademyPublicRoute} from '../../src/features/group-application/academy-route-context.tsx';
import {academyExactCurriculum,academyExactCopy} from '../../src/features/group-application/academy-exact-copy.ts';
import type {CampaignSnapshot} from '../../src/features/group-application/academy-campaign-contract.ts';
import sceneManifest from '../../src/features/group-application/academy-scenes.json';

const founder:CampaignSnapshot={version:'JLFA-PREREG-LAUNCH-20261023-05',phase:'PRE_REGISTRATION',revision:0,capacity:30,occupied:0,remaining:30,asOf:'2026-10-26T10:00:00.000Z',firstFilledAt:null,reopeningPolicy:'PROPOSED_STICKY_REGULAR_PENDING_OWNER_CONFIRMATION'};
const regular:CampaignSnapshot={...founder,phase:'REGULAR_REGISTRATION',revision:1,occupied:30,remaining:0,firstFilledAt:'2026-10-26T10:00:00.000Z'};
function escaped(text:string){return renderToStaticMarkup(<span>{text}</span>).slice(6,-7);}
function page(slug:string,locale:'en'|'he',mode:'bna'|'legacy',campaign:CampaignSnapshot|null=founder){
 const all=renderToStaticMarkup(<AcademyPublicRoute mode={mode} campaign={campaign}><AcademyStage locale={locale} slug={slug}/></AcademyPublicRoute>);
 const start=all.indexOf('<main id="main"');
 return start===-1?'':all.slice(start,all.indexOf('</main>',start)+7);
}

describe('exact 48-lesson curriculum',()=>{
 it('preserves all historical identities once, with only the adopted Foundation display order',()=>{
  const stages=academyExactCurriculum.stages;
  expect(stages.map(s=>s.slug)).toEqual(['foundation','independent','advanced','leadership']);
  const ids=stages.flatMap(s=>s.lessons.map(l=>l.rmId));
  expect(ids).toHaveLength(48);expect(new Set(ids).size).toBe(48);
  expect(stages[0]!.lessons.map(l=>l.rmId)).toEqual(['RM-101','RM-103','RM-102','RM-104','RM-105','RM-106','RM-107','RM-108','RM-109','RM-110','RM-111','RM-112']);
  stages.forEach(stage=>expect(stage.lessons.map(l=>l.number)).toEqual(Array.from({length:12},(_,i)=>i+1)));
 });
 for(const stage of academyExactCurriculum.stages)for(const locale of ['en','he'] as const)for(const mode of ['bna','legacy'] as const){
  it(`${stage.slug}/${locale}/${mode} server-renders every exact main summary and stage-specific age panel`,()=>{
   const html=page(stage.slug,locale,mode),common=academyExactCurriculum.common[locale];
   expect(html).toContain('<h1>'+escaped(stage.title[locale])+'</h1>');
   expect(html).toContain(escaped(stage.introduction[locale]));
   expect(html).toContain(escaped(common.progressionHeading));expect(html).toContain(escaped(common.logisticsNote));
   const lessons=html.match(/<ol[^>]*data-academy-lesson-list[^>]*>([\s\S]*?)<\/ol>/)?.[1]??'';
   expect((lessons.match(/<li value=/g)??[]).length).toBe(12);
   for(const lesson of stage.lessons){expect(lessons).toContain('<h3>'+escaped(lesson.title[locale])+'</h3>');expect(lessons).toContain('<p>'+escaped(lesson.description[locale])+'</p>');}
   expect(lessons).not.toMatch(/\shidden(?:=|\s|>)|<details|<button|display:none/);
   expect(html).not.toMatch(/RM-\d{3}/);
   for(const panel of Object.values(stage.agePanels))for(const text of panel[locale])expect(html).toContain(escaped(text));
   expect(html).toContain(escaped(common.readinessNote));
   const image=sceneManifest.assets.find(asset=>asset.slot===stage.slug)!;
   expect(html).toContain('src="'+image.publicPath+'"');
   expect(html).toContain('width="'+image.width+'"');expect(html).toContain('height="'+image.height+'"');
  });
 }
 for(const locale of ['en','he'] as const)it(`${locale} native age controls work without hydration and keep readable fallback`,()=>{
  const html=page('foundation',locale,'bna');
  expect(html).toContain('<fieldset');expect(html).toContain('<legend>'+escaped(academyExactCurriculum.common[locale].ageLabel)+'</legend>');
  expect((html.match(/type="radio"/g)??[]).length).toBe(3);
  expect((html.match(/checked=""/g)??[]).length).toBe(1);
  expect((html.match(/data-age-panel=/g)??[]).length).toBe(3);
  const ids=[...html.matchAll(/<input[^>]*id="([^"]+)"/g)].map(m=>m[1]);
  expect(new Set(ids).size).toBe(3);ids.forEach(id=>expect(html).toContain('for="'+id+'"'));
  expect(html).not.toMatch(/role="tab|disabled| hidden|<script/);
 });
 for(const locale of ['en','he'] as const)for(const mode of ['bna','legacy'] as const)for(const campaign of [founder,regular,null])it(`${locale}/${mode}/${campaign?.phase??'unknown'} has short top navigation and only a direct registration action`,()=>{
  const html=page('advanced',locale,mode,campaign),base=mode==='bna'?(locale==='he'?'/he/fishing-academy':'/fishing-academy'):`/${locale}/florida`;
  const nav=html.match(/<nav[^>]*data-academy-curriculum-navigation[^>]*>([\s\S]*?)<\/nav>/)?.[1]??'';
  expect((nav.match(/<a /g)??[]).length).toBe(4);expect((nav.match(/aria-current="page"/g)??[]).length).toBe(1);
  academyExactCurriculum.stages.forEach((stage,index)=>{expect(nav).toContain('href="'+base+'/stages/'+stage.slug+'"');expect(nav).toContain(escaped(academyExactCurriculum.common[locale].navigation[index]!));});
  const text=campaign?.phase==='PRE_REGISTRATION'?academyExactCopy[locale].nav.preRegister:academyExactCopy[locale].nav.register;
  expect(html).toMatch(new RegExp('href="'+base+'/apply"[^>]*data-academy-curriculum-register[^>]*>'+escaped(text)+'</a>'));
  expect(html).not.toMatch(/<aside|#pricing|\/pricing|travel-faq|Possible locations|מקומות דיג אפשריים|See stage prices|למחירי השלבים/);
 });
 it('does not invent a stage for an unknown slug',()=>expect(page('unknown','en','legacy')).toBe(''));
});
