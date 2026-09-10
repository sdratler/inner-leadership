import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compile } from '../lib/compile.mjs';
import { readJson } from '../lib/manifest.mjs';
import { validateComposition, verifyAssetFiles } from '../lib/validate.mjs';
import { renderFixedSvg } from '../lib/render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const creative = resolve(here, '..');
const assetManifestPath = join(creative, 'manifests', 'assets.json');
const copyManifestPath = join(creative, 'manifests', 'copy.json');

const box = (x, y, width, height) => ({ x, y, width, height });

async function syntheticFixture(kind = 'website') {
  const dir = await mkdtemp(join(tmpdir(), 'cre-010-'));
  const logoSource = join(creative, 'assets', 'LS_LOGO_HE_LEAF_APPROVED_20260910.png');
  const logo = join(dir, 'logo.png');
  const font = join(dir, 'font.woff2');
  await cp(logoSource, logo);
  await writeFile(font, 'synthetic-font-fixture');
  const hash = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
  const assets = {
    schemaVersion: 1,
    assetRoot: '.',
    assets: [
      { id: 'LS-LOGO-HE-LEAF-01', kind: 'logo', path: 'logo.png', sha256: await hash(logo), mediaType: 'image/png', width: 2172, height: 724, colorMode: 'RGB', hasAlpha: false, approval: { status: 'LOCKED', scope: ['website:he:header'] }, embeddedCopy: { language: 'he', brand: 'כישורי חיים', tagline: 'לחיים שלמים' }, reuse: { allowRegeneration: false, allowRecolor: false, allowMirror: false, allowRetype: false } },
      { id: 'font', kind: 'font', path: 'font.woff2', sha256: await hash(font), mediaType: 'font/woff2', approval: { status: 'LOCKED', scope: ['test'] } }
    ]
  };
  const copy = { schemaVersion: 1, rules: { crossDomainFallback: false, englishTaglineAllowed: false }, copySets: [
    { id: 'website.he.test', domain: 'website', language: 'he', status: 'LOCKED', text: { headline: 'כישורי חיים', button: 'לחיים שלמים' } },
    { id: 'paid.he.test', domain: 'paid_ads', language: 'he', status: 'LOCKED', text: { headline: 'מודעה נפרדת' } }
  ] };
  const brand = {
    schemaVersion: 1,
    manifestId: 'synthetic-brand',
    hebrewLogo: { assetId: 'LS-LOGO-HE-LEAF-01', status: 'LOCKED', pixelPolicy: 'PRESERVE_EXACT_PIXELS' },
    englishLogo: { assetId: null, status: 'UNRESOLVED', fallback: 'LIVE_TEXT_LIFE_SKILLS_NO_TAGLINE' },
    websiteSurface: { intent: 'TEAL_BLUE_GREEN_DARKEN_TOWARD_BOTTOM', directionStatus: 'LOCKED', exactGradientStops: [{ offset: 0, color: '#227F7A' }, { offset: 1, color: '#07504C' }], exactGradientStopsStatus: 'LOCKED' },
    typographyOutsideLogo: { fonts: ['font'], status: 'LOCKED', logoLetteringMustNotBeRetyped: true },
    responsiveGeometry: { status: 'LOCKED' },
    copyDomains: { website: 'INDEPENDENT', paid_ads: 'INDEPENDENT', crossDomainFallback: false }
  };
  const composition = {
    schemaVersion: 1,
    id: `synthetic-${kind}`,
    kind,
    domain: kind === 'website' ? 'website' : 'paid_ads',
    language: 'he',
    brandManifestId: 'synthetic-brand',
    copySetId: kind === 'website' ? 'website.he.test' : 'paid.he.test',
    decisionState: 'LOCKED',
    output: { width: 390, height: 720, format: kind === 'website' ? 'html' : 'svg' },
    fonts: [{ id: 'body', assetId: 'font', family: 'Synthetic Test Font', weight: 700, style: 'normal', display: 'swap', decisionState: 'LOCKED' }],
    theme: {
      surfaceIntent: 'TEAL_BLUE_GREEN_DARKEN_TOWARD_BOTTOM',
      surfaceGradient: { angleDeg: 180, stops: [{ offset: 0, color: '#227F7A' }, { offset: 1, color: '#07504C' }], decisionState: 'LOCKED' },
      textColor: '#FFFFFF',
      header: { backgroundColor: '#FFFFFF00', decisionState: 'LOCKED' },
      button: { backgroundColor: '#FFFFFF', textColor: '#07504C', borderColor: '#07504C', borderWidthPx: 1, borderRadiusPx: 24, decisionState: 'LOCKED' }
    },
    layout: { header: box(16, 16, 358, 96), logo: box(16, 16, 160, 54), content: box(24, 180, 342, 220), button: box(24, 420, 180, 52), decisionState: 'LOCKED' },
    layers: kind === 'website' ? [
      { id: 'logo', type: 'asset', assetId: 'LS-LOGO-HE-LEAF-01', box: box(16, 16, 160, 54), z: 2, decisionState: 'LOCKED' },
      { id: 'shade', type: 'overlay', opacity: 0.4, z: 1, decisionState: 'LOCKED' },
      { id: 'heading', type: 'text', copyKey: 'headline', fontId: 'body', box: box(24, 180, 342, 80), z: 3, decisionState: 'LOCKED' },
      { id: 'cta', type: 'button', copyKey: 'button', fontId: 'body', href: 'https://example.invalid', box: box(24, 420, 180, 52), z: 3, decisionState: 'LOCKED' }
    ] : [
      { id: 'shade', type: 'overlay', opacity: 0.4, z: 1, decisionState: 'LOCKED' },
      { id: 'heading', type: 'text', copyKey: 'headline', fontId: 'body', box: box(24, 180, 342, 80), z: 2, decisionState: 'LOCKED' }
    ]
  };
  const assetPath = join(dir, 'assets.json'); const copyPath = join(dir, 'copy.json'); const brandPath = join(dir, 'brand.json'); const compositionPath = join(dir, 'composition.json');
  await writeFile(assetPath, JSON.stringify(assets)); await writeFile(copyPath, JSON.stringify(copy)); await writeFile(brandPath, JSON.stringify(brand)); await writeFile(compositionPath, JSON.stringify(composition));
  return { dir, assets, copy, brand, composition, assetPath, copyPath, brandPath, compositionPath };
}

