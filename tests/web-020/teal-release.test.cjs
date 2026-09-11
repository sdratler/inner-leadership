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
  assert.match(source, /<strong>Life Skills<\/strong>/);
  assert.doesNotMatch(source, /v43-approved-twig\.png/);
});

test('locked colors, mobile geometry, and type sources remain explicit', () => {
  for (const value of ['#245159', '#163F48', '#FBF7EF', '#E6D0A4']) assert.match(css, new RegExp(value, 'i'));
  for (const value of ['FrankRuhlLibre-wght.ttf', 'Heebo-wght.ttf', 'aspect-ratio:16/9', 'aspect-ratio:941/1529', 'min-height:98px', 'width:88px']) assert.match(css, new RegExp(value.replace(/[.]/g, '\\.'), 'i'));
  assert.doesNotMatch(css, /#153E2C/i);
});

test('hero and About copy match the owner-approved release copy', () => {
  assert.deepEqual(copy.he.hero.service_details, ['בגילאי 8–12', 'מפגשים אישיים והדרכת הורים מעשית.']);
  assert.equal(copy.he.cta.button, 'שלחו הודעה בוואטסאפ');
  assert.equal(copy.en.cta.button, 'Message on WhatsApp');
  assert.match(source, /className="mobile-language-direct"/);
  assert.equal(copy.he.founder.name, 'על שלמה דרטלר');
  assert.equal(copy.en.founder.name, 'About Shlomo Dratler');
  assert.equal(copy.he.founder.paragraphs.length, 3);
  assert.equal(copy.en.founder.paragraphs.length, 3);
});

test('hero uses the four exact owner-approved composite masters with live header and WhatsApp only', () => {
  const expected = {
    'founder-boy-hero-en-mobile.png': 'ee2924444efc3d21dda5186b3a1107c3fde935ce4c76ded75ae3458aa99c7a71',
    'founder-boy-hero-he-mobile.png': '56dc8fcbe99f16d723a8b07b41eda8ebb03eb27716829b8c786f27b82a3ddcbe',
    'founder-boy-hero-en-desktop.png': '5c28d22d7b6b784eb6becb4cfabb7977c80a304b5bcaca93943564ed74394f50',
    'founder-boy-hero-he-desktop.png': '74c7d3258770abdab5c146e1211c4cbd16e0738840d5c274390f9a707f8dd824',
  };
  for (const [name, sha256] of Object.entries(expected)) {
    const bytes = fs.readFileSync(path.join(root, 'assets/images', name));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sha256, name);
  }

  const hero = source.slice(source.indexOf('export function CampaignHero'), source.indexOf('export function OutcomeCards'));
  const order = [
    'className="sr-only hero-semantics"',
    'className="hero-art"',
    'className="hero-photo"',
    'className="hero-whatsapp"',
  ].map(marker => hero.indexOf(marker));
  assert.ok(order.every(index => index >= 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(hero, /founder-boy-hero-\$\{locale\}-desktop\.png/);
  assert.match(hero, /founder-boy-hero-\$\{locale\}-mobile\.png/);
  assert.match(hero, /alt="" aria-hidden="true"/);
  assert.match(hero, /<WhatsAppGlyph\/>/);
  assert.match(hero, /<ArrowIcon direction=/);
  assert.doesNotMatch(hero, /hero-copy|hero-service-title|hero-age|hero-benefits|figcaption|hero-photo-support|hero-support-desktop/);

  assert.match(css, /\.hero-layout\{display:block;width:100%\}/);
  assert.match(css, /\.hero-action\{position:absolute;z-index:2;left:33\.125%;top:62\.592593%;/);
  assert.match(css, /\.hero-art\{aspect-ratio:941\/1529\}.*\.hero-action\{left:8\.501594%;top:65\.467626%;width:83\.103082%;height:8\.175278%/s);
  assert.match(css, /\.hero-shell:after\{content:none\}/);
  assert.doesNotMatch(css, /\.hero-photo:after\{/);
  assert.doesNotMatch(css, /grid-column:7\/13|photo-left|side-split/i);
});

test('live hero CTA and hidden semantic text match Website Brief 2.9', () => {
  for (const marker of [
    'min-height:58px',
    'min-height:54px',
    'border-radius:999px',
    'linear-gradient(135deg,#0A5E50 0%,#024942 100%)',
    'color:#FEFDF9',
    'rgba(255,255,255,.32)',
    'width:22px',
    'width:18px',
  ]) assert.ok(css.includes(marker), marker);
  assert.match(source, /className="sr-only hero-semantics"/);
  assert.match(source, /<h1 id=\{`hero-\$\{locale\}`\}>\{section\.headline\}<\/h1>/);
  assert.deepEqual(copy.en.benefits.items.map(item => item.title), ['Self-governance', 'Emotional regulation', 'Responsibility']);
  assert.deepEqual(copy.he.benefits.items.map(item => item.title), ['הנהגה עצמית', 'ויסות רגשי', 'אחריות']);
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
