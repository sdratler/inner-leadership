import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { inspectPng, resolveAssetPath, sha256 } from './manifest.mjs';

const STATES = new Set(['LOCKED', 'REVIEW', 'UNRESOLVED']);

function requireValue(condition, code, errors) {
  if (!condition) errors.push(code);
}

function requireBox(box, name, errors) {
  requireValue(box && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(box[key])), `LAYOUT_BOX_INVALID:${name}`, errors);
  if (box) requireValue(box.width > 0 && box.height > 0, `LAYOUT_BOX_SIZE_INVALID:${name}`, errors);
}

export function validateAssetManifest(manifest) {
  const errors = [];
  requireValue(manifest?.schemaVersion === 1, 'ASSET_SCHEMA_VERSION', errors);
  requireValue(typeof manifest?.assetRoot === 'string' && manifest.assetRoot.length > 0, 'ASSET_ROOT_MISSING', errors);
  requireValue(Array.isArray(manifest?.assets) && manifest.assets.length > 0, 'ASSET_LIST_EMPTY', errors);
  const ids = new Set();
  for (const asset of manifest?.assets ?? []) {
    requireValue(asset.id && !ids.has(asset.id), `ASSET_ID_INVALID:${asset.id ?? ''}`, errors);
    ids.add(asset.id);
    requireValue(/^[a-f0-9]{64}$/.test(asset.sha256 ?? ''), `ASSET_SHA_INVALID:${asset.id}`, errors);
    requireValue(typeof asset.path === 'string' && asset.path.length > 0, `ASSET_PATH_MISSING:${asset.id}`, errors);
    requireValue(typeof asset.path === 'string' && !asset.path.includes('..') && !asset.path.startsWith('/') && !/^[A-Za-z]:/.test(asset.path), `ASSET_PATH_OUTSIDE_ROOT:${asset.id}`, errors);
    requireValue(STATES.has(asset.approval?.status), `ASSET_APPROVAL_INVALID:${asset.id}`, errors);
    if (asset.kind === 'logo') {
      requireValue(asset.reuse?.allowRegeneration === false, `LOGO_REGEN_FORBIDDEN:${asset.id}`, errors);
      requireValue(asset.reuse?.allowRecolor === false, `LOGO_RECOLOR_FORBIDDEN:${asset.id}`, errors);
      requireValue(asset.reuse?.allowMirror === false, `LOGO_MIRROR_FORBIDDEN:${asset.id}`, errors);
      requireValue(asset.reuse?.allowRetype === false, `LOGO_RETYPE_FORBIDDEN:${asset.id}`, errors);
    }
  }
  return errors;
}

