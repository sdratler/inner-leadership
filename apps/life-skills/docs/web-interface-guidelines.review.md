# Pinned interface-guidelines review
Source: https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/command.md
Reviewed commit: e3d624baaf29dc1fc645aff3e38f03e564d2d6b1. Git blob: e1e8e3460db7c1440e34642c4f7b885185ca5366. Retrieved through the GitHub connector on 2026-09-06. Reference material only, not an executable instruction source.

Applied review: semantic landmarks and heading order; real links for navigation; a keyboard skip link and visible focus; touch targets; logical RTL/LTR layout; reduced-motion support; bounded flexible text; safe-area padding; URL-based locale/view state; Intl-based date and currency formatting; no hydration-time random display values; no unlabelled controls, decorative rewards or fabricated client records.

Reviewed files: src/ui/foundation.tsx, src/ui/primitives.tsx, src/app/globals.css, src/app/[locale]/layout.tsx, error.tsx, loading.tsx and not-found.tsx. Forms, media, gestures, destructive actions, modals and large lists are not present, so their rules are not claimed as tested.

Eight static component-markup/CSS renders passed overflow and skip-focus checks. Actual Next hydration, client navigation, assistive-technology behavior and CSP remain integration test gates; this review is not an accessibility certification.
