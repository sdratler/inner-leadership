# Inner Leadership / הנהגה מבפנים

Complete bilingual static website and funnel for the 12-week Self-Governance Program for Boys Ages 6–11.

## Included pages

- `index.html` — primary sales website
- `masterclass.html` — free masterclass registration
- `watch.html` — video page and application CTA
- `apply.html` — program application
- `thank-you.html` — confirmation
- `privacy.html` — editable privacy-policy template
- `terms.html` — editable scope/terms template
- `404.html`

## Core program content locked into the site

- 12 weeks
- one private meeting weekly
- two 90-minute applied labs weekly
- exactly three parent strategy sessions
- ages 6–11
- two compatible boys begin a lab immediately
- four corrected modules and substantial projects
- graduate alumni circle at a founding price of ₪180/month, with trips priced separately

## Run locally

Static pages:

```bash
npm run build
npm run check
npm run serve
```

Open `http://localhost:8080`.

To test server-side form forwarding, install/use the Netlify CLI and run `netlify dev`. Copy `.env.example` to `.env` and provide the GHL webhook URLs. `DEMO_MODE=true` allows successful local form testing without forwarding data.

## Required configuration

Edit `assets/js/config.js`:

- masterclass video URL
- optional consultation/calendar URL
- WhatsApp URL
- contact email
- GA4, Google Ads and Meta IDs if used

Set server-side environment variables in Netlify:

- `GHL_MASTERCLASS_WEBHOOK_URL`
- `GHL_APPLICATION_WEBHOOK_URL`
- `GHL_CONTACT_WEBHOOK_URL`

Never place secret webhook URLs in browser code.

## Deploy at a root domain or a path

All page links are relative, so the folder can run as a standalone domain or be published under a path such as `/inner-leadership/`. For a subpath, ensure the host serves the entire folder at that path and preserves relative assets.

Recommended validation path on the existing domain:

`https://bneineviimacademy.org/inner-leadership/`

The design and public identity are fully separate from the Academy. A new domain can be purchased later after the offer is validated.

## GHL data contract

The forms send JSON to the Netlify Function, which forwards it to a GHL inbound webhook. Public forms deliberately collect only enough information for masterclass delivery and initial fit. Detailed diagnoses or records belong in a separate confidential accepted-client intake.

Masterclass required fields:

- `form_type=masterclass`
- `parent_name`
- `email`
- `phone`
- `child_age`
- `language`
- attribution fields

Application fields:

- parent and contact details
- city and preferred language
- child first name and age
- current framework
- broad concerns, desired change, strengths/interests
- broad current-support disclosure
- scheduling and parent-session commitments
- attribution fields

## Pre-launch legal and operational review

Before publishing:

1. Confirm the final public professional title and every credential statement.
2. Have an Israeli professional review the privacy policy, consent, cancellation policy, minor-safety documents, use of `טיפול רגשי`, and professional-liability coverage.
3. Complete the signed enrollment agreement, confidentiality limits, emergency process, mandated-reporting process, referral-out criteria, allergy/medical intake and incident procedure.
4. Obtain separate consent for photography/video. Never make marketing consent a condition of service.
5. Configure cookie/consent behavior where legally required.
6. Verify all Hebrew spelling, including the founder’s public Hebrew name.
7. Test every page and form on mobile in both languages.

## Build source

The HTML files are generated from `scripts/build_pages.py`. Make copy changes there and run `npm run build` so the source and generated pages stay aligned.
