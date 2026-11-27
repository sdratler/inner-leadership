import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IndividualTripLanding } from '../../src/features/individual-trips/landing.tsx';
import { individualTripLandingMetadata, tripLandingUrls, TRIP_LOCKED_LOGO, type TripLandingMetadataInput } from '../../src/features/individual-trips/metadata.ts';

// Synthetic URL/alt fixture only. No file retrieval, artwork approval or actual
// owner photograph is asserted by these pure metadata and markup tests.
const origin = 'https://bneineviimacademy.org';
const photo = { src: origin + '/groups/academy/photos/synthetic-recent-bass-fixture.jpg', width: 1200, height: 1600, alt: 'Synthetic approved-photo input fixture, not an image approval' };
const input = (locale: 'en' | 'he' = 'en'): TripLandingMetadataInput => ({ locale, publicUrl: origin + (locale === 'he' ? '/he/fishing-academy/trips' : '/fishing-academy/trips'), photo: { ...photo } });

describe('current-trip photo-led public metadata', () => {
  it.each(['en', 'he'] as const)('uses the supplied photo as the %s preview and keeps the locked logo exclusively as favicon', locale => {
    const value = input(locale), metadata = individualTripLandingMetadata(value), logo = origin + TRIP_LOCKED_LOGO;
    expect(metadata).toMatchObject({ alternates: { canonical: value.publicUrl }, openGraph: { type: 'website', url: value.publicUrl, images: [{ url: photo.src, type: 'image/jpeg', width: photo.width, height: photo.height, alt: photo.alt }] }, twitter: { card: 'summary_large_image', images: [{ url: photo.src, alt: photo.alt }] }, icons: { icon: [{ url: logo, type: 'image/png' }], apple: [{ url: logo }] } });
    expect(metadata.openGraph).toMatchObject({ title: metadata.title, description: metadata.description });
    expect(metadata.twitter).toMatchObject({ title: metadata.title, description: metadata.description });
    expect(JSON.stringify(metadata)).not.toMatch(/\$|USD|₪|\b(?:150|100|300|250|650)\s*dollars|November 22|11\/22\/26|Bass Fishing Seminar|token=/);
    expect(metadata.description).toMatch(locale === 'he' ? /ללא עלות/ : /for free/);
  });
  it('is deterministic and does not mutate frozen URL/photo inputs', () => {
    const value = Object.freeze({ ...input(), photo: Object.freeze({ ...photo }) }), before = JSON.stringify(value);
    const first = individualTripLandingMetadata(value), second = individualTripLandingMetadata(value);
    expect(second).toEqual(first); expect(JSON.stringify(value)).toBe(before); expect(first).not.toBe(second);
  });
  it.each([
    'http://bneineviimacademy.org/fishing-academy/trips',
    'https://foreign.invalid/fishing-academy/trips',
    'https://bneineviimacademy.org/en/login',
    'https://bneineviimacademy.org/en/trips',
    'https://bneineviimacademy.org/en/family/trips',
    'https://bneineviimacademy.org/api/private/individual-trips',
    'https://bneineviimacademy.org/fish',
    'https://bneineviimacademy.org/fishing-academy/trips?token=private',
    'https://bneineviimacademy.org/fishing-academy/trips?next=/en/family',
    'https://bneineviimacademy.org/fishing-academy/trips#token=private',
    'https://secret@bneineviimacademy.org/fishing-academy/trips',
    'https://bneineviimacademy.org:8443/fishing-academy/trips',
    'https://bneineviimacademy.org/auth/../fishing-academy/trips',
    'https://bneineviimacademy.org/fishing-academy/%2e%2e/trips',
  ])('rejects an unsafe/private/historical canonical destination: %s', publicUrl => {
    expect(() => individualTripLandingMetadata({ ...input(), publicUrl })).toThrow('TRIP_LANDING_METADATA_UNAVAILABLE');
  });
  it.each([
    'https://foreign.invalid/groups/academy/photos/synthetic.jpg',
    'https://life-skills.bneineviimacademy.org/groups/academy/photos/synthetic.jpg',
    'http://bneineviimacademy.org/groups/academy/photos/synthetic.jpg',
    origin + '/groups/private/synthetic.jpg',
    origin + '/groups/academy/private/synthetic.jpg',
    origin + '/api/private/photo.jpg',
    origin + '/en/family/photo.jpg',
    origin + '/seminar/bass-fishing-seminar-20261122.jpg',
    origin + TRIP_LOCKED_LOGO,
    origin + '/groups/academy/photos/synthetic.jpg?token=private',
    origin + '/groups/academy/photos/synthetic.jpg#private',
    origin + '/groups/academy/photos/synthetic.html',
    origin + '/groups/academy/photos/../../private/synthetic.jpg',
    origin + '/groups/academy/photos/%2e%2e/private/synthetic.jpg',
  ])('rejects wrong-origin/private/nonphoto image URLs: %s', src => {
    expect(() => individualTripLandingMetadata({ ...input(), photo: { ...photo, src } })).toThrow('TRIP_LANDING_METADATA_UNAVAILABLE');
  });
  it.each([0, -1, 1.5, Infinity, NaN, 12001])('rejects invalid image dimensions: %s', width => {
    expect(() => individualTripLandingMetadata({ ...input(), photo: { ...photo, width } })).toThrow('TRIP_LANDING_METADATA_UNAVAILABLE');
    expect(() => individualTripLandingMetadata({ ...input(), photo: { ...photo, height: width } })).toThrow('TRIP_LANDING_METADATA_UNAVAILABLE');
  });
  it.each(['', ' ', 'Synthetic\nprivate', 'x'.repeat(301)])('requires bounded meaningful image alt text', alt => {
    expect(() => individualTripLandingMetadata({ ...input(), photo: { ...photo, alt } })).toThrow('TRIP_LANDING_METADATA_UNAVAILABLE');
  });
  it.each([['png', 'image/png'], ['webp', 'image/webp'], ['jpeg', 'image/jpeg']] as const)('reports the exact %s photo MIME without changing its URL', (extension, type) => {
    const src = photo.src.replace(/jpg$/, extension), metadata = individualTripLandingMetadata({ ...input(), photo: { ...photo, src } });
    expect(metadata.openGraph).toMatchObject({ images: [{ url: src, type }] });
  });
  it('supports the existing service-domain public landing only with a same-origin public photo', () => {
    const publicUrl = 'https://life-skills.bneviimacademy.org/en/florida/trips';
    expect(() => individualTripLandingMetadata({ ...input(), publicUrl })).toThrow('TRIP_LANDING_METADATA_UNAVAILABLE');
    const correct = 'https://life-skills.bneineviimacademy.org/en/florida/trips';
    expect(tripLandingUrls({ ...input(), publicUrl: correct, photo: { ...photo, src: new URL('/groups/academy/photos/synthetic.jpg', correct).href } }).publicUrl).toBe(correct);
  });
});

