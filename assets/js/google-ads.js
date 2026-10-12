(function () {
  'use strict';

  // Only the public landing page is approved for this base tag.
  var location = window.location;
  if (location.protocol !== 'https:' || location.hostname !== 'bneineviimacademy.org' ||
      !/^\/life-skills(?:\/|\/index\.html)?$/.test(location.pathname)) return;
  if (window.lifeSkillsGoogleAdsInitialized) return;
  window.lifeSkillsGoogleAdsInitialized = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };

  // A base-tag installation does not establish a visitor's consent.
  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    analytics_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied'
  });
  window.gtag('set', 'ads_data_redaction', true);
  window.gtag('js', new Date());
  window.gtag('config', 'AW-18370639584', {
    allow_ad_personalization_signals: false,
    allow_google_signals: false,
    // Exclude arbitrary query values, fragments and referrers from page metadata.
    page_location: 'https://bneineviimacademy.org/life-skills/?lang=' +
      (new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'he'),
    page_referrer: ''
  });

  // Reuse an existing gtag.js loader; a Tag Manager container is not equivalent.
  var loaderExists = Array.prototype.some.call(document.scripts, function (script) {
    return /^https:\/\/www\.googletagmanager\.com\/gtag\/js(?:\?|$)/.test(script.src);
  });
  if (!loaderExists) {
    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=AW-18370639584';
    script.referrerPolicy = 'no-referrer';
    document.head.appendChild(script);
  }
})();
