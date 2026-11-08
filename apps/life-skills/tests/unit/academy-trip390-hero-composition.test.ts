import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';
import {AcademyTrip390Page,desktopHeroBands} from '../../src/features/group-application/academy-trip390-page.tsx';
import assets from '../../src/features/group-application/academy-hero-assets.json';
import {academyR2Copy} from '../../src/features/group-application/academy-r2-copy.ts';

const css=postcss.parse(readFileSync(new URL('../../src/features/group-application/academy-trip390.module.css',import.meta.url),'utf8'));
const ordinary=[[1280,720],[1366,768],[1440,900],[1496,794],[1496,766],[1920,1080]] as const;
// Source/cascade contract, not a browser/layout engine or pixel acceptance.
// Walk actual enclosing media/support rules, including the rejected unsupported
// typed-attr case. Numeric geometry is separately exercised by the real fit helper.
function matchesConditions(rule:postcss.Rule,width:number,height:number,typedAttr=false){
 for(let p:postcss.AnyNode|undefined=rule.parent;p;p=p.parent){
  if(p.type!=='atrule')continue;const a=p as postcss.AtRule;
  if(a.name==='supports'&&a.params.includes('attr(')&&!typedAttr)return false;
  if(a.name!=='media')continue;
  if(a.params.includes('orientation:portrait')&&width>=height||a.params.includes('orientation:landscape')&&width<height)return false;
  for(const m of a.params.matchAll(/(min|max)-(width|height):\s*(\d+)px/g)){
   const actual=m[2]==='width'?width:height,limit=Number(m[3]);if(m[1]==='min'?actual<limit:actual>limit)return false;
  }
  const aspect=a.params.match(/max-aspect-ratio:\s*(\d+)\s*\/\s*(\d+)/);if(aspect&&width/height>Number(aspect[1])/Number(aspect[2]))return false;
 }
 return true;
}
function initialOverlayRule(width:number,height:number,typedAttr=false,sheet=css){
 let found=false;
 sheet.walkRules(rule=>{if(!matchesConditions(rule,width,height,typedAttr))return;
  // The ordinary overlay must not require a JS-authored overlay attribute.
  if(rule.selector.includes('[data-master-height]')&&!rule.selector.includes('[data-desktop-bands=overlay]')&&!rule.selector.includes('.heroText')&&!rule.selector.includes('picture'))rule.walkDecls('--initial-desktop-overlay',d=>{found=d.value==='1';});
 });return found;
}

