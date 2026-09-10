import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { readJson, resolveAssetPath } from './manifest.mjs';
import { assertValid, validateComposition, verifyAssetFiles } from './validate.mjs';
import { renderFixedSvg, renderWebsite } from './render.mjs';

export async function compile({ compositionPath, assetManifestPath, copyManifestPath, brandManifestPath, outputDir, mode = 'review' }) {
  const [composition, assets, copy, brand] = await Promise.all([readJson(compositionPath), readJson(assetManifestPath), readJson(copyManifestPath), readJson(brandManifestPath)]);
  const errors = [...await verifyAssetFiles(assets, assetManifestPath), ...validateComposition(composition, assets, copy, brand, mode)];
  assertValid([...new Set(errors)]);
  const copySet = copy.copySets.find((item) => item.id === composition.copySetId);
  await mkdir(outputDir, { recursive: true });
  const referencedIds = new Set([
    ...composition.layers.filter((layer) => layer.assetId).map((layer) => layer.assetId),
    ...composition.fonts.map((font) => font.assetId)
  ]);
  const bundledPaths = new Map();
  const receiptAssets = [];
  await mkdir(resolve(outputDir, 'assets'), { recursive: true });
  for (const id of [...referencedIds].sort()) {
    const asset = assets.assets.find((item) => item.id === id);
    const extension = extname(asset.path).toLowerCase();
    const relativeOutput = `assets/${id}${extension}`;
    await copyFile(resolveAssetPath(assetManifestPath, assets.assetRoot, asset.path), resolve(outputDir, relativeOutput));
    bundledPaths.set(id, relativeOutput);
    receiptAssets.push({ id, sha256: asset.sha256, output: relativeOutput });
  }
  const extension = composition.kind === 'website' ? 'html' : 'svg';
  const outputPath = resolve(outputDir, `${composition.id}.${extension}`);
  const rendered = composition.kind === 'website'
    ? renderWebsite(composition, assets, copySet, assetManifestPath, outputDir, bundledPaths)
    : renderFixedSvg(composition, assets, copySet, assetManifestPath, outputDir, bundledPaths);
  await writeFile(outputPath, rendered, 'utf8');
  const receipt = {
    schemaVersion: 1,
    compositionId: composition.id,
    mode,
    output: outputPath,
    copySet: { id: copySet.id, domain: copySet.domain, language: copySet.language, status: copySet.status },
    assets: receiptAssets,
    productionEligible: mode === 'production'
  };
  await writeFile(resolve(outputDir, `${composition.id}.receipt.json`), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return receipt;
}
