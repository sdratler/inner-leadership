import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';
import ts from 'typescript';
import {AcademyTrip390Page,desktopHeroBands,contactDockState} from '../../src/features/group-application/academy-trip390-page.tsx';
import assets from '../../src/features/group-application/academy-hero-assets.json';
import {academyR2Copy} from '../../src/features/group-application/academy-r2-copy.ts';
import {primaryActionMode,heroActionReachability,type PrimaryActionSnapshot,type ActionReachabilitySnapshot} from '../e2e/group-interest/academy-trip390.visual-checks.ts';

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

describe('R02 source-qualified primary-action reachability',()=>{
 const rect=(left:number,top:number,width:number,height:number)=>({left,top,width,height,right:left+width,bottom:top+height});
 function flow(width=320,height=568):PrimaryActionSnapshot{
  const nw=width>=768?2048:1143,nh=width>=768?1143:2048,photo=rect(0,200,width,width*nh/nw),action=rect(0,photo.bottom,width,156),cta=rect(20,action.top+72,width-40,56);
  return {viewport:{width,height},hero:rect(0,74,width,action.bottom-74),photo:{...photo,naturalWidth:nw,naturalHeight:nh},action,cta,painted:true,initialPrimaryVisible:false,reflow:true,actionPosition:'static',declaredShortCase:`${width}x${height}`,declaredEnlargedText:false,pageFontSize:17};
 }
 it.each([[320,568],[375,667],[844,390]])('R02 accepts only the declared actual %ix%i natural-flow scroll case', (width,height)=>{
  expect(primaryActionMode(flow(width,height))).toBe('scroll');expect(primaryActionMode({...flow(width,height),declaredShortCase:null})).toBe('unreachable');
 });
 it('R02 rejects ordinary offscreen and retained bad-before desktop flow even with a visible header action',()=>{
  const ordinary={...flow(1366,768),declaredShortCase:null};expect(primaryActionMode(ordinary)).toBe('unreachable');
  const before={...ordinary,initialPrimaryVisible:true,action:rect(0,230,1366,150),cta:rect(500,300,266,56)};
  expect(primaryActionMode(before)).toBe('unreachable');
  // An ordinary valid overlay still requires an initially visible action.
  const overlay={...ordinary,actionPosition:'absolute'};expect(primaryActionMode(overlay)).toBe('unreachable');expect(primaryActionMode({...overlay,initialPrimaryVisible:true})).toBe('initial');
 });
 it('R02 denies mismatched/unadmitted viewport labels and a reflow flag without real below-image geometry',()=>{
  const s=flow();expect(primaryActionMode({...s,declaredShortCase:'375x667'})).toBe('unreachable');expect(primaryActionMode(flow(321,568))).toBe('unreachable');
  expect(primaryActionMode({...s,reflow:false})).toBe('unreachable');expect(primaryActionMode({...s,actionPosition:'absolute'})).toBe('unreachable');
  const above=rect(0,s.photo.top-156,s.viewport.width,156);expect(primaryActionMode({...s,action:above,cta:rect(20,above.top+72,280,56)})).toBe('unreachable');
  expect(primaryActionMode({...s,initialPrimaryVisible:true,action:above,cta:rect(20,above.top+72,280,56)})).toBe('unreachable');
  for(const w of [1366,1440])expect(primaryActionMode({...flow(w,768),declaredShortCase:'320x568'})).toBe('unreachable');
 });
 it('R02 rejects distorted photo, hidden control and control clipped outside the flow wrapper',()=>{
  const s=flow();expect(primaryActionMode({...s,photo:{...rect(0,200,320,100),naturalWidth:1143,naturalHeight:2048}})).toBe('unreachable');
  expect(primaryActionMode({...s,painted:false})).toBe('unreachable');expect(primaryActionMode({...s,initialPrimaryVisible:true,painted:false})).toBe('unreachable');
  expect(primaryActionMode({...s,cta:rect(20,s.cta.top,350,56)})).toBe('unreachable');expect(primaryActionMode({...s,cta:rect(20,s.action.bottom-20,280,56)})).toBe('unreachable');
 });
 it('R02 permits declared actual200percent text only with actual natural flow, never a declaration alone',()=>{
  const s={...flow(390,844),declaredShortCase:null,declaredEnlargedText:true,pageFontSize:34};expect(primaryActionMode(s)).toBe('scroll');
  expect(primaryActionMode({...s,declaredEnlargedText:false})).toBe('unreachable');expect(primaryActionMode({...s,pageFontSize:17})).toBe('unreachable');expect(primaryActionMode({...s,reflow:false})).toBe('unreachable');
 });
 const reachable=():ActionReachabilitySnapshot=>({viewport:{width:320,height:568},cta:rect(20,460,280,56),painted:true,headerBottom:74,pointsClear:true});
 it('R02 accepts verified current hitbox only after the same action is wholly visible and point-clear',()=>expect(heroActionReachability(reachable())).toEqual([]));
 it('R02 keeps an unrelated ordinary-size clear-action holdout valid without a short-case exemption',()=>{
  const s={...flow(1440,900),declaredShortCase:null,actionPosition:'absolute',initialPrimaryVisible:true};expect(primaryActionMode(s)).toBe('initial');
  expect(heroActionReachability({viewport:{width:430,height:932},cta:rect(60,800,310,64),painted:true,headerBottom:81,pointsClear:true})).toEqual([]);
 });
 it.each(['intercepted','header','bottom','hidden','hitbox'] as const)('R02 rejects %s after scroll instead of assuming that scroll or click implies reachability',mode=>{
  const s=reachable();if(mode==='intercepted')s.pointsClear=false;if(mode==='header')s.cta=rect(20,70,280,56);if(mode==='bottom')s.cta=rect(20,530,280,56);if(mode==='hidden')s.painted=false;if(mode==='hitbox')s.cta=rect(20,460,47,56);
  expect(heroActionReachability(s).length).toBeGreaterThan(0);
 });
});

