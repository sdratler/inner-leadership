import type { Metadata } from 'next';

export type TripLandingLocale = 'en' | 'he';
export type ApprovedTripPhoto = { src: string; width: number; height: number; alt: string };
export type TripLandingMetadataInput = { locale: TripLandingLocale; publicUrl: string; photo: ApprovedTripPhoto; signupOpen?: boolean };
export const TRIP_LOCKED_LOGO = '/groups/brand/jlfa-logo-locked-v1.png';
export const TRIP_LANDING_COPY = {
  en: {
    title: 'Choose a fishing day | Jewish Leadership Fishing Academy',
    description: 'Fishing, Torah and self-governance with Rabbi Shlomo. Choose possible trip dates for your boys and register your family’s interest for free.',
    invitation: 'Fishing, Torah and self-governance with Rabbi Shlomo. Choose possible trip dates for your boys. Free signup:',
  },
  he: {
    title: 'בוחרים יום של דיג | האקדמיה לדיג ולמנהיגות יהודית',
    description: 'דיג, תורה והנהגה עצמית עם הרב שלמה. בחרו תאריכים אפשריים לבנים שלכם והירשמו ללא עלות.',
    invitation: 'דיג, תורה והנהגה עצמית עם הרב שלמה. בחרו תאריכים אפשריים לבנים שלכם. הרשמה ללא עלות:',
  },
} as const;
const TRIP_CONTACT_COPY={
  en:{title:'Fishing days with Rabbi Shlomo | Jewish Leadership Fishing Academy',description:'Fishing, Torah and self-governance with Rabbi Shlomo. See our recent fishing day in Boca Raton and ask about possible trip dates for your boys.',invitation:'Fishing, Torah and self-governance with Rabbi Shlomo. Ask about possible trip dates for your boys:'},
  he:{title:'ימי דיג עם הרב שלמה | האקדמיה לדיג ולמנהיגות יהודית',description:'דיג, תורה והנהגה עצמית עם הרב שלמה. הצצה ליום הדיג שלנו בבוקה רטון ופנייה לגבי תאריכים אפשריים לטיולים לבנים שלכם.',invitation:'דיג, תורה והנהגה עצמית עם הרב שלמה. אפשר לפנות לגבי תאריכים אפשריים לטיולים לבנים שלכם:'},
} as const;
export function tripLandingCopy(locale:TripLandingLocale,signupOpen=false){return signupOpen?TRIP_LANDING_COPY[locale]:TRIP_CONTACT_COPY[locale];}
const hosts = new Set(['bneineviimacademy.org', 'life-skills.bneineviimacademy.org']);
const publicPage = /^(?:\/(?:he\/)?fishing-academy(?:\/trips)?|\/(?:en|he)\/florida(?:\/trips)?)\/?$/;
const publicPhoto = /^\/(?:groups\/(?:academy|people)|images|trips|individual-trips)\/[A-Za-z0-9_./-]+\.(?:jpe?g|png|webp)$/i;
function invalid(): never { throw new Error('TRIP_LANDING_METADATA_UNAVAILABLE'); }
function httpsUrl(raw: string): URL {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\s\\?#%]/.test(raw) || /\/\.\.?\//.test(raw)) return invalid();
  let url: URL; try { url = new URL(raw); } catch { return invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !hosts.has(url.hostname)) return invalid();
  return url;
}
/** Caller separately admits the exact approved bytes. URL validation cannot
 * certify photo identity, owner approval or anonymous download availability. */
export function tripLandingUrls(input: TripLandingMetadataInput) {
  if (!input || !['en', 'he'].includes(input.locale)) return invalid();
  const canonical = httpsUrl(input.publicUrl), image = httpsUrl(input.photo?.src);
  if (!publicPage.test(canonical.pathname) || image.origin !== canonical.origin || !publicPhoto.test(image.pathname) || /\/(?:api|auth|private|family|parent|client|workspace|app|operations|seminar)(?:\/|$)/i.test(image.pathname)) return invalid();
  if (![input.photo.width, input.photo.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 12000) || typeof input.photo.alt !== 'string' || input.photo.alt.trim().length < 1 || input.photo.alt.length > 300 || /[\u0000-\u001f\u007f]/.test(input.photo.alt)) return invalid();
  const extension = image.pathname.split('.').at(-1)!.toLowerCase();
  const imageType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
  return { publicUrl: canonical.href, imageUrl: image.href, imageType, logoUrl: new URL(TRIP_LOCKED_LOGO, canonical).href };
}
/** Current trips only: never replace the historical seminar metadata or use a
 * private parent/owner destination as a social preview. No amount is advertised. */
export function individualTripLandingMetadata(input: TripLandingMetadataInput): Metadata {
  const urls = tripLandingUrls(input), copy = tripLandingCopy(input.locale,input.signupOpen===true);
  return {
    title: copy.title, description: copy.description, alternates: { canonical: urls.publicUrl },
    openGraph: { type: 'website', title: copy.title, description: copy.description, url: urls.publicUrl,
      siteName: input.locale === 'he' ? 'האקדמיה לדיג ולמנהיגות יהודית' : 'Jewish Leadership Fishing Academy', locale: input.locale === 'he' ? 'he_IL' : 'en_US',
      images: [{ url: urls.imageUrl, type: urls.imageType, width: input.photo.width, height: input.photo.height, alt: input.photo.alt }],
    },
    twitter: { card: 'summary_large_image', title: copy.title, description: copy.description, images: [{ url: urls.imageUrl, alt: input.photo.alt }] },
    icons: { icon: [{ url: urls.logoUrl, type: 'image/png' }], apple: [{ url: urls.logoUrl }] },
  };
}
export const tripLandingMetadata = individualTripLandingMetadata;
