import type {Page,ElementHandle} from '@playwright/test';
import {academyR2Copy as trip390Copy} from '../../../src/features/group-application/academy-r2-copy.ts';
import heroAssets from '../../../src/features/group-application/academy-hero-assets.json' with {type:'json'};

const registeredOriginals=(['desktop','mobile'] as const).map(role=>({...heroAssets.textFree[role],sourceSha256:heroAssets.current.en[role].sourceSha256,protectedRect:heroAssets.current.en[role].protectedRect}));

export type HeroContentSnapshot={locale:string|null;blocks:string[];allText:string;headingCount:number;titleCount:number;paragraphCount:number;actionCount:number;linkCount:number};
type ActionRect={left:number;right:number;top:number;bottom:number;width:number;height:number};
export type PrimaryActionSnapshot={viewport:{width:number;height:number};hero:ActionRect;photo:ActionRect&{naturalWidth:number;naturalHeight:number};action:ActionRect;cta:ActionRect;
 photoBackedGrid?:boolean;enlargedPhotoFrame?:boolean;painted:boolean;initialPrimaryVisible:boolean;reflow:boolean;actionPosition:string;declaredShortCase:string|null;declaredEnlargedText:boolean;pageFontSize:number};
// This task's source-admitted matrix cases, not a universal viewport policy.
const shortCases=new Set(['320x568','375x667','844x390']);
const validRect=(r:ActionRect)=>Object.values(r).every(Number.isFinite)&&r.width>0&&r.height>0&&Math.abs(r.right-r.left-r.width)<1&&Math.abs(r.bottom-r.top-r.height)<1;
const containsRect=(outer:ActionRect,inner:ActionRect)=>inner.left>=outer.left-1&&inner.right<=outer.right+1&&inner.top>=outer.top-1&&inner.bottom<=outer.bottom+1;
/** Package03 permits a below-photo action only for actual short/enlarged flow.
 * A reflow flag alone never excuses an ordinary missing or malformed action. */
export function primaryActionMode(s:PrimaryActionSnapshot):'initial'|'scroll'|'unreachable'{
 if(![s.hero,s.photo,s.action,s.cta].every(validRect)||!s.painted||s.cta.width<48||s.cta.height<48||!containsRect(s.hero,s.photo)||!containsRect(s.hero,s.action)||!containsRect(s.action,s.cta))return 'unreachable';
 const short=s.declaredShortCase!==null&&shortCases.has(s.declaredShortCase)&&s.declaredShortCase===`${s.viewport.width}x${s.viewport.height}`;
 const qualified=short||s.declaredEnlargedText&&s.pageFontSize>=34;
 const proportional=s.photo.naturalWidth>0&&s.photo.naturalHeight>0&&Math.abs(s.photo.width/s.photo.height-s.photo.naturalWidth/s.photo.naturalHeight)<.005;
 const admittedFlow=qualified&&s.reflow&&s.actionPosition==='static'&&proportional&&s.action.top>=s.photo.bottom-1;
 if(s.enlargedPhotoFrame&&s.declaredEnlargedText&&s.pageFontSize>=34&&proportional&&s.viewport.width<=999)return s.initialPrimaryVisible?'initial':'scroll';
 const photoOverlay=s.photoBackedGrid&&s.viewport.width<=999&&s.actionPosition==='static'&&containsRect(s.photo,s.action);
 if(photoOverlay)return s.initialPrimaryVisible?'initial':qualified?'scroll':'unreachable';
 if(s.actionPosition==='static'&&!admittedFlow)return 'unreachable';
 if(s.initialPrimaryVisible)return 'initial';
 return admittedFlow?'scroll':'unreachable';
}
export type ActionReachabilitySnapshot={viewport:{width:number;height:number};cta:ActionRect;painted:boolean;headerBottom:number;pointsClear:boolean};
export function heroActionReachability(s:ActionReachabilitySnapshot):string[]{
 const findings:string[]=[];
 if(!validRect(s.cta)||s.cta.width<48||s.cta.height<48)findings.push('primary-action-hitbox');
 if(!s.painted)findings.push('primary-action-hidden');
 if(s.cta.left<0||s.cta.right>s.viewport.width||s.cta.top<Math.max(0,s.headerBottom)||s.cta.bottom>s.viewport.height)findings.push('primary-action-outside-clear-viewport');
 if(!s.pointsClear)findings.push('primary-action-intercepted');
 return findings;
}

