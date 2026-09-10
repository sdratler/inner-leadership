# CRE-010 migration map

Status: implementation scaffold in review; authority cutover not performed.

## Git now owns after accepted merge

| Concern | Git path | Current state |
| --- | --- | --- |
| Fixed public asset identity and reuse constraints | `creative/manifests/assets.json` | Implemented for `LS-LOGO-HE-LEAF-01` |
| Copy-domain separation | `creative/manifests/copy.json` | Implemented; unresolved text remains gated |
| Composition contract | `creative/schema/composition.schema.json` | Implemented |
| Validation/compiler/compositors | `creative/lib/**`, `creative/bin/**` | Implemented |
| Regression checks | `creative/tests/**` | Implemented |

## Drive and Project pointers after acceptance

These are intentionally not edited in CRE-010 because they are outside `creative/**` and cutover requires an accepted commit.

1. Update the existing asset register in place to point its execution implementation to the accepted commit and `creative/manifests/assets.json`; keep the Drive file as transitional authority until readback verifies the pointer.
2. Update the same current START HERE and Operating Protocol records to distinguish Drive intent/private originals from Git execution contracts. Do not create another master document.
3. Update Build Control CRE-010 with the accepted integration SHA and the pointer-reconciliation receipt. Only then may the register's migration state move from transitional to cut over.
4. Later website/ad consumers may point to versioned composition JSON only after their independent copy, palette, typography, layout, media-rights, and publication approvals are satisfied.

## Explicit non-cutovers

- Do not retire or delete the existing Drive asset register, source photographs, illustration inventory, campaign/business policy, or any Program/Website authority.
- Do not point an English surface to the Hebrew leaf master. English remains live text `Life Skills` with no tagline until an English logo is approved.
- Do not use a website hero slogan as paid-ad copy without an independent paid-ad approval.
- Do not publish a transparent extraction as the master logo. It remains a reviewed derivative.
- Do not add private or identifiable child/source-photo binaries, screenshots, contact data, or clinical content to Git or CI artifacts.
