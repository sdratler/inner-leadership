import type {Page} from '@playwright/test';

/** Scoped measurable checks, not a visual score or substitute for image review. */
export async function inspectLanding(page:Page){
 return page.evaluate(()=>{
  const findings:string[]=[];
  const box=(node:Element)=>node.getBoundingClientRect();
  const heading=document.querySelector('#trip390-title')!;
  const hero=heading.closest('section')!,photo=hero.querySelector('img')!;
  const hb=box(hero),ib=box(photo),header=box(document.querySelector('header')!);
  const width=document.documentElement.clientWidth;
  if(document.documentElement.scrollWidth>innerWidth+1)findings.push('page-horizontal-overflow');
  if(Math.abs(hb.left)>1||Math.abs(hb.right-width)>1)findings.push('hero-boxed');
  if(!photo.complete||!photo.naturalWidth)findings.push('hero-image-unloaded');
  if(/390|USD|9\+|אחריות|Cooperation/.test(hero.textContent??''))findings.push('hero-competing-details');
  for(const span of heading.querySelectorAll('span')){
   const walker=document.createTreeWalker(span,NodeFilter.SHOW_TEXT);
   for(let text=walker.nextNode();text;text=walker.nextNode())for(const match of (text.textContent??'').matchAll(/\S+/g)){
    const range=document.createRange();range.setStart(text,match.index!);range.setEnd(text,match.index!+match[0].length);
    if([...range.getClientRects()].filter(r=>r.width>0&&r.height>0).length>1)findings.push('hero-word-fragment');
   }
  }
  if(innerHeight>600&&hero.getAttribute('data-reflow')!=='true'&&Math.abs(hb.bottom-innerHeight)>3)findings.push('hero-first-screen-height');
  if(getComputedStyle(document.querySelector('header')!).position!=='sticky')findings.push('header-not-sticky');
  const primary=[...document.querySelectorAll<HTMLAnchorElement>('[data-hero-action] a,header a[href="#interest"]')];
  if(!primary.some(node=>{const b=box(node),s=getComputedStyle(node);return s.display!=='none'&&s.visibility!=='hidden'&&b.width>=48&&b.height>=48&&b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth;}))findings.push('initial-primary-action-unreachable');
  if(primary.some(node=>/[↗→]/.test(node.textContent??'')))findings.push('ornamental-primary-arrow');
  if(document.body.textContent?.includes('Review candidate ·'))findings.push('internal-review-banner');
  // These focal rectangles come from inspecting the exact protected originals
  // for this task. They cover faces/hands/people, not a second asset master.
  const mobile=photo.currentSrc.includes('hero-mobile');
  const focal=mobile?[.035,.30,.905,.65]:[.29,.27,.68,.76];
  const fit=getComputedStyle(photo).objectFit;
  const scale=fit==='cover'?Math.max(ib.width/photo.naturalWidth,ib.height/photo.naturalHeight):Math.min(ib.width/photo.naturalWidth,ib.height/photo.naturalHeight);
  const painted={left:ib.left+(ib.width-photo.naturalWidth*scale)/2,top:ib.top+(ib.height-photo.naturalHeight*scale)/2};
  const subject={left:painted.left+focal[0]!*photo.naturalWidth*scale,top:painted.top+focal[1]!*photo.naturalHeight*scale,right:painted.left+focal[2]!*photo.naturalWidth*scale,bottom:painted.top+focal[3]!*photo.naturalHeight*scale};
  if(subject.left<ib.left-1||subject.right>ib.right+1||subject.top<ib.top-1||subject.bottom>ib.bottom+1)findings.push('protected-subject-cropped');
  for(const node of hero.querySelectorAll('[data-hero-heading],[data-hero-action]')){
   const b=box(node),overlap=b.left<subject.right&&b.right>subject.left&&b.top<subject.bottom&&b.bottom>subject.top;
   if(overlap)findings.push('hero-text-over-subject');
   if(b.left<0||b.right>width+1||b.bottom>hb.bottom+1)findings.push('hero-control-clipped');
  }
  const faq=document.querySelector('#faq')!,groups=[...faq.querySelectorAll('section')];
  if(groups.length!==2||faq.querySelectorAll('[data-trip390-faq]').length!==19)findings.push('faq-structure-missing');
  if(groups.length===2){
   const a=box(groups[0]!),b=box(groups[1]!),title=box(faq.querySelector('h2')!);
   if(title.bottom>Math.min(a.top,b.top)+1)findings.push('faq-heading-rail');
   if(width>=1000&&(Math.abs(a.top-b.top)>2||Math.abs(a.width-b.width)>2))findings.push('faq-unbalanced-columns');
  }
  const portrait=document.querySelector<HTMLImageElement>('img[src="/groups/people/founder-head.jpg"]');
  if(!portrait||!portrait.complete||!portrait.naturalWidth||getComputedStyle(portrait).borderRadius!=='50%')findings.push('founder-portrait-missing');
  const wa=document.querySelector<HTMLAnchorElement>('a[class*="whatsapp"]');
  if(!wa)findings.push('whatsapp-missing');
  else{
   if(getComputedStyle(wa).visibility!=='visible'||wa.getAttribute('aria-hidden')==='true')findings.push('whatsapp-not-visible');
   const b=box(wa),lift=parseFloat(getComputedStyle(wa).getPropertyValue('--contact-lift'))||0;
   // Bounded local collision avoidance: three controls, four for protected photo.
   if(getComputedStyle(wa).position!=='fixed'||b.width<48||Math.abs(width-b.right)>40||lift<0||lift>224||innerHeight-b.bottom>242||b.bottom>innerHeight)findings.push('whatsapp-placement');
   if(b.left<subject.right&&b.right>subject.left&&b.top<subject.bottom&&b.bottom>subject.top)findings.push('whatsapp-over-subject');
   if(!wa.href.startsWith('https://wa.me/13054916674?'))findings.push('whatsapp-destination');
   for(const control of document.querySelectorAll('a,button,summary')){
    if(control===wa||control.closest('dialog')||control.getClientRects().length===0)continue;
    const c=box(control);
    if(c.left<b.right&&c.right>b.left&&c.top<b.bottom&&c.bottom>b.top)findings.push('whatsapp-obscures-control');
   }
  }
  return {findings,viewport:{width:innerWidth,height:innerHeight},headerHeight:header.height,hero:{left:hb.left,width:hb.width,height:hb.height,bottom:hb.bottom},image:{src:photo.currentSrc,fit,subject},faqCount:faq.querySelectorAll('[data-trip390-faq]').length};
 });
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
  const scrollable=[...node.querySelectorAll<HTMLElement>('*')].filter(x=>['auto','scroll'].includes(getComputedStyle(x).overflowY)&&x.scrollHeight>x.clientHeight+1);
  if(scrollable.length!==1)findings.push('dialog-scroll-regions');
  if(document.documentElement.scrollWidth>innerWidth+1)findings.push('dialog-horizontal-overflow');
  const contact=document.querySelector<HTMLAnchorElement>('a[class*="whatsapp"]');
  if(contact&&getComputedStyle(contact).display!=='none'&&getComputedStyle(contact).visibility!=='hidden')findings.push('background-contact-visible-in-modal');
  return {findings,viewport:{width:innerWidth,height:innerHeight},close:{x:c.x,y:c.y,width:c.width,height:c.height},scrollRegions:scrollable.length};
 });
}