export type PhotoBlockedContactSnapshot={box:ActionRect;lift:number;visibility:string;display:string;inlineVisibility:string;ready:string|null;ariaHidden:string|null;tabIndex:number;hidden:boolean;position:string;modalOpen:boolean;photoReady:boolean;photoRegistered:boolean;protectedPhoto:ActionRect|null;direction?:string};
/** Only the observed enlarged-photo fallback; no ordinary/feasible-slot waiver. */
export function admittedEnlargedPhotoBlock(action:PrimaryActionSnapshot,dock:PhotoBlockedContactSnapshot|null):boolean{
 if(!dock||!action.declaredEnlargedText||action.pageFontSize<34||primaryActionMode(action)!=='scroll'||!dock.photoReady||!dock.photoRegistered||!dock.protectedPhoto)return false;
 if(!validRect(dock.box)||dock.box.width<48||dock.box.height<48||!validRect(dock.protectedPhoto)||!containsRect(action.photo,dock.protectedPhoto))return false;
 if(dock.visibility!=='hidden'||dock.inlineVisibility!=='hidden'||dock.display==='none'||dock.ready!=='false'||dock.ariaHidden!=='true'||dock.tabIndex!==-1||dock.hidden||dock.modalOpen||dock.position!=='fixed'||!Number.isFinite(dock.lift)||Math.abs(dock.lift)>.01)return false;
 const direction=dock.direction??'ltr';
 if(direction!=='ltr'&&direction!=='rtl')return false;
 const inlineEndDistance=direction==='rtl'?dock.box.left:action.viewport.width-dock.box.right;
 if(dock.box.left<0||dock.box.right>action.viewport.width||dock.box.top<0||dock.box.bottom>action.viewport.height||inlineEndDistance>40)return false;
 const gap=12,baseTop=dock.box.top+dock.lift,floor=Math.max(0,baseTop-224),photo=dock.protectedPhoto;
 // Photo alone must block EVERY position in the existing local interval.
 if(photo.left>=dock.box.right+gap||photo.right<=dock.box.left-gap)return false;
 return photo.top-dock.box.height-gap<floor&&photo.bottom+gap>baseTop;
}

export type ContactRestorationSnapshot={box:ActionRect;viewport:{width:number;height:number};headerBottom:number;heroBottom:number;scrollY:number;lift:number;painted:boolean;ready:string|null;ariaHidden:string|null;tabIndex:number;hidden:boolean;position:string;sameNode:boolean;destinationValid:boolean;pointsClear:boolean};
export function contactRestorationFindings(s:ContactRestorationSnapshot):string[]{
 const findings:string[]=[];
 if(!s.sameNode)findings.push('restored-contact-replaced');
 if(s.scrollY<=0||s.heroBottom>s.headerBottom)findings.push('restored-contact-photo-not-behind-header');
 if(!s.painted||s.ready!=='true'||s.ariaHidden==='true'||s.tabIndex!==0||s.hidden)findings.push('restored-contact-hidden-or-inert');
 if(!validRect(s.box)||s.box.width<48||s.box.height<48||s.position!=='fixed'||s.box.left<0||s.box.right>s.viewport.width||s.box.top<Math.max(0,s.headerBottom)||s.box.bottom>s.viewport.height)findings.push('restored-contact-placement');
 if(!s.destinationValid)findings.push('restored-contact-destination');
 if(!s.pointsClear)findings.push('restored-contact-intercepted');
 return findings;
}
export async function inspectContactRestoration(page:Page,expected:ElementHandle<HTMLElement|SVGElement>){
 const snapshot=await page.evaluate(({expected,reading})=>{
  const a=document.querySelector<HTMLAnchorElement>('a[class*="whatsapp"]')!,b=a.getBoundingClientRect(),s=getComputedStyle(a);
  let painted=true;for(let n:HTMLElement|null=a;n;n=n.parentElement){const c=getComputedStyle(n);if(c.display==='none'||c.visibility==='hidden'||c.opacity==='0'||n.hidden)painted=false;}
  const x=b.left+b.width/2,y=b.top+b.height/2,inset=6;
  // Cardinal points lie inside the circular dock; rectangle corners do not.
  const points=[[x,y],[b.left+inset,y],[b.right-inset,y],[x,b.top+inset],[x,b.bottom-inset]];
  return {box:{left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height},viewport:{width:innerWidth,height:innerHeight},headerBottom:document.querySelector('header')!.getBoundingClientRect().bottom,heroBottom:document.querySelector('section[aria-labelledby="trip390-title"]')!.getBoundingClientRect().bottom,scrollY:reading.scrollTop,lift:parseFloat(s.getPropertyValue('--contact-lift'))||0,painted,ready:a.getAttribute('data-contact-ready'),ariaHidden:a.getAttribute('aria-hidden'),tabIndex:a.tabIndex,hidden:a.hidden,position:s.position,sameNode:a===expected,destinationValid:a.href.startsWith('https://wa.me/13054916674?'),pointsClear:points.every(([px,py])=>{const hit=document.elementFromPoint(px!,py!);return hit!==null&&a.contains(hit);})};
 },{expected,reading:await readingViewport(page)});
 return {...snapshot,findings:contactRestorationFindings(snapshot)};
}