describe('ordinary hero composition without the typed-attr/aspect support cliff',()=>{
 it('rejects the retained bad-before admission rule for unsupported typed attr and a wider ordinary frame',()=>{
  const before=postcss.parse('@supports (opacity:attr(data-master-height type(<number>))){@media(min-width:1024px) and (min-height:768px) and (orientation:landscape) and (max-aspect-ratio:9/5){.hero[data-master-height]{--initial-desktop-overlay:1}}}');
  expect(initialOverlayRule(1366,768,false,before)).toBe(false);expect(initialOverlayRule(1366,768,true,before)).toBe(true);
  expect(initialOverlayRule(1496,794,true,before)).toBe(false);expect(initialOverlayRule(1496,794,false)).toBe(true);
 });
 it.each(ordinary)('admits first CSS overlay at %ix%i with typed attr unsupported', (width,height)=>{
  expect(initialOverlayRule(width,height,false)).toBe(true);expect(initialOverlayRule(width,height,true)).toBe(true);
  // Approved minimum foreground: two36px title lines plus20px region,
  // and26px pillars +12px gap +52px action. These must fit outside people.
  const heading=36*2*1.08+20*1.4+8,action=26*1.2+12+52;
  const bands=desktopHeroBands(width,height-81,heading,action)!;
  expect(bands.overlay).toBe(true);expect(bands.photoHeight).toBeCloseTo(width*1143/2048);
  const protectedStart=bands.photoOffset+300*width/2048,protectedEnd=bands.photoOffset+900*width/2048;
  expect(heading+16).toBeLessThanOrEqual(protectedStart);expect(action+8).toBeLessThanOrEqual(bands.height-protectedEnd);
  // Ordinary first-screen sizing may extend only by rounding-level clearance.
  expect(bands.height).toBeLessThanOrEqual(height-81+3);
 });
 it('keeps a different wide holdout proportional and extends only an impossible band',()=>{
  const wide=desktopHeroBands(2560,999,114,95.2)!;expect(wide.overlay).toBe(true);expect(wide.height).toBeGreaterThan(999);expect(wide.photoHeight).toBeCloseTo(2560*1143/2048);
  const natural=desktopHeroBands(1440,819,114,95.2)!;expect(natural.photoOffset).toBe(0);expect(natural.upperBand).toBeCloseTo(300*1440/2048);expect(natural.height).toBe(819);
 });
 it('selects readable flow for genuinely oversized foreground rather than placing it over faces/hands',()=>{
  expect(desktopHeroBands(1496,713,320,220)!.overlay).toBe(false);expect(desktopHeroBands(1366,687,400,95.2)!.overlay).toBe(false);
  expect(desktopHeroBands(1366,687,114,200)!.overlay).toBe(false);expect(desktopHeroBands(0,687,114,95.2)).toBeNull();
 });
 it.each(['en','he'] as const)('ships registered numeric geometry and one unchanged %s action before effects',initialLocale=>{
  const html=renderToStaticMarkup(createElement(AcademyTrip390Page,{initialLocale}));
  const tag=html.match(/<section[^>]*data-master-height[^>]*>/)![0];
  expect(tag).toContain(`--master-height:${assets.textFree.desktop.height/assets.textFree.desktop.width}`);expect(tag).toContain(`--master-top:${300/2048}`);expect(tag).toContain(`--master-bottom:${900/2048}`);
  expect(tag).not.toContain('data-reflow="true"');
  const hero=html.slice(html.indexOf(tag),html.indexOf('</section>',html.indexOf(tag)));
  expect(hero.match(/data-jlfa-hero-action/g)).toHaveLength(1);expect(hero.match(/data-jlfa-reserve/g)).toHaveLength(1);
  expect(hero).toContain(academyR2Copy[initialLocale].hero.pillars);expect(hero).toContain(academyR2Copy[initialLocale].exact.hero.cta);
  expect(hero).toContain(assets.textFree.desktop.publicPath);expect(hero).toContain(assets.textFree.mobile.publicPath);expect(hero).toContain('width="2048" height="1143"');
 });
 it('leaves ordinary portrait/mobile outside desktop rules and retains a below-image flow action',()=>{
  for(const [w,h] of [[390,844],[430,932],[1024,1366],[1280,480]])expect(initialOverlayRule(w!,h!,false)).toBe(false);
  const flows:postcss.Rule[]=[];css.walkRules(rule=>{if(rule.selector.includes('.heroAction'))rule.walkDecls('order',d=>{flows.push(rule);expect(d.value).toBe('1');});});expect(flows.length).toBeGreaterThan(2);
  let frameFromPicture=false,usesBandFont=false,gapWithinSource=false;
  css.walkRules(rule=>{if(rule.selector.includes('[data-master-height]')&&rule.selector.endsWith(' picture'))rule.walkDecls('block-size',d=>{frameFromPicture=d.value==='var(--hero-frame)';});
   if(rule.selector.includes('[data-master-height]')&&rule.selector.endsWith(' h1'))rule.walkDecls('font-size',d=>{usesBandFont=d.value.includes('--upper-band')&&d.value.includes('36px');});
   if(rule.selector.includes('[data-master-height]')&&rule.selector.endsWith(' .heroAction'))rule.walkDecls('gap',d=>{gapWithinSource=d.value.startsWith('clamp(12px,')&&d.value.endsWith(',16px)');});
  });expect(frameFromPicture).toBe(true);expect(usesBandFont).toBe(true);expect(gapWithinSource).toBe(true);
 });
});
