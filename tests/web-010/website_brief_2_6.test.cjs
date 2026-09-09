'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'assets', 'js', 'site.js'), 'utf8');

test('WEB-010 carries the approved bilingual brand lockup', () => {
  assert.ok(html.includes('כישורי חיים'));
  assert.ok(html.includes('לחיים שלמים'));
  assert.ok(html.includes('class="brand-branch"'));
  assert.ok(script.includes('"brand": "Life Skills"'));
  assert.ok(script.includes('"tagline": ""'));
  assert.ok(!html.includes('For a full life'));
  assert.ok(!script.includes('For a full life'));
});

test('WEB-010 uses the Website Brief 2.6 hero copy in both languages', () => {
  for (const phrase of [
    'תקשורת ברורה.',
    'ויסות רגשי.',
    'אחריות שמתפתחת מבפנים.',
    'Clear communication.',
    'Emotional regulation.',
    'Responsibility that develops from within.',
    'The work looks at the whole child—body, emotions, thinking, relationships, values and purpose',
    'העבודה מתייחסת אל הילד השלם — גוף, רגש, חשיבה, קשרים, ערכים ותכלית'
  ]) assert.ok(html.includes(phrase), phrase);
});

test('WEB-010 contact actions remain direct, verified WhatsApp links', () => {
  const config = fs.readFileSync(path.join(root, 'assets', 'js', 'config.js'), 'utf8');
  assert.ok(config.includes('whatsappNumber: "972534932631"'));
  assert.ok(config.includes('whatsappVerified: true'));
  assert.ok(script.includes('https://wa.me/'));
  assert.ok(!script.includes('?text='));
});

test('WEB-010 implements the bilingual v3.1 four-area and twelve-theme approach', () => {
  for (let index = 1; index <= 12; index += 1) {
    const key = `W${String(index).padStart(2, '0')}`;
    assert.equal(html.split(`<span class="theme-key">${key}</span>`).length - 1, 2, key);
  }
  for (const phrase of [
    'Internal Family Systems',
    'Self-Determination Theory',
    'body awareness, mindfulness and meditation',
    'disagreeing respectfully',
    'learning through life',
    'חוסר הסכמה בכבוד'
  ]) assert.ok(html.toLowerCase().includes(phrase.toLowerCase()), phrase);
});

test('WEB-010 uses the owner-supplied central Israel wording without a city claim', () => {
  for (const phrase of [
    'מפגשים במרכז הארץ.',
    'מקום המפגש והמועדים נקבעים בתיאום אישי.',
    'Meetings in central Israel.',
    'Location and availability are arranged individually.'
  ]) assert.ok(html.includes(phrase), phrase);
  assert.ok(!html.includes('Beit Shemesh'));
  assert.ok(!html.includes('בית שמש'));
});