/** Positive current hit testing after scrolling the SAME hero action. */
export async function inspectHeroActionReachability(page:Page){
 const snapshot=await page.evaluate(()=>{
  const a=document.querySelector<HTMLAnchorElement>('[data-hero-action] a')!,b=a.getBoundingClientRect();
  let painted=true;for(let n:HTMLElement|null=a;n;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||s.opacity==='0'||n.hidden||n.getAttribute('aria-hidden')==='true')painted=false;}
  const inset=6,points=[[b.left+b.width/2,b.top+b.height/2],[b.left+inset,b.top+inset],[b.right-inset,b.top+inset],[b.left+inset,b.bottom-inset],[b.right-inset,b.bottom-inset]];
  return {viewport:{width:innerWidth,height:innerHeight},cta:{left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height},painted,
   headerBottom:document.querySelector('header')!.getBoundingClientRect().bottom,pointsClear:points.every(([x,y])=>{const hit=document.elementFromPoint(x!,y!);return hit!==null&&a.contains(hit);})};
 });return {...snapshot,findings:heroActionReachability(snapshot)};
}

/** Match the approved locale's complete hero, not an obsolete keyword blacklist. */
export function matchesCurrentHeroContent(observed:HeroContentSnapshot,copy:typeof trip390Copy=trip390Copy){
 if(observed.locale!=='en'&&observed.locale!=='he')return false;
 const hero=copy[observed.locale].exact.hero;
 const expected=[hero.region,hero.nameLine1+' '+hero.nameLine2,hero.pillars,hero.cta];
 const normalize=(value:string)=>value.replace(/\s+/g,' ').trim();
 return observed.headingCount===1&&observed.titleCount===1&&observed.paragraphCount===2&&observed.actionCount===1&&observed.linkCount===1
  &&observed.blocks.length===expected.length&&observed.blocks.every((value,index)=>normalize(value)===normalize(expected[index]!))
  &&normalize(observed.allText)===normalize(expected.join(' '));
}

