# Owner-confirmed Quick update

LS-ACQ-CRM-20261002-01, existing native People acquisition boundary. No new CRM,
assistant framework, model call, paid capability or provider activation.

- Normal practitioner login + CSRF + canonical HTTPS only. Native authority and
  current epoch are mandatory. Legacy/frozen/native failure never writes Sheet.
- Open **People → Quick update**. Supported English/Hebrew administrative phrases
  are parsed deterministically. Unsupported clauses require clarification; there
  is no guessed screenshot/voice phone, silent partial save or arbitrary stage.
- Example: `The guy who just called is Moshe Cohen. He's interested. Call him
  Sunday. Add him as a Life Skills lead.` Recent caller means exactly one pending
  unclassified Nomad candidate within ten minutes, not a provider history scan.
  Zero/multiple candidates require an exact number/context or explicit choice.
- Explicit example: `Add Moshe Cohen +15550002001 as a Life Skills lead. Call him
  Sunday; Note: Spoke today.` A final `Note:` / `הערה:` preserves punctuation and
  line breaks. Existing notes append; existing normal names remain unchanged.
- The server returns the exact person, changes and Jerusalem follow-up date in
  an encrypted, actor-bound fifteen-minute preview. Nothing is written until
  **Confirm CRM update**. Cancel/collapse keeps input. The app-owned stages are
  the existing New inquiry / Contacted / Offer made / Prospect options; historical
  stored values and filter keys are never normalized by this feature.
- Confirmation rechecks person/version, endpoint claims, role/session, DEMO,
  archive/opt-out and authority within one transaction. Original operation retries
  do not duplicate a person, note or receipt, including after later profile edits.
  Unknown-outcome UI retries use the exact original preview token.
- Migration0123 adds only encrypted immutable administrative command results.
  PUBLIC access and mutation are denied. No account, case, payment, appointment,
  sales reply, phone call or clinical note is created by a command.
- `Add to Google Contacts` / `Add WhatsApp label` record an honestly unavailable
  projection result until the separate scoped runtime writers are implemented
  and verified. No external label success, OAuth scope or provider permission is
  inferred. The existing ChatGPT Contacts connector is read/search-only. Google
  sign-in/Calendar/billing remain deferred, separate from admitted Contacts.

Local native PostgreSQL and ordinary-login browser proof are not production
cutover, actual phone/provider proof, independent review or release acceptance.