/** A floating action may overlap empty row padding, never the question/glyph. */
export async function inspectFaqContact(page:Page){
 return page.evaluate(()=>{
  const findings:string[]=[],wa=document.querySelector<HTMLAnchorElement>('a[class*="whatsapp"]')!;
  if(getComputedStyle(wa).visibility!=='visible'||wa.getAttribute('aria-hidden')==='true')findings.push('faq-contact-hidden');
  const b=wa.getBoundingClientRect();
  if(b.width<48||b.right>innerWidth||b.left<innerWidth-100||b.top<0||b.bottom>innerHeight)findings.push('faq-contact-placement');
  for(const summary of document.querySelectorAll('[data-trip390-faq] summary')){
   const walker=document.createTreeWalker(summary,NodeFilter.SHOW_TEXT);
   for(let text=walker.nextNode();text;text=walker.nextNode()){
    if(!text.textContent?.trim())continue;
    const range=document.createRange();range.selectNodeContents(text);
    for(const r of range.getClientRects())if(r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top)findings.push('faq-contact-over-text-or-glyph');
   }
  }
  return {findings,lang:document.querySelector('[class*="trip390"][lang]')?.getAttribute('lang'),position:{x:b.x,y:b.y,width:b.width,height:b.height}};
 });
}

/** Whole words reflow between lines; letter fragments are not readable headings. */
export async function inspectBodyHeadings(page:Page){
 return page.evaluate(()=>{
  const findings:Array<{heading:string;word:string;lineLengths:number[]}>=[];
  for(const heading of document.querySelectorAll('h2,h3')){
   if(!heading.getClientRects().length)continue;
   const walker=document.createTreeWalker(heading,NodeFilter.SHOW_TEXT);
   for(let text=walker.nextNode();text;text=walker.nextNode())for(const match of (text.textContent??'').matchAll(/\p{L}{4,}/gu)){
    const range=document.createRange();range.setStart(text,match.index!);range.setEnd(text,match.index!+match[0].length);
    if(range.getClientRects().length<2)continue;
    const lines=new Map<number,number>();
    for(let i=0;i<match[0].length;i++){
     const char=document.createRange();char.setStart(text,match.index!+i);char.setEnd(text,match.index!+i+1);
     const box=char.getBoundingClientRect(),top=Math.round(box.top);
     if(box.width>0)lines.set(top,(lines.get(top)??0)+1);
    }
    if(lines.size>1)findings.push({heading:heading.id||heading.textContent||'',word:match[0],lineLengths:[...lines.values()]});
   }
  }
  return findings;
 });
}

/** Actual text ranges, not paragraph boxes, distinguish whitespace from copy. */
export async function inspectBodyContact(page:Page){
 return page.evaluate(()=>{
  const wa=document.querySelector<HTMLAnchorElement>('a[class*="whatsapp"]')!,b=wa.getBoundingClientRect(),findings:string[]=[];
  if(getComputedStyle(wa).visibility!=='visible'||getComputedStyle(wa).display==='none')findings.push('body-contact-hidden');
  for(const node of document.querySelectorAll('main p,main li,main h2,main h3,main summary')){
   if(node.closest('dialog')||!node.getClientRects().length)continue;
   // Native collapsed details may retain layout rectangles for unpainted text.
   const closed=node.closest<HTMLDetailsElement>('details:not([open])');
   if(closed&&!closed.querySelector(':scope > summary')?.contains(node))continue;
   const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);
   for(let text=walker.nextNode();text;text=walker.nextNode()){
    if(!text.textContent?.trim())continue;
    const range=document.createRange();range.selectNodeContents(text);
    for(const r of range.getClientRects())if(r.width>0&&r.height>0&&r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top)findings.push('body-contact-over-text');
   }
  }
  return {findings,position:{left:b.left,top:b.top,width:b.width,height:b.height}};
 });
}