/** Scoped measurable checks, not a visual score or substitute for image review. */
export async function inspectLanding(page:Page,options:{declaredShortCase?:string;declaredEnlargedText?:boolean}={}){
 const reading=await readingViewport(page);
 const observed=await page.evaluate(({expectedFaqIds,declaredShortCase,declaredEnlargedText,registeredOriginals,reading})=>{
  const findings:string[]=[];
  const box=(node:Element)=>node.getBoundingClientRect();
  const heading=document.querySelector('#trip390-title')!;
  const hero=heading.closest('section')!,photo=hero.querySelector('img')!;
  const hb=box(hero),ib=box(photo),header=box(document.querySelector('header')!);
  const width=document.documentElement.clientWidth;
  if(document.documentElement.scrollWidth>innerWidth+1||reading.scrollWidth>width+1)findings.push('page-horizontal-overflow');
  if(Math.abs(hb.left)>1||Math.abs(hb.right-width)>1)findings.push('hero-boxed');
  if(!photo.complete||!photo.naturalWidth)findings.push('hero-image-unloaded');
  const headingBlocks=hero.querySelectorAll('[data-hero-heading]'),actions=hero.querySelectorAll('[data-hero-action]');
  const paragraphs=hero.querySelectorAll('[data-hero-heading] > p, [data-hero-action] > p[data-jlfa-pillars]'),links=hero.querySelectorAll('[data-hero-action] a');
  const textNodes:string[]=[],walker=document.createTreeWalker(hero,NodeFilter.SHOW_TEXT);
  for(let text=walker.nextNode();text;text=walker.nextNode())if(text.textContent?.trim())textNodes.push(text.textContent);
  const heroContent:HeroContentSnapshot={locale:hero.closest('[lang]')?.getAttribute('lang')??null,
   blocks:[paragraphs[0]?.textContent??'',[...heading.querySelectorAll('span')].map(span=>span.textContent??'').join(' '),paragraphs[1]?.textContent??'',links[0]?.textContent??''],
   allText:textNodes.join(' '),headingCount:headingBlocks.length,titleCount:hero.querySelectorAll('h1').length,paragraphCount:paragraphs.length,actionCount:actions.length,linkCount:links.length};
  for(const span of heading.querySelectorAll('span')){
   const walker=document.createTreeWalker(span,NodeFilter.SHOW_TEXT);
   for(let text=walker.nextNode();text;text=walker.nextNode())for(const match of (text.textContent??'').matchAll(/\S+/g)){
    const range=document.createRange();range.setStart(text,match.index!);range.setEnd(text,match.index!+match[0].length);
     const boxes=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0);
     if(boxes.length>1)findings.push('hero-word-fragment');
     if(boxes.some(r=>r.left< -1||r.right>width+1))findings.push('hero-word-outside-reading-width');
   }
  }
  if(innerHeight>600&&!declaredEnlargedText&&hero.getAttribute('data-reflow')!=='true'&&Math.abs(hb.bottom-reading.bottom)>3)findings.push('hero-first-screen-height');
  if(getComputedStyle(document.querySelector('header')!).position!=='sticky')findings.push('header-not-sticky');
  const primary=[...document.querySelectorAll<HTMLAnchorElement>('[data-hero-action] a,header a[href="#interest"]')];
  const initialPrimaryVisible=primary.some(node=>{const b=box(node),s=getComputedStyle(node);return s.display!=='none'&&s.visibility!=='hidden'&&b.width>=48&&b.height>=48&&b.top>=0&&b.bottom<=reading.bottom&&b.left>=0&&b.right<=innerWidth;});
  const rect=(b:DOMRect)=>({left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height});
  const action=hero.querySelector<HTMLElement>('[data-hero-action]')!,cta=action.querySelector<HTMLAnchorElement>('a')!;
  let actionPainted=true;for(let n:HTMLElement|null=cta;n;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||s.opacity==='0'||n.hidden||n.getAttribute('aria-hidden')==='true')actionPainted=false;}
  const photoEdges=['::before','::after'].map(edge=>getComputedStyle(hero,edge));
  const enlargedPhotoFrame=declaredEnlargedText&&getComputedStyle(hero).display==='grid'&&photoEdges.every(edge=>edge.borderImageSource.includes(new URL(photo.currentSrc).pathname))&&Math.abs(ib.width-hb.width)<1;
  const primaryAction:PrimaryActionSnapshot={viewport:{width:innerWidth,height:innerHeight},hero:rect(hb),photo:{...rect(ib),naturalWidth:photo.naturalWidth,naturalHeight:photo.naturalHeight},action:rect(box(action)),cta:rect(box(cta)),
   enlargedPhotoFrame,photoBackedGrid:getComputedStyle(hero).display==='grid'&&Math.abs(ib.top-hb.top)<1&&Math.abs(ib.bottom-hb.bottom)<1&&getComputedStyle(photo).objectFit==='cover',
   painted:actionPainted,initialPrimaryVisible,reflow:hero.getAttribute('data-reflow')==='true',actionPosition:getComputedStyle(action).position,declaredShortCase,declaredEnlargedText,pageFontSize:parseFloat(getComputedStyle(hero.closest('div[lang]')!).fontSize)};
  if(primary.some(node=>/[↗→]/.test(node.textContent??'')))findings.push('ornamental-primary-arrow');
  if(document.body.textContent?.includes('Review candidate ·'))findings.push('internal-review-banner');
  // These focal rectangles come from inspecting the exact protected originals
  // for this task. They cover faces/hands/people, not a second asset master.
  const mobile=photo.currentSrc.includes('hero-mobile');
  const focal=mobile?[.035,.30,.905,.65]:[.29,.27,.68,.76];
  const fit=getComputedStyle(photo).objectFit;
  const scale=fit==='cover'?Math.max(ib.width/photo.naturalWidth,ib.height/photo.naturalHeight):Math.min(ib.width/photo.naturalWidth,ib.height/photo.naturalHeight);
  const [xAnchor,yAnchor]=getComputedStyle(photo).objectPosition.split(' ').map(value=>parseFloat(value)/100);
  const painted={left:ib.left+(ib.width-photo.naturalWidth*scale)*xAnchor!,top:ib.top+(ib.height-photo.naturalHeight*scale)*yAnchor!};
  const subject={left:painted.left+focal[0]!*photo.naturalWidth*scale,top:painted.top+focal[1]!*photo.naturalHeight*scale,right:painted.left+focal[2]!*photo.naturalWidth*scale,bottom:painted.top+focal[3]!*photo.naturalHeight*scale};
  if(subject.left<ib.left-1||subject.right>ib.right+1||subject.top<ib.top-1||subject.bottom>ib.bottom+1)findings.push('protected-subject-cropped');
  for(const node of hero.querySelectorAll('[data-hero-heading] p,[data-hero-heading] h1 span,[data-hero-action]')){
   const b=box(node),overlap=b.left<subject.right&&b.right>subject.left&&b.top<subject.bottom&&b.bottom>subject.top;
   if(overlap)findings.push('hero-text-over-subject');
   if(b.left<0||b.right>width+1||b.bottom>hb.bottom+1)findings.push('hero-control-clipped');
  }
  const faq=document.querySelector('#faq')!,items=[...faq.querySelectorAll('[data-trip390-faq]')],groups=[...new Set(items.map(item=>item.parentElement!))];
  if(groups.length!==2||JSON.stringify(items.map(item=>item.id))!==JSON.stringify(expectedFaqIds))findings.push('faq-structure-missing');
  if(groups.length===2){
   const a=box(groups[0]!),b=box(groups[1]!),title=box(faq.querySelector('h2')!);
   if(title.bottom>Math.min(a.top,b.top)+1)findings.push('faq-heading-rail');
   if(width>=1000&&(Math.abs(a.top-b.top)>2||Math.abs(a.width-b.width)>2))findings.push('faq-unbalanced-columns');
  }
  const portrait=document.querySelector<HTMLImageElement>('img[src="/groups/people/founder-head.jpg"]');
  if(!portrait||!portrait.complete||!portrait.naturalWidth||getComputedStyle(portrait).borderRadius!=='50%')findings.push('founder-portrait-missing');
  const wa=document.querySelector<HTMLAnchorElement>('a[class*="whatsapp"]');
  let contactSnapshot:PhotoBlockedContactSnapshot|null=null;
  if(!wa)findings.push('whatsapp-missing');
  else{
   const b=box(wa),lift=parseFloat(getComputedStyle(wa).getPropertyValue('--contact-lift'))||0;
   const style=getComputedStyle(wa),url=new URL(photo.currentSrc,location.href);
   const original=registeredOriginals.find(asset=>url.origin===location.origin&&url.pathname===asset.publicPath&&photo.naturalWidth===asset.width&&photo.naturalHeight===asset.height&&asset.sourceSha256===asset.sha256);
   const edges=original?{left:Math.max(0,ib.left,painted.left+original.protectedRect[0]!*scale),top:Math.max(0,ib.top,painted.top+original.protectedRect[1]!*scale),right:Math.min(innerWidth,ib.right,painted.left+original.protectedRect[2]!*scale),bottom:Math.min(innerHeight,ib.bottom,painted.top+original.protectedRect[3]!*scale)}:null;
   const protectedPhoto=edges&&edges.right>edges.left&&edges.bottom>edges.top?{...edges,width:edges.right-edges.left,height:edges.bottom-edges.top}:null;
   contactSnapshot={box:rect(b),lift,visibility:style.visibility,display:style.display,inlineVisibility:wa.style.visibility,ready:wa.getAttribute('data-contact-ready'),ariaHidden:wa.getAttribute('aria-hidden'),tabIndex:wa.tabIndex,hidden:wa.hidden,position:style.position,modalOpen:document.querySelector('dialog')?.matches(':modal')??false,photoReady:photo.complete&&photo.naturalWidth>0,photoRegistered:Boolean(original),protectedPhoto,direction:style.direction};
   // Bounded local collision avoidance: three controls, four for protected photo.
   const inlineEndDistance=width>999&&style.direction==='rtl'?b.left:width-b.right;
   if(style.position!=='fixed'||b.width<48||b.height<48||b.left<0||b.right>width||inlineEndDistance>40||lift<0||lift>224||innerHeight-b.bottom>242||b.bottom>innerHeight)findings.push('whatsapp-placement');
   if(width<=999){
    if(reading.separate||(!primaryAction.photoBackedGrid&&!enlargedPhotoFrame)||Math.abs(header.bottom-hb.top)>1)findings.push('mobile-hero-band-or-reading-pane');
    if(wa.textContent?.trim()||Math.abs(b.width-b.height)>1||style.borderRadius!=='50%'||!wa.querySelector('svg')||document.querySelectorAll('[data-contact-ready]').length!==1)findings.push('mobile-contact-not-single-logo');
   }
   if(style.visibility==='visible'&&style.display!=='none'&&b.left<subject.right&&b.right>subject.left&&b.top<Math.min(subject.bottom,reading.bottom)&&b.bottom>subject.top)findings.push('whatsapp-over-subject');
   if(!wa.href.startsWith('https://wa.me/13054916674?'))findings.push('whatsapp-destination');
   for(const control of document.querySelectorAll('a,button,summary')){
    if(control===wa||control.closest('dialog')||control.getClientRects().length===0)continue;
    const c=box(control);
    if(style.visibility==='visible'&&style.display!=='none'&&c.left<b.right&&c.right>b.left&&c.top<b.bottom&&Math.min(c.bottom,reading.bottom)>b.top)findings.push('whatsapp-obscures-control');
   }
  }
  // Public layout evidence only: no form values, session data or API payloads.
  const heroStyle=getComputedStyle(hero),photoStyle=getComputedStyle(photo);
  const layoutDiagnostics={
   scroll:{x:scrollX,y:reading.scrollTop},clientViewport:{width:document.documentElement.clientWidth,height:document.documentElement.clientHeight},
   visualViewport:visualViewport?{width:visualViewport.width,height:visualViewport.height,offsetTop:visualViewport.offsetTop,offsetLeft:visualViewport.offsetLeft,scale:visualViewport.scale}:null,
   header:rect(header),picture:rect(box(photo.parentElement!)),
   flags:{reflow:hero.getAttribute('data-reflow'),desktopBands:hero.getAttribute('data-desktop-bands'),photoFit:hero.getAttribute('data-photo-fit')},
   cssVariables:Object.fromEntries(['--header-height','--hero-frame','--initial-desktop-overlay','--master-height','--master-top','--master-bottom','--photo-top','--upper-band','--lower-band'].map(name=>[name,heroStyle.getPropertyValue(name)])),
   heroStyle:{blockSize:heroStyle.blockSize,minBlockSize:heroStyle.minBlockSize,position:heroStyle.position,display:heroStyle.display,containerType:heroStyle.containerType},
   photoStyle:{blockSize:photoStyle.blockSize,objectFit:photoStyle.objectFit,objectPosition:photoStyle.objectPosition},
   heading:rect(box(heading)),fonts:{status:document.fonts.status,heading:getComputedStyle(heading).font,page:getComputedStyle(hero.closest('div[lang]')!).font},
  };
  return {findings,heroContent,primaryAction,contactSnapshot,layoutDiagnostics,viewport:{width:innerWidth,height:innerHeight},headerHeight:header.height,hero:{left:hb.left,width:hb.width,height:hb.height,bottom:hb.bottom},image:{src:photo.currentSrc,fit,subject},faqCount:faq.querySelectorAll('[data-trip390-faq]').length};
 },{expectedFaqIds:trip390Copy.en.faqs.map(item=>item.id).filter(id=>id!=='cancellation'&&id!=='conduct'),declaredShortCase:options.declaredShortCase??null,declaredEnlargedText:options.declaredEnlargedText===true,registeredOriginals,reading});
 const actionMode=primaryActionMode(observed.primaryAction);
 let contactMode:'visible'|'blocked'|'invalid'='invalid';
 if(observed.contactSnapshot){
  const contact=observed.contactSnapshot;
  if(observed.viewport.width<=999){
   if(contact.visibility==='hidden'&&contact.ready==='false'&&contact.tabIndex===-1&&contact.ariaHidden==='true')contactMode='blocked';
   else observed.findings.push('mobile-contact-on-hero');
  }else if(observed.contactSnapshot.visibility==='visible'&&observed.contactSnapshot.ariaHidden!=='true')contactMode='visible';
  else if(admittedEnlargedPhotoBlock(observed.primaryAction,observed.contactSnapshot))contactMode='blocked';
  else observed.findings.push('whatsapp-not-visible');
 }
 if(actionMode==='unreachable')observed.findings.push('initial-primary-action-unreachable');
 if(!matchesCurrentHeroContent(observed.heroContent))observed.findings.push('hero-competing-details');
 return {...observed,actionMode,contactMode};
}