test('approved Hebrew leaf master matches locked pixels and metadata', async () => {
  const manifest = await readJson(assetManifestPath);
  assert.deepEqual(await verifyAssetFiles(manifest, assetManifestPath), []);
  const logo = manifest.assets.find((asset) => asset.id === 'LS-LOGO-HE-LEAF-01');
  assert.equal(logo.sha256, 'a95609b2ce76f5062be6619e5131430f11b99d7579148affebb2b545f66cc07c');
  assert.deepEqual([logo.width, logo.height, logo.colorMode, logo.hasAlpha], [2172, 724, 'RGB', false]);
  assert.equal(logo.reuse.allowRecolor, false);
});

test('website and paid-ad copy cannot cross domains', async () => {
  const fixture = await syntheticFixture('website');
  fixture.composition.copySetId = 'paid.he.test';
  assert.ok(validateComposition(fixture.composition, fixture.assets, fixture.copy, fixture.brand).includes('COPY_DOMAIN_CROSSING'));
});

test('English output cannot place the locked Hebrew logo', async () => {
  const fixture = await syntheticFixture('website');
  fixture.composition.language = 'en';
  fixture.copy.copySets[0].language = 'en';
  assert.ok(validateComposition(fixture.composition, fixture.assets, fixture.copy, fixture.brand).includes('ENGLISH_HEBREW_LOGO_FORBIDDEN:logo'));
});

test('production compilation fails closed on review settings', async () => {
  const fixture = await syntheticFixture('website');
  fixture.composition.theme.surfaceGradient.decisionState = 'REVIEW';
  await writeFile(fixture.compositionPath, JSON.stringify(fixture.composition));
  await assert.rejects(() => compile({ compositionPath: fixture.compositionPath, assetManifestPath: fixture.assetPath, copyManifestPath: fixture.copyPath, brandManifestPath: fixture.brandPath, outputDir: join(fixture.dir, 'out'), mode: 'production' }), /PRODUCTION_REVIEW_STATE_BLOCKED/);
});

test('website compiler emits real text, asset, overlay, font and anchor layers', async () => {
  const fixture = await syntheticFixture('website');
  const receipt = await compile({ compositionPath: fixture.compositionPath, assetManifestPath: fixture.assetPath, copyManifestPath: fixture.copyPath, brandManifestPath: fixture.brandPath, outputDir: join(fixture.dir, 'out'), mode: 'production' });
  const html = await readFile(receipt.output, 'utf8');
  assert.match(html, /@font-face/);
  assert.match(html, /<img class="layer asset"/);
  assert.match(html, /<div class="layer overlay"/);
  assert.match(html, /<a class="layer button"/);
  assert.match(html, /כישורי חיים/);
  assert.equal(await readFile(join(fixture.dir, 'out', 'assets', 'LS-LOGO-HE-LEAF-01.png'), 'hex'), await readFile(join(fixture.dir, 'logo.png'), 'hex'));
  assert.deepEqual(receipt.assets.map((item) => item.id), ['LS-LOGO-HE-LEAF-01', 'font']);
});

test('fixed-size compositor is deterministic and does not accept prompt text as layout', async () => {
  const fixture = await syntheticFixture('fixed_size');
  const copySet = fixture.copy.copySets.find((item) => item.id === fixture.composition.copySetId);
  const one = renderFixedSvg(fixture.composition, fixture.assets, copySet, fixture.assetPath, fixture.dir);
  const two = renderFixedSvg(fixture.composition, fixture.assets, copySet, fixture.assetPath, fixture.dir);
  assert.equal(one, two);
  assert.match(one, /^<svg/);
  assert.equal(Object.hasOwn(fixture.composition, 'prompt'), false);
});