describe('HERO-SHORT-CONTACT-R01 readiness before initial/reflow paint',()=>{
 it('R01 keeps pending/unloaded/blocked geometry inert and permits the same dock after a clear measurement',()=>{
  const inert={ready:false,tabIndex:-1,ariaHidden:true},ready={ready:true,tabIndex:0,ariaHidden:false};
  expect(contactDockState(true,false,'pending')).toEqual(inert); // initial
  expect(contactDockState(true,true,'pending')).toEqual(inert); // image loaded, not yet placed
  expect(contactDockState(true,false,'clear')).toEqual(inert); // no authenticated photo geometry
  expect(contactDockState(true,true,'clear')).toEqual(ready);
  expect(contactDockState(true,true,'pending')).toEqual(inert); // reflow invalidates old placement
  expect(contactDockState(true,true,'blocked')).toEqual(inert);
  expect(contactDockState(true,true,'clear')).toEqual(ready); // settles clear again
  expect(contactDockState(false,false,'clear')).toEqual(ready); // usable below the hero
 });
 it.each(['en','he'] as const)('R01 renders the %s floating badge inert before hydration while keeping footer contact reachable',initialLocale=>{
  const html=renderToStaticMarkup(createElement(AcademyTrip390Page,{initialLocale}));
  const dock=html.match(/<a[^>]*data-contact-ready="false"[^>]*>/)![0];expect(dock).toContain('tabindex="-1"');expect(dock).toContain('aria-hidden="true"');expect(dock).toContain('https://wa.me/13054916674');
  const footer=html.slice(html.indexOf('<footer'),html.indexOf('</footer>'));expect(footer).toContain('https://wa.me/13054916674');
  let pendingHidden=false,fixedDock=false;
  css.walkRules(rule=>{
   if(rule.selector==='.page .whatsapp:not([data-contact-ready=true])')rule.walkDecls('visibility',d=>{pendingHidden=d.value==='hidden';});
   if(rule.selector==='.page .whatsapp')rule.walkDecls('position',d=>{fixedDock=d.value==='fixed';});
  });expect(pendingHidden).toBe(true);expect(fixedDock).toBe(true);
 });
 it('R01 invalidates synchronously before queued measurement and on hero reflow in a pre-paint layout hook',()=>{
  const source=ts.createSourceFile('academy-trip390-page.tsx',readFileSync(new URL('../../src/features/group-application/academy-trip390-page.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const calls:ts.CallExpression[]=[],visit=(n:ts.Node)=>{if(ts.isCallExpression(n))calls.push(n);ts.forEachChild(n,visit);};visit(source);
  const hook=calls.find(c=>ts.isIdentifier(c.expression)&&c.expression.text==='useLayoutEffect'&&c.arguments[0]?.getText(source).includes('const link=contact.current'))!;
  expect(hook).toBeDefined();const deps=hook.arguments[1];expect(deps&&ts.isArrayLiteralExpression(deps)?deps.elements.map(e=>e.getText(source)):[]).toEqual(['locale','dialogOpen','menuOpen','heroReflow']);
  const schedule:ts.VariableDeclaration[]=[];const find=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='schedule')schedule.push(n);ts.forEachChild(n,find);};find(hook.arguments[0]!);
  const arrow=schedule[0]!.initializer!;expect(ts.isArrowFunction(arrow)).toBe(true);
  const body=ts.isArrowFunction(arrow)&&ts.isBlock(arrow.body)?arrow.body:null;expect(body?.statements[0]?.getText(source)).toBe('invalidate();');expect(body?.getText(source)).toContain('requestAnimationFrame(measure)');
 });
});
