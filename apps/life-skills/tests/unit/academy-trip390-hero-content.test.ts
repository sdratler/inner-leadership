import {describe,it,expect} from 'vitest';
import {trip390Copy} from '../../src/features/group-application/academy-trip390-contract.ts';
import {matchesCurrentHeroContent,type HeroContentSnapshot} from '../e2e/group-interest/academy-trip390.visual-checks.ts';

function approved(locale:'en'|'he'):HeroContentSnapshot{
 const hero=trip390Copy[locale].hero,blocks=[hero.eyebrow,hero.title,hero.pillars,hero.interest_cta];
 return {locale,blocks,allText:blocks.join(' '),headingCount:1,titleCount:1,paragraphCount:2,actionCount:1,linkCount:1};
}
describe('current bilingual hero content boundary',()=>{
 for(const locale of ['en','he'] as const){
  it(`accepts only the current catalog hero (${locale})`,()=>expect(matchesCurrentHeroContent(approved(locale))).toBe(true));
  it(`rejects old promotional text added outside the expected blocks (${locale})`,()=>{
   const value=approved(locale);value.allText+=' $390 USD 9+';
   expect(matchesCurrentHeroContent(value)).toBe(false);
  });
  it(`rejects an unrelated extra claim even without any retired blacklist word (${locale})`,()=>{
   const value=approved(locale);value.allText+=locale==='en'?' Guaranteed weekly trophy catch':'תפיסת דג מובטחת בכל שבוע';
   expect(matchesCurrentHeroContent(value)).toBe(false);
  });
  it(`rejects the other locale and a changed pillar (${locale})`,()=>{
   const value=approved(locale);value.locale=locale==='en'?'he':'en';
   expect(matchesCurrentHeroContent(value)).toBe(false);
   const changed=approved(locale);changed.blocks[2]+=' EXTRA';changed.allText=changed.blocks.join(' ');
   expect(matchesCurrentHeroContent(changed)).toBe(false);
  });
 }
 it('rejects a second hero action even when its visible text is otherwise identical',()=>{
  const value=approved('en');value.actionCount=2;value.linkCount=2;
  expect(matchesCurrentHeroContent(value)).toBe(false);
 });
 it('rejects reordered blocks and duplicate text',()=>{
  const value=approved('he');[value.blocks[0],value.blocks[2]]=[value.blocks[2]!,value.blocks[0]!];value.allText=value.blocks.join(' ');
  expect(matchesCurrentHeroContent(value)).toBe(false);
  const duplicate=approved('en');duplicate.allText+=' '+duplicate.blocks[2];
  expect(matchesCurrentHeroContent(duplicate)).toBe(false);
 });
});