export async function inspectDialog(page:Page){
 return page.evaluate(()=>{
  const findings:string[]=[],node=document.querySelector('dialog')!,b=node.getBoundingClientRect();
  if(!node.matches(':modal'))findings.push('dialog-not-modal');
  if(!node.contains(document.activeElement))findings.push('dialog-focus-outside');
  if(document.querySelectorAll('form').length!==1)findings.push('duplicate-form');
  if(b.left<0||b.right>innerWidth+1||b.top<0||b.bottom>innerHeight+1)findings.push('dialog-outside-viewport');
  const close=node.querySelector<HTMLButtonElement>('button[aria-label]')!,c=close.getBoundingClientRect();
  const hit=document.elementFromPoint(c.x+c.width/2,c.y+c.height/2);
  if(c.left<b.left||c.right>b.right||c.top<b.top||c.bottom>b.bottom||c.width<48||c.height<48||!hit||!close.contains(hit))findings.push('dialog-close-obscured');
  const scrollable=[...node.querySelectorAll<HTMLElement>('*')].filter(x=>!x.closest('details:not([open])')&&x.getClientRects().length>0&&['auto','scroll'].includes(getComputedStyle(x).overflowY)&&x.scrollHeight>x.clientHeight+1);
  const panels=scrollable.filter(x=>x.matches('[data-reservation-notice-version],[data-student-conduct-version]'));
  if(scrollable.length-panels.length!==1||panels.length>1||node.querySelectorAll('details[name="trip390-notice"][open]').length>1||panels.some(x=>x.tabIndex!==0||x.getAttribute('role')!=='region'||x.clientHeight>=innerHeight))findings.push('dialog-scroll-regions');
  if(document.documentElement.scrollWidth>innerWidth+1)findings.push('dialog-horizontal-overflow');
  const contact=document.querySelector<HTMLAnchorElement>('a[class*="whatsapp"]');
  if(contact&&getComputedStyle(contact).display!=='none'&&getComputedStyle(contact).visibility!=='hidden')findings.push('background-contact-visible-in-modal');
  return {findings,viewport:{width:innerWidth,height:innerHeight},close:{x:c.x,y:c.y,width:c.width,height:c.height},scrollRegions:scrollable.length};
 });
}

