(() => {
  "use strict";

  const config = window.INNER_LEADERSHIP_CONFIG || {};
  const html = document.documentElement;
  const storageKey = "innerLeadershipLanguage";
  const supported = ["en", "he"];

  function normalizeLanguage(value) {
    return supported.includes(value) ? value : "en";
  }

  function getInitialLanguage() {
    const params = new URLSearchParams(window.location.search);
    const queryLang = params.get("lang");
    if (supported.includes(queryLang)) return queryLang;
    const stored = localStorage.getItem(storageKey);
    if (supported.includes(stored)) return stored;
    const browser = (navigator.language || "").toLowerCase();
    if (browser.startsWith("he")) return "he";
    return normalizeLanguage(config.defaultLanguage);
  }

  function setLanguage(lang, persist = true) {
    const normalized = normalizeLanguage(lang);
    html.lang = normalized;
    html.dir = normalized === "he" ? "rtl" : "ltr";
    if (persist) localStorage.setItem(storageKey, normalized);
    document.querySelectorAll("[data-lang-label]").forEach((el) => {
      el.textContent = normalized === "he" ? "EN" : "עברית";
      el.setAttribute("aria-label", normalized === "he" ? "Switch to English" : "החלפה לעברית");
    });
    document.querySelectorAll("[data-consultation-link]").forEach((el) => {
      const fallback = `apply.html?lang=${normalized}`;
      el.href = config.consultationUrl || fallback;
    });
    document.querySelectorAll("[data-label-en]").forEach((el) => {
      const value = normalized === "he" ? el.dataset.labelHe : el.dataset.labelEn;
      if (value) el.setAttribute("data-label", value);
    });
    document.dispatchEvent(new CustomEvent("innerleadership:language", { detail: { lang: normalized } }));
  }

  window.InnerLeadership = window.InnerLeadership || {};
  window.InnerLeadership.setLanguage = setLanguage;
  window.InnerLeadership.getLanguage = () => html.lang;
  window.InnerLeadership.config = config;

  document.addEventListener("DOMContentLoaded", () => {
    setLanguage(getInitialLanguage(), false);

    document.querySelectorAll("[data-language-toggle]").forEach((button) => {
      button.addEventListener("click", () => setLanguage(html.lang === "he" ? "en" : "he"));
    });

    const menuButton = document.querySelector("[data-menu-toggle]");
    const navLinks = document.querySelector("[data-nav-links]");
    if (menuButton && navLinks) {
      menuButton.addEventListener("click", () => {
        const open = navLinks.classList.toggle("open");
        menuButton.setAttribute("aria-expanded", String(open));
      });
      navLinks.addEventListener("click", (event) => {
        if (event.target.closest("a")) {
          navLinks.classList.remove("open");
          menuButton.setAttribute("aria-expanded", "false");
        }
      });
    }

    document.querySelectorAll("[data-faq-question]").forEach((button) => {
      button.addEventListener("click", () => {
        const item = button.closest(".faq-item");
        const open = item.classList.toggle("open");
        button.setAttribute("aria-expanded", String(open));
      });
    });

    const observer = "IntersectionObserver" in window
      ? new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("visible");
              observer.unobserve(entry.target);
            }
          });
        }, { threshold: 0.12 })
      : null;

    document.querySelectorAll(".reveal").forEach((el) => {
      if (observer) observer.observe(el);
      else el.classList.add("visible");
    });

    const videoShell = document.querySelector("[data-masterclass-video]");
    if (videoShell && config.masterclassVideoUrl) {
      const iframe = document.createElement("iframe");
      iframe.src = config.masterclassVideoUrl;
      iframe.title = "Inner Leadership masterclass";
      iframe.allow = "autoplay; fullscreen; picture-in-picture";
      iframe.allowFullscreen = true;
      videoShell.innerHTML = "";
      videoShell.appendChild(iframe);
    }

    document.querySelectorAll("[data-whatsapp-link]").forEach((el) => {
      if (config.whatsappUrl) el.href = config.whatsappUrl;
      else el.hidden = true;
    });

    document.querySelectorAll("[data-contact-email]").forEach((el) => {
      if (config.contactEmail) {
        el.href = `mailto:${config.contactEmail}`;
        el.textContent = config.contactEmail;
      } else {
        el.hidden = true;
      }
    });

    loadTracking(config);
    updateYear();
  });

  function updateYear() {
    document.querySelectorAll("[data-year]").forEach((el) => {
      el.textContent = new Date().getFullYear();
    });
  }

  function loadScript(src, id) {
    if (id && document.getElementById(id)) return;
    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    if (id) script.id = id;
    document.head.appendChild(script);
  }

  function loadTracking(options) {
    if (options.ga4MeasurementId) {
      loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(options.ga4MeasurementId)}`, "ga4-loader");
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", options.ga4MeasurementId, { anonymize_ip: true });
    }
    if (options.googleAdsConversionId && window.gtag) {
      window.gtag("config", options.googleAdsConversionId);
    }
    if (options.metaPixelId) {
      /* Standard Meta Pixel loader; no child details or health data are sent. */
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
      n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
      (window, document,'script','https://connect.facebook.net/en_US/fbevents.js');
      window.fbq("init", options.metaPixelId);
      window.fbq("track", "PageView");
    }
  }
})();
