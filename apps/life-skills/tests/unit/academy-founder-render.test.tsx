import {academyExactStates} from '../../src/features/group-application/academy-exact-copy.ts';
import type {FounderPublicResult} from '../../src/features/group-application/academy-founder-contract.ts';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import {AcademyRegistrationForm,AcademyRegistrationResult} from '../../src/features/group-application/academy-registration-form.tsx';
import {AcademyPricing} from '../../src/features/group-application/academy-pricing.tsx';
import {AcademyHero} from '../../src/features/group-application/academy-hero.tsx';
import bilingual from '../../src/features/group-application/academy-bilingual-copy.json';
it('renders bilingual free-only controls, unchecked privacy terms, required email, unchanged hero paths and visible actual tuition',()=>{
 for(const locale of ['en','he'] as const){const form=renderToStaticMarkup(createElement(AcademyRegistrationForm,{locale,mode:'sample'}));expect(form).toContain('name="receiptEmail"');expect(form).toMatch(/required="" type="email"/);expect(form).not.toContain('paymentPlan');expect(form).not.toContain('registration-payment');expect(form).not.toContain('Pay &amp; Confirm');expect(form.match(/<input[^>]*name="permission"[^>]*>/)?.[0]).not.toContain('checked=""');expect(form).toContain('name="permission"');expect(form).toContain(locale==='en'?'Register':'הרשמה');
 const price=renderToStaticMarkup(createElement(AcademyPricing,{locale}));for(const amount of ['$1,650','$1,750','$650'])expect(price).toContain(amount);expect(price).not.toMatch(/first 20|First 20|after verified qualifying payment/);expect(price).toContain('data-founder-counter');const hero=renderToStaticMarkup(createElement(AcademyHero,{locale}));expect(hero).toContain(`href="/${locale}/florida/apply"`);expect(hero).toContain(locale==='en'?'Register':'הרשמה');expect(JSON.stringify(bilingual)).not.toMatch(/scheduling.hold|המתנה פנימית/);
 }
});

it.each(['en','he'] as const)('%s saved states never fabricate delivery, allocation or a recipient',locale=>{
 const saved=academyExactStates[locale].save,confirmation=academyExactStates[locale].confirmation;
 const base:FounderPublicResult={status:'reserved',reference:'synthetic-ref',email:'queued',deadline:null,timezone:'America/New_York'};
 const render=(data:FounderPublicResult|null)=>renderToStaticMarkup(createElement(AcademyRegistrationResult,{locale,reference:'synthetic-ref',founder:data}));
 const visible=(value:string)=>renderToStaticMarkup(createElement('p',null,value));
 expect(render(base)).toContain(visible(saved.founderReserved));expect(render(base)).toContain(visible(saved.emailQueued));
 for(const email of ['unknown','not_queued'] as const)expect(render({...base,email})).toContain(visible(saved.emailUnknown));
 expect(render({...base,email:'delivery_problem'})).toContain(visible(saved.emailFailure));
 expect(render({...base,email:'sent'})).toContain(visible(saved.emailUnknown));expect(render({...base,email:'sent',receiptEmail:'saved@example.invalid'})).toContain(visible(saved.emailSent.replace('{email}','saved@example.invalid')));
 expect(render(null)).toContain(visible(saved.pendingAllocation));expect(render({...base,status:'regular_registration'})).toContain(visible(saved.ordinary));
 for(const founderRateReserved of [undefined,false])expect(render({...base,status:'confirmed',...(founderRateReserved===undefined?{}:{founderRateReserved})})).not.toContain(visible(confirmation.founderSentence));
 expect(render({...base,status:'confirmed',founderRateReserved:true})).toContain(visible(confirmation.founderSentence));
 expect(render({...base,status:'closed'})).not.toContain(visible(saved.founderReserved));
});
