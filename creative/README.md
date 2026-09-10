# Creative execution contracts

`creative/` is the Git-owned execution layer for deterministic Life Skills creative composition. It does not replace the current Drive business, clinical, Program, Website, Build Control, or private-original authorities.

The first CRE-010 slice provides:

- a fixed-asset manifest with byte, dimension, colour-mode, approval, and reuse constraints;
- separate website and paid-ad copy namespaces;
- a composition schema that requires explicit assets, fonts, canvas, layout, gradient, header, button, and layer geometry;
- a dependency-free validator and deterministic HTML/SVG compositors;
- production gating: every production-affecting decision must be `LOCKED` and every referenced local asset must match its declared SHA-256;
- a migration map for later pointer reconciliation after review and merge.

The approved Hebrew leaf master is the only visual output currently locked here. No English leaf logo, transparent/vector derivative, responsive website geometry, outside-logo font choice, or numeric teal gradient stop is approved by this slice.

## Commands

Run the creative suite from the repository root:

```sh
node --test creative/tests/*.test.mjs
node creative/bin/creative-compile.mjs --help
```

Compile an accepted composition:

```sh
node creative/bin/creative-compile.mjs \
  --composition creative/compositions/example.json \
  --assets creative/manifests/assets.json \
  --copy creative/manifests/copy.json \
  --brand creative/manifests/brand.json \
  --out /tmp/creative-output \
  --mode review
```

`--mode production` fails closed when a referenced asset is unverified, a value remains `REVIEW`/`UNRESOLVED`, a font file or checksum is absent, or website and paid-ad copy domains are crossed. Successful output contains byte-for-byte copies of every referenced image/font under its own `assets/` folder and records their checksums in the receipt.

No generated image prompt is accepted as layout input. Website output is HTML/CSS with real text and a real anchor element; shading is emitted as a separate overlay layer. Fixed-size output is deterministic SVG intended as a later compositor primitive, not an approved campaign export.