export async function verifyAssetFiles(manifest, manifestPath) {
  const errors = validateAssetManifest(manifest);
  for (const asset of manifest.assets ?? []) {
    const path = resolveAssetPath(manifestPath, manifest.assetRoot, asset.path);
    let bytes;
    try {
      bytes = await readFile(path);
    } catch {
      errors.push(`ASSET_FILE_MISSING:${asset.id}`);
      continue;
    }
    if (sha256(bytes) !== asset.sha256) errors.push(`ASSET_SHA_MISMATCH:${asset.id}`);
    if (asset.mediaType === 'image/png') {
      try {
        const image = await inspectPng(path);
        if (image.width !== asset.width || image.height !== asset.height) errors.push(`ASSET_DIMENSION_MISMATCH:${asset.id}`);
        if (image.colorMode !== asset.colorMode || image.hasAlpha !== asset.hasAlpha) errors.push(`ASSET_COLOR_MODE_MISMATCH:${asset.id}`);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }
  return errors;
}

export function validateCopyManifest(manifest) {
  const errors = [];
  requireValue(manifest?.schemaVersion === 1, 'COPY_SCHEMA_VERSION', errors);
  requireValue(manifest?.rules?.crossDomainFallback === false, 'COPY_CROSS_DOMAIN_MUST_BE_FALSE', errors);
  requireValue(manifest?.rules?.englishTaglineAllowed === false, 'COPY_EN_TAGLINE_RULE', errors);
  const ids = new Set();
  for (const set of manifest?.copySets ?? []) {
    requireValue(set.id && !ids.has(set.id), `COPY_ID_INVALID:${set.id ?? ''}`, errors);
    ids.add(set.id);
    requireValue(['website', 'paid_ads'].includes(set.domain), `COPY_DOMAIN_INVALID:${set.id}`, errors);
    requireValue(['he', 'en'].includes(set.language), `COPY_LANGUAGE_INVALID:${set.id}`, errors);
    requireValue(STATES.has(set.status), `COPY_STATUS_INVALID:${set.id}`, errors);
    if (set.language === 'en') requireValue(!Object.hasOwn(set.text ?? {}, 'tagline'), `ENGLISH_TAGLINE_FORBIDDEN:${set.id}`, errors);
  }
  return errors;
}

export function validateBrandManifest(manifest) {
  const errors = [];
  requireValue(manifest?.schemaVersion === 1, 'BRAND_SCHEMA_VERSION', errors);
  requireValue(manifest?.hebrewLogo?.assetId === 'LS-LOGO-HE-LEAF-01', 'BRAND_HEBREW_LOGO_ID', errors);
  requireValue(manifest?.hebrewLogo?.status === 'LOCKED', 'BRAND_HEBREW_LOGO_STATE', errors);
  requireValue(manifest?.hebrewLogo?.pixelPolicy === 'PRESERVE_EXACT_PIXELS', 'BRAND_LOGO_PIXEL_POLICY', errors);
  requireValue(manifest?.englishLogo?.assetId === null, 'BRAND_ENGLISH_LOGO_NOT_APPROVED', errors);
  requireValue(manifest?.englishLogo?.fallback === 'LIVE_TEXT_LIFE_SKILLS_NO_TAGLINE', 'BRAND_ENGLISH_FALLBACK', errors);
  requireValue(manifest?.websiteSurface?.intent === 'TEAL_BLUE_GREEN_DARKEN_TOWARD_BOTTOM', 'BRAND_SURFACE_DIRECTION', errors);
  requireValue(manifest?.copyDomains?.crossDomainFallback === false, 'BRAND_COPY_DOMAIN_RULE', errors);
  return errors;
}

export function validateComposition(composition, assets, copy, brand, mode = 'review') {
  const errors = [...validateAssetManifest(assets), ...validateCopyManifest(copy), ...validateBrandManifest(brand)];
  requireValue(composition?.schemaVersion === 1, 'COMPOSITION_SCHEMA_VERSION', errors);
  requireValue(['website', 'fixed_size'].includes(composition?.kind), 'COMPOSITION_KIND', errors);
  requireValue(['website', 'paid_ads'].includes(composition?.domain), 'COMPOSITION_DOMAIN', errors);
  requireValue(['he', 'en'].includes(composition?.language), 'COMPOSITION_LANGUAGE', errors);
  requireValue(composition?.brandManifestId === brand?.manifestId, 'BRAND_MANIFEST_ID', errors);
  requireValue(STATES.has(composition?.decisionState), 'COMPOSITION_STATE', errors);
  requireValue(Number.isInteger(composition?.output?.width) && composition.output.width > 0, 'OUTPUT_WIDTH', errors);
  requireValue(Number.isInteger(composition?.output?.height) && composition.output.height > 0, 'OUTPUT_HEIGHT', errors);
  requireValue(composition?.output?.format === (composition?.kind === 'website' ? 'html' : 'svg'), 'OUTPUT_FORMAT', errors);

  const copySet = copy.copySets?.find((item) => item.id === composition.copySetId);
  requireValue(Boolean(copySet), 'COPY_SET_MISSING', errors);
  if (copySet) {
    requireValue(copySet.domain === composition.domain, 'COPY_DOMAIN_CROSSING', errors);
    requireValue(copySet.language === composition.language, 'COPY_LANGUAGE_CROSSING', errors);
  }

  const assetMap = new Map((assets.assets ?? []).map((item) => [item.id, item]));
  requireValue(Boolean(assetMap.get(brand?.hebrewLogo?.assetId)), 'BRAND_HEBREW_LOGO_ASSET_MISSING', errors);
  const fontMap = new Map();
  for (const font of composition.fonts ?? []) {
    requireValue(font.id && !fontMap.has(font.id), `FONT_ID_INVALID:${font.id ?? ''}`, errors);
    fontMap.set(font.id, font);
    const asset = assetMap.get(font.assetId);
    requireValue(Boolean(asset), `FONT_ASSET_MISSING:${font.id}`, errors);
    if (asset) requireValue(asset.kind === 'font', `FONT_ASSET_KIND:${font.id}`, errors);
    requireValue(typeof font.family === 'string' && font.family.length > 0, `FONT_FAMILY_MISSING:${font.id}`, errors);
    requireValue(Number.isInteger(font.weight), `FONT_WEIGHT_INVALID:${font.id}`, errors);
    requireValue(STATES.has(font.decisionState), `FONT_STATE_INVALID:${font.id}`, errors);
  }

  requireValue(Array.isArray(composition?.theme?.surfaceGradient?.stops) && composition.theme.surfaceGradient.stops.length >= 2, 'GRADIENT_STOPS', errors);
  requireValue(composition?.theme?.surfaceIntent === brand?.websiteSurface?.intent, 'SURFACE_INTENT', errors);
  requireValue(Number.isFinite(composition?.theme?.surfaceGradient?.angleDeg), 'GRADIENT_ANGLE', errors);
  requireValue(STATES.has(composition?.theme?.surfaceGradient?.decisionState), 'GRADIENT_STATE', errors);
  requireValue(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(composition?.theme?.header?.backgroundColor ?? ''), 'HEADER_COLOR', errors);
  requireValue(STATES.has(composition?.theme?.header?.decisionState), 'HEADER_STATE', errors);
  requireValue(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(composition?.theme?.button?.backgroundColor ?? ''), 'BUTTON_BACKGROUND', errors);
  requireValue(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(composition?.theme?.button?.textColor ?? ''), 'BUTTON_TEXT_COLOR', errors);
  requireValue(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(composition?.theme?.button?.borderColor ?? ''), 'BUTTON_BORDER_COLOR', errors);
  requireValue(Number.isFinite(composition?.theme?.button?.borderWidthPx), 'BUTTON_BORDER_WIDTH', errors);
  requireValue(Number.isFinite(composition?.theme?.button?.borderRadiusPx), 'BUTTON_BORDER_RADIUS', errors);
  requireValue(STATES.has(composition?.theme?.button?.decisionState), 'BUTTON_STATE', errors);
  for (const name of ['header', 'logo', 'content', 'button']) requireBox(composition?.layout?.[name], name, errors);
  requireValue(STATES.has(composition?.layout?.decisionState), 'LAYOUT_STATE', errors);

  const layerIds = new Set();
  for (const layer of composition.layers ?? []) {
    requireValue(layer.id && !layerIds.has(layer.id), `LAYER_ID_INVALID:${layer.id ?? ''}`, errors);
    layerIds.add(layer.id);
    requireValue(['asset', 'overlay', 'text', 'button'].includes(layer.type), `LAYER_TYPE:${layer.id}`, errors);
    requireValue(Number.isInteger(layer.z), `LAYER_Z:${layer.id}`, errors);
    requireValue(STATES.has(layer.decisionState), `LAYER_STATE:${layer.id}`, errors);
    if (layer.box) requireBox(layer.box, `layer:${layer.id}`, errors);
    if (layer.type === 'asset') {
      const asset = assetMap.get(layer.assetId);
      requireValue(Boolean(asset), `LAYER_ASSET_MISSING:${layer.id}`, errors);
      if (asset && composition.language === 'en' && asset.embeddedCopy?.language === 'he') errors.push(`ENGLISH_HEBREW_LOGO_FORBIDDEN:${layer.id}`);
    }
    if (layer.type === 'text' || layer.type === 'button') {
      requireValue(copySet && Object.hasOwn(copySet.text ?? {}, layer.copyKey), `COPY_KEY_MISSING:${layer.id}`, errors);
      requireValue(Boolean(fontMap.get(layer.fontId)), `LAYER_FONT_MISSING:${layer.id}`, errors);
    }
  }

  if (mode === 'production') {
    const states = [composition.decisionState, copySet?.status, composition.theme?.surfaceGradient?.decisionState,
      composition.theme?.header?.decisionState, composition.theme?.button?.decisionState, composition.layout?.decisionState,
      ...(composition.fonts ?? []).map((item) => item.decisionState), ...(composition.layers ?? []).map((item) => item.decisionState)];
    if (states.some((state) => state !== 'LOCKED')) errors.push('PRODUCTION_REVIEW_STATE_BLOCKED');
    if (brand?.websiteSurface?.exactGradientStopsStatus !== 'LOCKED' || !Array.isArray(brand?.websiteSurface?.exactGradientStops)) errors.push('PRODUCTION_BRAND_GRADIENT_REVIEW_BLOCKED');
    if (brand?.typographyOutsideLogo?.status !== 'LOCKED') errors.push('PRODUCTION_BRAND_TYPOGRAPHY_REVIEW_BLOCKED');
    if (brand?.responsiveGeometry?.status !== 'LOCKED') errors.push('PRODUCTION_BRAND_GEOMETRY_REVIEW_BLOCKED');
    for (const layer of composition.layers ?? []) {
      if (layer.type === 'asset' && assetMap.get(layer.assetId)?.approval?.status !== 'LOCKED') errors.push(`PRODUCTION_ASSET_NOT_LOCKED:${layer.assetId}`);
    }
  }
  return [...new Set(errors)];
}

export function assertValid(errors) {
  if (errors.length) throw new Error(errors.join('\n'));
}

export function assetMimeFromPath(path) {
  const ext = extname(path).toLowerCase();
  return ext === '.woff2' ? 'font/woff2' : ext === '.woff' ? 'font/woff' : ext === '.png' ? 'image/png' : 'application/octet-stream';
}
