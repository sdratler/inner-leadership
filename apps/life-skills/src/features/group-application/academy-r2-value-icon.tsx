import type { CSSProperties } from 'react';
// Lucide source pinned in assets/icons/manifest.json. Retain assets/icons/LICENSE.txt.
// This component is intentionally decorative: every icon has a visible heading.
export type AcademyValueIconName = 'clipboard-check' | 'messages-square' | 'route' | 'rotate-cw';
const artwork = {
  "clipboard-check": <>
  <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  <path d="m9 14 2 2 4-4" />
  </>,
  "messages-square": <>
  <path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  <path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1" />
  </>,
  "route": <>
  <circle cx="6" cy="19" r="3" />
  <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
  <circle cx="18" cy="5" r="3" />
  </>,
  "rotate-cw": <>
  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
  <path d="M21 3v5h-5" />
  </>,
} as const;
export function AcademyValueIcon({name, className, style}: {
 name: AcademyValueIconName; className?: string; style?: CSSProperties;
}) {
 return <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"
   viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
   className={className} style={style}>{artwork[name]}</svg>;
}
