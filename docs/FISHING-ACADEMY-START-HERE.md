# Fishing Academy local project

Local checkout: `C:\Users\sdrat\Fishing Academy`.
This is the existing Fishing application, separate from Toras Emes and BNA school records.

Read [AGENTS.md](../AGENTS.md), [the current Fishing source route](https://docs.google.com/document/d/1AwB6My_ZrXf09j5ZFXvu42UKW30kCnlWU7_sLDpFHIA/edit?tab=t.4omt1dj3ko64), and [Continuation](https://docs.google.com/document/d/1q-GDEaL9JmmVfy1meQrGvu3V4H2XNJ4jp2b17ZrP6bE/edit?tab=t.5ucllbuab4bn). Those route to the complete current business, website, artwork, architecture, UI, decisions and delivery owners. Earlier implementation packages are history where superseded; current source code is in this checkout, not reconstructed from a ZIP.

| Purpose | Existing identity |
| --- | --- |
| Current program | Jewish Leadership Fishing Academy |
| GitHub (legacy name retained for deployment) | `sdratler/inner-leadership` |
| Application | `apps/life-skills` |
| Railway project | `3b756632-1f66-4f75-a016-eabc37aa0d67` |
| Production environment | `dd91bd71-57cc-45e6-a75b-8c858491d7c7` |
| App service (legacy name) | `life-skills-private-staging` / `0267d061-f3ce-4a0a-82d4-ce133e4501e9` |
| Existing service domain | `life-skills.bneineviimacademy.org` |
| Main-domain public gateway | `shloimie-beep/bnei-neviim-academy` |

Use the existing Railway secret store and configured authenticated deployment access. Never copy Toras Emes or BNA database/auth/session secrets into this project. A public seminar page needs no database or WhatsApp API credential. Local runtime secrets, if required for other authorized tasks, must stay in ignored environment files.

Current scoped task: `JLFA-SEMINAR-MOBILE-DESTINATION-20261122-01`; [engineering evidence](../evidence/seminar-20261122/README.md).

Owner clarification `JLFA-LOCAL-PROJECT-IDENTITY-20261122-01`: make Fishing Academy the clear current identity. Track a later coordinated repository/service/package-name cleanup in the existing Fishing log; do not rename deployment dependencies as part of the seminar release. Historical source and legitimate records remain intact. Backend and billing work remain paused.