/** A sticky overlay cannot pass for a clipped reading viewport. */
async function readingViewport(page:Page){
 return page.evaluate(()=>{
  const pane=document.querySelector<HTMLElement>('[data-academy-reading-pane]');
  if(pane&&pane.clientHeight&&getComputedStyle(pane).overflowY==='auto')
   return {bottom:pane.getBoundingClientRect().bottom,scrollTop:pane.scrollTop,scrollWidth:pane.scrollWidth,separate:true};
  return {bottom:innerHeight,scrollTop:window.scrollY,scrollWidth:document.documentElement.scrollWidth,separate:false};
 });
}
export async function scrollLandingToTop(page:Page){
 await page.evaluate(()=>{
  const pane=document.querySelector<HTMLElement>('[data-academy-reading-pane]');
  (pane?.clientHeight?pane:document.documentElement).scrollTo({top:0,behavior:'instant'});
 });
}

/** A floating action may overlap empty row padding, never the question/glyph. */
export async function inspectFaqContact(page:Page){
 const result=await page.evaluate(reading=>{
  const findings:string[]=[],wa=document.querySelector<HTMLAnchorElement>('a[class*="whatsapp"]')!;
  const visible=getComputedStyle(wa).visibility==='visible';
  const b=wa.getBoundingClientRect();
  const icon=wa.querySelector('svg')!.getBoundingClientRect();
  const wrongCorner=innerWidth>999&&getComputedStyle(wa).direction==='rtl'?icon.right>100:icon.left<innerWidth-100;
  if(b.width<48||b.height<48||b.left<0||b.right>innerWidth||wrongCorner||b.top<0||b.bottom>innerHeight)findings.push('faq-contact-placement');
  for(const summary of document.querySelectorAll('[data-trip390-faq] summary')){
   const walker=document.createTreeWalker(summary,NodeFilter.SHOW_TEXT);
   for(let text=walker.nextNode();text;text=walker.nextNode()){
    if(!text.textContent?.trim())continue;
    const range=document.createRange();range.selectNodeContents(text);
    for(const r of range.getClientRects())if(visible&&r.left<b.right&&r.right>b.left&&r.top<b.bottom&&Math.min(r.bottom,reading.bottom)>b.top)findings.push('faq-contact-over-text-or-glyph');
   }
  }
  return {findings,lang:document.querySelector('[class*="trip390"][lang]')?.getAttribute('lang'),position:{x:b.x,y:b.y,width:b.width,height:b.height}};
 },await readingViewport(page));
 const body=await inspectBodyContact(page);
 return {...result,findings:[...result.findings,...body.findings]};
}

