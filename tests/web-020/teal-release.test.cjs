const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const copy = JSON.parse(read('website/redesign-copy.json'));
const source = read('src/life-skills-page.jsx');
const css = read('assets/css/site.css');
const bundle = read('assets/js/site-react.js');

test('approved Hebrew leaf master is unchanged and its derivative appears in both language lockups', () => {
  const master = fs.readFileSync(path.join(root, 'assets/images/LS_LOGO_HE_LEAF_APPROVED_20260910.png'));
  assert.equal(crypto.createHash('sha256').update(master).digest('hex'), 'a95609b2ce76f5062be6619e5131430f11b99d7579148affebb2b545f66cc07c');
  assert.match(source, /LS_LOGO_HE_LEAF_APPROVED_20260910-transparent\.png/);
  assert.match(source, /className="brand-hebrew-logo"/);
  assert.match(source, /<strong>\{brand\.name\}<\/strong>/);
  assert.doesNotMatch(source, /v43-approved-twig\.png/);
});

test('locked colors, mobile geometry, and type sources remain explicit', () => {
  for (const value of ['#245159', '#163F48', '#FBF7EF', '#E6D0A4']) assert.match(css, new RegExp(value, 'i'));
  for (const value of ['FrankRuhlLibre-wght.ttf', 'Heebo-wght.ttf', 'font-size:54px', 'line-height:56px', 'min-height:98px', 'width:170px']) assert.match(css, new RegExp(value.replace(/[.]/g, '\\.'), 'i'));
  assert.doesNotMatch(css, /#153E2C/i);
});

test('hero and About copy match the owner-approved release copy', () => {
  assert.deepEqual(copy.he.hero.service_details, ['בגילאי 8–12', 'מפגשים אישיים והדרכת הורים מעשית.']);
  assert.equal(copy.he.cta.button, 'לפרטים בוואטסאפ');
  assert.equal(copy.en.cta.button, 'Find out more on WhatsApp');
  assert.match(source, /className="mobile-language-direct"/);
  assert.equal(copy.he.founder.name, 'על שלמה דרטלר');
  assert.equal(copy.en.founder.name, 'About Shlomo Dratler');
  assert.equal(copy.he.founder.paragraphs.length, 3);
  assert.equal(copy.en.founder.paragraphs.length, 3);
});

test('testimonial precedes founder and pricing uses the owner-approved monthly wording', () => {
  const appMarkup = source.slice(source.indexOf('return <><Header'));
  assert.ok(appMarkup.indexOf('<PrivateTestimonial') < appMarkup.indexOf('<FounderSection'));
  assert.equal(copy.he.faq.items.find(item => item.id === 'fee').answer, '2,200 ₪ לארבעה מפגשים בחודש.');
  assert.equal(copy.en.faq.items.find(item => item.id === 'fee').answer, '₪2,200 for four sessions a month.');
  assert.doesNotMatch(copy.he.faq.items.find(item => item.id === 'fee').answer, /550|60/);
  assert.doesNotMatch(copy.en.faq.items.find(item => item.id === 'fee').answer, /550|60/);
});

test('approved UX refinement is structured, bilingual, and face-safe', () => {
  assert.match(source, /section\.feature\.sodas_steps/);
  assert.match(source, /section\.feature\.frustration_steps/);
  assert.match(source, /className="footer-whatsapp"/);
  assert.match(source, /className="footer-phone"/);
  assert.match(css, /border:2px solid var\(--gold\)/);
  assert.match(css, /object-position:66% 50%/);
  assert.equal(copy.he.teaching.approach_intro.feature.motivation_heading, 'מוטיבציה פנימית');
  assert.equal(copy.en.teaching.approach_intro.feature.motivation_heading, 'Intrinsic motivation');
  assert.deepEqual(copy.en.teaching.approach_intro.feature.sodas_steps, ['Situation', 'Options', 'Disadvantages', 'Advantages', 'Solution']);
});

test('the twelve-session carousel is ordered, manual, keyboard-aware, and reduced-motion safe', () => {
  for (const locale of ['he', 'en']) {
    assert.deepEqual(copy[locale].teaching.modules.map(module => module.internal_theme_key), Array.from({length: 12}, (_, index) => `W${String(index + 1).padStart(2, '0')}`));
  }
  for (const marker of ['function CurriculumCarousel', "event.key === 'ArrowLeft'", "event.key === 'Home'", "event.key === 'End'", 'prefers-reduced-motion: reduce']) assert.match(source, new RegExp(marker.replace(/[()]/g, '\\$&')));
  assert.doesNotMatch(source + css, /autoplay/i);
});

test('all primary CTAs use the verified direct WhatsApp destination', () => {
  assert.equal(copy.contact.whatsapp_url, 'https://wa.me/972534932631');
  assert.match(source, /href=\{contact\}/);
  assert.doesNotMatch(copy.contact.whatsapp_url, /[?&]text=/);
});

test('the public bundle excludes non-public editorial and workstation metadata', () => {
  for (const marker of [
    'editorial_notes',
    'C:/Users/',
    'public testimonial consent not established',
    'L Bars, 2024',
  ]) {
    assert.equal(bundle.includes(marker), false, marker);
  }
});
