(() => {
  "use strict";

  const ATTRIBUTION_KEYS = [
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "gclid", "gbraid", "wbraid", "fbclid", "msclkid"
  ];
  const storageKey = "innerLeadershipAttribution";

  function captureAttribution() {
    const current = JSON.parse(localStorage.getItem(storageKey) || "{}");
    const params = new URLSearchParams(window.location.search);
    ATTRIBUTION_KEYS.forEach((key) => {
      const value = params.get(key);
      if (value) current[key] = value.slice(0, 500);
    });
    if (!current.first_page) current.first_page = window.location.pathname;
    current.last_page = window.location.pathname;
    current.referrer = current.referrer || document.referrer || "direct";
    localStorage.setItem(storageKey, JSON.stringify(current));
    return current;
  }

  function getLanguage() {
    return document.documentElement.lang === "he" ? "he" : "en";
  }

  function showMessage(form, type, en, he) {
    const box = form.querySelector("[data-form-message]");
    if (!box) return;
    box.className = `form-message show ${type}`;
    box.textContent = getLanguage() === "he" ? he : en;
  }

  function trackEvent(name, params = {}) {
    if (window.gtag) window.gtag("event", name, params);
    if (window.fbq) window.fbq("trackCustom", name, params);
  }

  function trackConversion(formType) {
    const cfg = window.INNER_LEADERSHIP_CONFIG || {};
    if (window.gtag && cfg.googleAdsConversionId) {
      const label = formType === "masterclass" ? cfg.googleAdsMasterclassLabel : cfg.googleAdsApplicationLabel;
      if (label) window.gtag("event", "conversion", { send_to: `${cfg.googleAdsConversionId}/${label}` });
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector("button[type='submit']");
    const originalText = submit ? submit.textContent : "";

    if (form.querySelector("input[name='website']")?.value) return;
    if (!form.reportValidity()) return;

    const data = Object.fromEntries(new FormData(form).entries());
    data.language = getLanguage();
    data.page_url = window.location.href;
    data.form_type = form.dataset.formType || "contact";
    data.submitted_at = new Date().toISOString();
    Object.assign(data, captureAttribution());

    if (submit) {
      submit.disabled = true;
      submit.textContent = getLanguage() === "he" ? "שולח..." : "Sending...";
    }

    try {
      const response = await fetch("/.netlify/functions/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Submission failed");

      trackEvent(data.form_type === "masterclass" ? "MasterclassRegistration" : "ProgramApplication", {
        language: data.language,
        source: data.utm_source || "direct"
      });
      trackConversion(data.form_type);

      form.reset();
      showMessage(
        form,
        "success",
        data.form_type === "masterclass" ? "You are registered. Opening the masterclass now." : "Your application was received. We will contact you to arrange the parent conversation.",
        data.form_type === "masterclass" ? "נרשמתם. כעת עוברים לצפייה בשיעור." : "הבקשה התקבלה. ניצור קשר כדי לתאם שיחת הורים."
      );
      const destination = form.dataset.successUrl;
      if (destination) {
        window.setTimeout(() => {
          const connector = destination.includes("?") ? "&" : "?";
          window.location.href = `${destination}${connector}lang=${data.language}`;
        }, 650);
      }
    } catch (error) {
      console.error(error);
      showMessage(
        form,
        "error",
        "The form could not be sent. Please try again, or contact us directly.",
        "לא הצלחנו לשלוח את הטופס. נסו שוב או צרו קשר ישירות."
      );
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalText;
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    captureAttribution();
    document.querySelectorAll("form[data-connected-form]").forEach((form) => {
      form.addEventListener("submit", handleSubmit);
    });
  });
})();