/** Approved discretionary/hyphen breaks are readable; orphan letters are not.
 * Reconstruct words across text nodes so a wbr cannot hide a final-letter defect. */
export async function inspectBodyHeadings(page:Page){
 return page.evaluate(()=>{
  const findings:Array<{heading:string;word:string;lineLengths:number[]}>=[];
  for(const heading of document.querySelectorAll('h2,h3')){
   if(!heading.getClientRects().length)continue;
   if(heading.closest('dialog:not([open]),details:not([open])'))continue;
   const walker=document.createTreeWalker(heading,NodeFilter.SHOW_TEXT),offsets:Array<{node:Node;offset:number}>=[];let text='';
   for(let node=walker.nextNode();node;node=walker.nextNode()){
    const value=node.textContent??'';text+=value;for(let offset=0;offset<value.length;offset++)offsets.push({node,offset});
   }
   if(text!==heading.textContent)throw Error('HEADING_TEXT_OFFSET_MISMATCH');
   for(const match of text.matchAll(/\p{L}{3,}/gu)){
    const lines:Array<{top:number;length:number}>=[];
    for(let i=0;i<match[0].length;i++){
     const position=offsets[match.index!+i]!;const char=document.createRange();char.setStart(position.node,position.offset);char.setEnd(position.node,position.offset+1);
     const box=char.getBoundingClientRect();if(box.width<=0)continue;
     let line=lines.at(-1);if(!line||Math.abs(line.top-box.top)>2){line={top:box.top,length:0};lines.push(line);}line.length++;
    }
    if(lines.length>1&&lines.some(line=>line.length===1))findings.push({heading:heading.id||text,word:match[0],lineLengths:lines.map(line=>line.length)});
   }
  }
  return findings;
 });
}

