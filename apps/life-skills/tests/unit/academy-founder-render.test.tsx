import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import {AcademyRegistrationForm} from '../../src/features/group-application/academy-registration-form.tsx';
import {AcademyPricing} from '../../src/features/group-application/academy-pricing.tsx';
import {AcademyHero} from '../../src/features/group-application/academy-hero.tsx';
import bilingual from '../../src/features/group-application/academy-bilingual-copy.json';
it('renders bilingual free-only controls, unchecked privacy terms, required email, unchanged hero paths and visible actual tuition',()=>{
 for(const locale of ['en','he'] as const){const form=renderToStaticMarkup(createElement(AcademyRegistrationForm,{locale,mode:'sample'}));expect(form).toContain('name="receiptEmail"');expect(form).toMatch(/required="" type="email"/);expect(form).not.toContain('paymentPlan');expect(form).not.toContain('registration-payment');expect(form).not.toContain('Pay &amp; Confirm');expect(form.match(/<input[^>]*name="permission"[^>]*>/)?.[0]).not.toContain('checked=""');expect(form).toContain('name="permission"');expect(form).toContain(locale==='en'?'Register':'הרשמה');
 const price=renderToStaticMarkup(createElement(AcademyPricing,{locale}));for(const amount of ['$1,650','$1,750','$650'])expect(price).toContain(amount);expect(price).not.toMatch(/first 20|First 20|after verified qualifying payment/);expect(price).toContain('data-founder-counter');const hero=renderToStaticMarkup(createElement(AcademyHero,{locale}));expect(hero).toContain('href="#pricing"');expect(hero).toContain(locale==='en'?'Register':'הרשמה');expect(JSON.stringify(bilingual)).not.toMatch(/scheduling.hold|המתנה פנימית/);
 }
});
