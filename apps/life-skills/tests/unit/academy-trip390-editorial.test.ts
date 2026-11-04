import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AcademyTrip390Page} from '../../src/features/group-application/academy-trip390-page.tsx';
import {trip390Copy} from '../../src/features/group-application/academy-trip390-contract.ts';
import {trip390LearningAssets} from '../../src/features/group-application/academy-trip390-learning-assets.ts';

type Node={tag:string;attrs:Record<string,string>;children:(Node|string)[];parent:Node|null};
type Copy={intro:{body:string};skills:readonly {title:string;body:string}[];price:{included:readonly string[]};faqs:readonly {id:string;q:string;a:string}[]};
type Asset={assetId:string;src:string|null;alt:{en:string;he:string}};
const normalize=(text:string)=>text.replace(/\s+/gu,' ').trim();
function decode(text:string){return text.replace(/&(?:amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi,match=>{
 const named:Record<string,string>={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"};
 if(named[match])return named[match];
 return String.fromCodePoint(parseInt(match.slice(match[2]?.toLowerCase()==='x'?3:2,-1),match[2]?.toLowerCase()==='x'?16:10));
});}
/** Bounded parser for React's valid static HTML, not a general HTML sanitizer.
 * It deliberately retains parents: essential copy beneath a closed disclosure
 * or hidden ancestor is not accepted merely because its bytes are present.
 */
export function parseEditorialHtml(html:string):Node{
 if(html.length>2_000_000)throw new Error('EDITORIAL_HTML_BOUND');
 const root:Node={tag:'#root',attrs:{},children:[],parent:null};let current=root;
 const voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
 const tokens=html.match(/<!--[\s\S]*?-->|<\/?[a-z][\w:-]*(?:[^<>"']|"[^"]*"|'[^']*')*>|[^<]+/gi)??[];
 if(tokens.join('')!==html)throw new Error('EDITORIAL_HTML_UNPARSED');
 for(const token of tokens){
  if(token.startsWith('<!--'))continue;
  if(!token.startsWith('<')){current.children.push(decode(token));continue;}
  const tag=token.match(/^<\/?([\w:-]+)/)?.[1]?.toLowerCase();if(!tag)throw new Error('EDITORIAL_TAG');
  if(token.startsWith('</')){if(current.tag!==tag||!current.parent)throw new Error('EDITORIAL_NESTING');current=current.parent;continue;}
  const attrs:Record<string,string>={};const rest=token.slice(tag.length+1).replace(/\/?\s*>$/,'');
  for(const match of rest.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)){
   const key=match[1]!.toLowerCase();if(key in attrs)throw new Error('EDITORIAL_DUPLICATE_ATTRIBUTE');attrs[key]=decode(match[2]??match[3]??match[4]??'');
  }
  const node:Node={tag,attrs,children:[],parent:current};current.children.push(node);
  if(!voids.has(tag)&&!token.endsWith('/>'))current=node;
 }
 if(current!==root)throw new Error('EDITORIAL_UNCLOSED');return root;
}
function descendants(node:Node):Node[]{return node.children.flatMap(child=>typeof child==='string'?[]:[child,...descendants(child)]);}
function text(node:Node):string{return normalize(node.children.map(child=>typeof child==='string'?child:text(child)).join(' '));}
function exposed(node:Node,main:Node):boolean{
 let belongsToMain=false;
 for(let current:Node|null=node;current;current=current.parent){
  if('hidden' in current.attrs||current.attrs['aria-hidden']==='true'||/\b(?:display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden)\b/i.test(current.attrs.style??''))return false;
  if(current.tag==='details'&&!('open' in current.attrs))return false;
  if(current.tag==='dialog'&&!('open' in current.attrs))return false;
  if(current===main)belongsToMain=true;
 }return belongsToMain;
}
export function auditEditorialStructure(root:Node,copy:Copy,assets:readonly Asset[],locale:'en'|'he'){
 const violations:string[]=[];const missingImages:string[]=[];const all=descendants(root);
 const mains=all.filter(node=>node.tag==='main');if(mains.length!==1)return {violations:['MAIN_IDENTITY'],missingImages};
 const main=mains[0]!;const nodes=descendants(main);
 const section=(id:string)=>{const found=nodes.filter(node=>node.tag==='section'&&node.attrs.id===id);if(found.length!==1){violations.push('SECTION_'+id);return undefined;}return found[0];};
 const learn=section('learn'),how=section('how'),cost=section('included'),faq=section('faq');
 const positions=[learn,how,cost,faq].map(node=>node?nodes.indexOf(node):-1);
 if(positions.some((value,index)=>value<0||(index>0&&value<=positions[index-1]!)))violations.push('SECTION_JOB_ORDER');
 const paragraphs=nodes.filter(node=>node.tag==='p'&&!hasAncestor(node,'dialog'));
 if(paragraphs.filter(node=>text(node)===normalize(copy.intro.body)).length!==1)violations.push('OFFER_REPETITION_OR_ABSENCE');
 const cards=learn?descendants(learn).filter(node=>node.tag==='article'&&'data-trip390-skill' in node.attrs):[];
 if(cards.length!==copy.skills.length||assets.length!==copy.skills.length)violations.push('LEARNING_CARD_COUNT');
 copy.skills.forEach((skill,index)=>{
  const card=cards[index],asset=assets[index],key=String(index+1);
  if(!card||!asset)return;
  const contents=descendants(card),heading=contents.filter(node=>node.tag==='h3'),summary=contents.filter(node=>node.tag==='p');
  if(card.attrs['data-trip390-skill']!==key||heading.length!==1||text(heading[0]!)!==normalize(skill.title)||!exposed(heading[0]!,main))violations.push('CARD_HEADING_'+key);
  if(summary.length!==1||text(summary[0]!)!==normalize(skill.body)||!exposed(summary[0]!,main))violations.push('CARD_SUMMARY_'+key);
  if(paragraphs.filter(node=>text(node)===normalize(skill.body)).length!==1)violations.push('OUTCOME_REPETITION_'+key);
  const images=contents.filter(node=>node.tag==='img');
  if(asset.src){
   if(images.length!==1||images[0]!.attrs.src!==asset.src||images[0]!.attrs['data-academy-scene']!==asset.assetId||images[0]!.attrs.alt!==asset.alt[locale]||!exposed(images[0]!,main))violations.push('IMAGE_PAIRING_'+key);
  }else{
   missingImages.push(asset.assetId);
   if(images.length||contents.filter(node=>node.attrs['data-trip390-image-unavailable']===key).length!==1)violations.push('UNAVAILABLE_IMAGE_SUBSTITUTED_'+key);
  }
 });
 const lists=cost?descendants(cost).filter(node=>node.tag==='ul'):[];
 const inclusions=lists.length===1?lists[0]!.children.filter((node):node is Node=>typeof node!=='string'&&node.tag==='li'):[];
 if(lists.length!==1||inclusions.length!==copy.price.included.length||inclusions.some((node,index)=>text(node)!==normalize(copy.price.included[index]??'')||!exposed(node,main)))violations.push('SINGLE_COMPLETE_INCLUSION_LIST');
 // FAQ answers may be collapsed intentionally; this checks their complete
 // source-order content, not a claim of current painted visibility.
 const questions=faq?descendants(faq).filter(node=>node.tag==='details'&&'data-trip390-faq' in node.attrs):[];
 if(questions.length!==copy.faqs.length)violations.push('FAQ_CATALOG_COUNT');
 copy.faqs.forEach((item,index)=>{
  const question=questions[index];if(!question){violations.push('FAQ_'+item.id);return;}
  const parts=descendants(question),summary=parts.find(node=>node.tag==='summary');
  const label=summary?.children.find((node):node is Node=>typeof node!=='string'&&node.tag==='span'&&node.attrs['aria-hidden']!=='true');
  const answers=question.children.filter((node):node is Node=>typeof node!=='string'&&node.tag==='p');
  if(question.attrs.id!==item.id||!label||text(label)!==normalize(item.q)||answers.length!==1||text(answers[0]!)!==normalize(item.a))violations.push('FAQ_'+item.id);
 });
 return {violations,missingImages};
}
function hasAncestor(node:Node,tag:string){for(let p=node.parent;p;p=p.parent)if(p.tag===tag)return true;return false;}

describe('current Trip390 editorial structure, separate from human meaning and pixels',()=>{
 for(const locale of ['en','he'] as const){
  const html=()=>renderToStaticMarkup(createElement(AcademyTrip390Page,{initialLocale:locale}));
  const audit=(root:Node)=>auditEditorialStructure(root,trip390Copy[locale],trip390LearningAssets,locale);
  const first=(root:Node,predicate:(node:Node)=>boolean)=>{const node=descendants(root).find(predicate);if(!node)throw new Error('SPECIMEN_REQUIRED');return node;};
  it(`keeps adopted section jobs, exact outcomes and image pairings (${locale})`,()=>{
   const result=audit(parseEditorialHtml(html()));expect(result.violations).toEqual([]);
   // Missing assets are an explicit open publication finding, never a semantic PASS for six images.
   expect(result.missingImages).toEqual(trip390LearningAssets.filter(asset=>!asset.src).map(asset=>asset.assetId));
   expect(trip390Copy[locale].faqs.map(item=>item.id)).toEqual(expect.arrayContaining(['withdrawal','makeup','weather']));
  });
  it.each(['withdrawal','makeup','weather'])(`rejects omission of a newly adopted FAQ (${locale}, %s)`,id=>{
   const root=parseEditorialHtml(html()),question=first(root,node=>node.tag==='details'&&node.attrs.id===id);
   question.parent!.children.splice(question.parent!.children.indexOf(question),1);
   expect(audit(root).violations).toContain('FAQ_CATALOG_COUNT');
  });
  it(`rejects the old logistics-before-learning arrangement (${locale})`,()=>{
   const root=parseEditorialHtml(html()),learn=first(root,node=>node.attrs.id==='learn'),how=first(root,node=>node.attrs.id==='how');
   const siblings=learn.parent!.children;const left=siblings.indexOf(learn),right=siblings.indexOf(how);[siblings[left],siblings[right]]=[siblings[right]!,siblings[left]!];
   expect(audit(root).violations).toContain('SECTION_JOB_ORDER');
  });
  it(`rejects a different holdout: valid tarpon bytes paired with the reel outcome (${locale})`,()=>{
   const root=parseEditorialHtml(html()),card=first(root,node=>node.attrs['data-trip390-skill']==='1');
   const image=first(card,node=>node.tag==='img'),other=trip390LearningAssets[4]!;
   image.attrs.src=other.src!;image.attrs['data-academy-scene']=other.assetId;image.attrs.alt=other.alt[locale];
   expect(audit(root).violations).toContain('IMAGE_PAIRING_1');
  });
  it(`rejects repeated correct copy rather than approving string presence (${locale})`,()=>{
   const root=parseEditorialHtml(html()),card=first(root,node=>node.attrs['data-trip390-skill']==='3'),summary=first(card,node=>node.tag==='p');
   card.children.push({tag:'p',attrs:{},children:[text(summary)],parent:card});
   expect(audit(root).violations).toContain('OUTCOME_REPETITION_3');
  });
  it.each(['hidden','closed-details','aria-hidden','inline-display-none'])(`rejects an ancestor hiding essential summaries (${locale}, %s)`,mode=>{
   const root=parseEditorialHtml(html()),learn=first(root,node=>node.attrs.id==='learn'),parent=learn.parent!;
   const wrapper:Node={tag:mode==='closed-details'?'details':'section',attrs:mode==='hidden'?{hidden:''}:mode==='aria-hidden'?{'aria-hidden':'true'}:mode==='inline-display-none'?{style:'display: none'}:{},children:[learn],parent};
   parent.children[parent.children.indexOf(learn)]=wrapper;learn.parent=wrapper;
   expect(audit(root).violations).toContain('CARD_SUMMARY_1');
  });
  it.each(['hidden','aria-hidden','closed-details'])(`rejects hidden ancestors outside main (${locale}, %s)`,mode=>{
   const root=parseEditorialHtml(html()),main=first(root,node=>node.tag==='main'),parent=main.parent!;
   const wrapper:Node={tag:mode==='closed-details'?'details':'section',attrs:mode==='hidden'?{hidden:''}:mode==='aria-hidden'?{'aria-hidden':'true'}:{},children:[main],parent};
   parent.children[parent.children.indexOf(main)]=wrapper;main.parent=wrapper;
   expect(audit(root).violations).toContain('CARD_SUMMARY_1');
  });
 }
});