/** Actual text ranges, not paragraph boxes, distinguish whitespace from copy. */
export async function inspectBodyContact(page:Page){
 return page.evaluate(reading=>{
  const wa=document.querySelector<HTMLAnchorElement>('a[class*="whatsapp"]')!,b=wa.getBoundingClientRect(),findings:string[]=[];
  const visible=getComputedStyle(wa).visibility==='visible'&&getComputedStyle(wa).display!=='none';
  let nearContent=false;
  const nearby=(r:DOMRect)=>r.width>0&&r.height>0&&r.left<b.right+12&&r.right>b.left-12&&r.top<b.bottom+12&&r.bottom>b.top-12;
  for(const node of document.querySelectorAll('main img,main summary,main a,main button,footer'))nearContent ||= nearby(node.getBoundingClientRect());
  for(const node of document.querySelectorAll('main p,main li,main h2,main h3,main summary')){
   if(node.closest('dialog')||!node.getClientRects().length)continue;
   // Native collapsed details may retain layout rectangles for unpainted text.
   const closed=node.closest<HTMLDetailsElement>('details:not([open])');
   if(closed&&!closed.querySelector(':scope > summary')?.contains(node))continue;
   const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);
   for(let text=walker.nextNode();text;text=walker.nextNode()){
    if(!text.textContent?.trim())continue;
    const range=document.createRange();range.selectNodeContents(text);
    for(const r of range.getClientRects()){
     nearContent ||= nearby(r);
     if(visible&&r.width>0&&r.height>0&&r.left<b.right&&r.right>b.left&&r.top<b.bottom&&Math.min(r.bottom,reading.bottom)>b.top)findings.push('body-contact-over-text');
    }
   }
  }
  for(const icon of document.querySelectorAll('[data-jlfa-values] article svg')){
   const r=icon.getBoundingClientRect();
   nearContent ||= nearby(r);
   if(visible&&r.width>0&&r.height>0&&r.left<b.right&&r.right>b.left&&r.top<b.bottom&&Math.min(r.bottom,reading.bottom)>b.top)findings.push('body-contact-over-value-icon');
  }
  if(!visible&&(innerWidth>999||!nearContent||wa.tabIndex!==-1||wa.getAttribute('aria-hidden')!=='true'))findings.push('body-contact-hidden-without-obstacle');
  return {findings,position:{left:b.left,top:b.top,width:b.width,height:b.height}};
 },await readingViewport(page));
}
