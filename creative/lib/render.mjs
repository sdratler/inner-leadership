import { relative, sep } from 'node:path';
import { resolveAssetPath } from './manifest.mjs';

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const cssBox = (box) => `left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px`;
const webPath = (fromDir, path) => relative(fromDir, path).split(sep).join('/');

function gradient(theme) {
  const stops = theme.surfaceGradient.stops.map((stop) => `${stop.color} ${stop.offset * 100}%`).join(',');
  return `linear-gradient(${theme.surfaceGradient.angleDeg}deg,${stops})`;
}

export function renderWebsite(composition, assets, copySet, manifestPath, outputDir, bundledPaths = new Map()) {
  const assetMap = new Map(assets.assets.map((asset) => [asset.id, asset]));
  const fontMap = new Map(composition.fonts.map((font) => [font.id, font]));
  const fontCss = composition.fonts.map((font) => {
    const asset = assetMap.get(font.assetId);
    return `@font-face{font-family:${JSON.stringify(font.family)};src:url(${JSON.stringify(bundledPaths.get(asset.id) ?? webPath(outputDir, resolveAssetPath(manifestPath, assets.assetRoot, asset.path)))});font-weight:${font.weight};font-style:${font.style};font-display:${font.display}}`;
  }).join('');
  const layers = [...composition.layers].sort((a, b) => a.z - b.z).map((layer) => {
    const box = layer.box ? cssBox(layer.box) : 'inset:0';
    if (layer.type === 'overlay') return `<div class="layer overlay" data-layer="${escapeHtml(layer.id)}" style="${box};opacity:${layer.opacity ?? 1}"></div>`;
    if (layer.type === 'asset') {
      const asset = assetMap.get(layer.assetId);
      return `<img class="layer asset" data-layer="${escapeHtml(layer.id)}" src="${escapeHtml(bundledPaths.get(asset.id) ?? webPath(outputDir, resolveAssetPath(manifestPath, assets.assetRoot, asset.path)))}" alt="" style="${box}">`;
    }
    const text = copySet.text[layer.copyKey];
    const font = fontMap.get(layer.fontId);
    if (layer.type === 'button') return `<a class="layer button" data-layer="${escapeHtml(layer.id)}" href="${escapeHtml(layer.href)}" style="${box};font-family:${escapeHtml(font.family)}">${escapeHtml(text)}</a>`;
    return `<div class="layer text" data-layer="${escapeHtml(layer.id)}" style="${box};font-family:${escapeHtml(font.family)}">${escapeHtml(text)}</div>`;
  }).join('');
  const dir = composition.language === 'he' ? 'rtl' : 'ltr';
  const header = composition.layout.header;
  const button = composition.theme.button;
  return `<!doctype html><html lang="${composition.language}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${fontCss}*{box-sizing:border-box}body{margin:0;background:#fff;color:${composition.theme.textColor}}.composition{position:relative;width:min(100%,${composition.output.width}px);aspect-ratio:${composition.output.width}/${composition.output.height};overflow:hidden;background:${gradient(composition.theme)}}.chrome{position:absolute}.header{${cssBox(header)};background:${composition.theme.header.backgroundColor}}.layer{position:absolute}.asset{object-fit:contain}.overlay{background:${gradient(composition.theme)};pointer-events:none}.button{display:flex;align-items:center;justify-content:center;text-decoration:none;background:${button.backgroundColor};color:${button.textColor};border:${button.borderWidthPx}px solid ${button.borderColor};border-radius:${button.borderRadiusPx}px}.text{white-space:pre-wrap}</style></head><body><main class="composition" data-composition="${escapeHtml(composition.id)}"><header class="chrome header" aria-label="brand header"></header>${layers}</main></body></html>`;
}

export function renderFixedSvg(composition, assets, copySet, manifestPath, outputDir, bundledPaths = new Map()) {
  const assetMap = new Map(assets.assets.map((asset) => [asset.id, asset]));
  const fontMap = new Map(composition.fonts.map((font) => [font.id, font]));
  const fontCss = composition.fonts.map((font) => {
    const asset = assetMap.get(font.assetId);
    const href = bundledPaths.get(asset.id) ?? webPath(outputDir, resolveAssetPath(manifestPath, assets.assetRoot, asset.path));
    return `@font-face{font-family:${JSON.stringify(font.family)};src:url(${JSON.stringify(href)});font-weight:${font.weight};font-style:${font.style}}`;
  }).join('');
  const stops = composition.theme.surfaceGradient.stops.map((stop) => `<stop offset="${stop.offset * 100}%" stop-color="${stop.color}"/>`).join('');
  const layers = [...composition.layers].sort((a, b) => a.z - b.z).map((layer) => {
    if (layer.type === 'overlay') return `<rect data-layer="${escapeHtml(layer.id)}" x="0" y="0" width="100%" height="100%" fill="url(#surface)" opacity="${layer.opacity ?? 1}"/>`;
    if (layer.type === 'asset') {
      const asset = assetMap.get(layer.assetId); const box = layer.box;
      return `<image data-layer="${escapeHtml(layer.id)}" href="${escapeHtml(bundledPaths.get(asset.id) ?? webPath(outputDir, resolveAssetPath(manifestPath, assets.assetRoot, asset.path)))}" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid meet"/>`;
    }
    const box = layer.box; const font = fontMap.get(layer.fontId); const text = copySet.text[layer.copyKey];
    return `<text data-layer="${escapeHtml(layer.id)}" x="${box.x}" y="${box.y + box.height}" font-family="${escapeHtml(font.family)}" font-weight="${font.weight}">${escapeHtml(text)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${composition.output.width}" height="${composition.output.height}" viewBox="0 0 ${composition.output.width} ${composition.output.height}" direction="${composition.language === 'he' ? 'rtl' : 'ltr'}"><defs><style>${fontCss}</style><linearGradient id="surface" gradientTransform="rotate(${composition.theme.surfaceGradient.angleDeg} .5 .5)">${stops}</linearGradient></defs><rect width="100%" height="100%" fill="url(#surface)"/>${layers}</svg>`;
}