describe('unmounted candidate landing markup', () => {
  it.each(['en', 'he'] as const)('keeps the exact supplied photo, truthful provenance and free-date action in %s', locale => {
    const value = input(locale), markup = renderToStaticMarkup(createElement(IndividualTripLanding, { ...value, photo: { ...photo, src: '/groups/academy/photos/synthetic-recent-bass-fixture.jpg' } }));
    expect(markup).toContain(`lang="${locale}"`); expect(markup).toContain(`dir="${locale === 'he' ? 'rtl' : 'ltr'}"`);
    expect(markup).toContain('src="/groups/academy/photos/synthetic-recent-bass-fixture.jpg"'); expect(markup).toContain('width="1200" height="1600"');
    expect(markup).toContain('Bass Fishing Seminar / Sunday 11/22/26 • Boca Raton'); expect(markup).toContain('Torah • Fishing • Self-Governance');
    expect(markup).toContain(`href="/${locale}/trips"`); expect(markup).toContain('https://wa.me/13054278909?text=');
    expect(markup).not.toContain('tel:'); expect(markup).not.toContain('/_next/image'); expect(markup).not.toMatch(/\$|USD|₪|650|305-491-6674/);
    expect(markup).toContain(locale === 'he' ? 'במהלך פסח' : 'during Pesach'); expect(markup).toContain(locale === 'he' ? 'לא אישור מקום' : 'not a confirmed place');
    expect(markup).toContain(encodeURIComponent(value.publicUrl)); expect(markup).toContain('role="status"');
  });
  it('requires an explicit photo prop and never manufactures a hero fallback', () => {
    expect(() => renderToStaticMarkup(createElement(IndividualTripLanding, { ...input(), photo: undefined } as never))).toThrow();
  });
});
