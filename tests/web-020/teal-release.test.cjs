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

test('approved Hebrew leaf master is unchanged and its derivative is the only Hebrew lockup', () => {
  const master = fs.readFileSync(path.join(root, 'assets/images/LS_LOGO_HE_LEAF_APPROVED_20260910.png'));
  assert.equal(crypto.createHash('sha256').update(master).digest('hex'), 'a95609b2ce76f5062be6619e5131430f11b99d7579148affebb2b545f66cc07c');
  assert.match(source, /LS_LOGO_HE_LEAF_APPROVED_20260910-transparent\.png/);
  assert.doesNotMatch(source, /v43-approved-twig\.png/);
});

test('locked colors, mobile geometry, and type sources remain explicit', () => {
  for (const value of ['#245159', '#163F48', '#FBF7EF', '#E6D0A4']) assert.match(css, new RegExp(value, 'i'));
  for (const value of ['FrankRuhlLibre-wght.ttf', 'Heebo-wght.ttf', 'font-size:64px', 'line-height:66px', 'min-height:98px', 'width:170px']) assert.match(css, new RegExp(value.replace(/[.]/g, '\\.'), 'i'));
  assert.doesNotMatch(css, /#153E2C/i);
});

test('hero and About copy match the owner-approved release copy', () => {
  assert.deepEqual(copy.he.hero.service_details, ['בגילאי 8–12', 'מפגשים אישיים והדרכת הורים מעשית.']);
  assert.equal(copy.he.cta.button, 'לתיאום פגישה בוואטסאפ');
  assert.equal(copy.he.founder.name, 'על שלמה דרטלר');
  assert.equal(copy.en.founder.name, 'About Shlomo Dratler');
  assert.equal(copy.he.founder.paragraphs.length, 3);
  assert.equal(copy.en.founder.paragraphs.length, 3);
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
