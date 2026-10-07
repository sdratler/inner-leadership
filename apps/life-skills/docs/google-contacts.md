# Admitted owner Contacts boundary

The existing CRM package admits Google Contacts, not Google sign-in or Calendar.
The server-only People API adapter is preparation, **not a live connection or
completed projection workflow**. No route/schedule activates it yet.

- Reuse the existing OAuth client/project, but obtain a separate owner Contacts
  grant. Never reuse the Office Gmail/Drive refresh token. Default OFF; explicit
  `LS_CONTACTS_GOOGLE_ENABLED`, `LS_CONTACTS_GOOGLE_REFRESH_TOKEN`,
  `LS_CONTACTS_GOOGLE_OWNER_EMAIL`, `LS_CONTACTS_GOOGLE_OWNER_SUBJECT` are required.
  Runtime reads existing `LS_AUTH_GOOGLE_CLIENT_ID/SECRET`. No values in Git.
- Minimum permission is `contacts` plus `userinfo.email` to verify the selected
  owner account. Exact verified email and Google subject must match. Contact
  permission does not establish app-login/clinical/financial authority.
- Read only names, phones and group membership from CONTACT sources. Exact user
  group **Life Skills Lead**, up to 200 members; changed/incomplete/oversized group
  snapshots fail closed. No whole address-book import or clinical fields.
- Phone search warms the documented cache and verifies normalized phone hits;
  two matches require owner choice. A bounded search miss is not complete absence
  and must not trigger automatic create. New-contact/group creation still needs
  the durable projection/mapping and uncertain-create reconciliation boundary.
- Existing-person label addition reads before/after, changes only membership,
  preserves the name and unrelated groups, and reports applied only after exact
  provider readback. Never retries a non-idempotent create or sends a message.
- Every response has an actual byte bound, UTF-8/shape/resource guards, deadline,
  fixed HTTPS hosts and redirect refusal. Errors contain no credentials or people.
- Remaining gates: ordinary owner Contacts consent/account/scope readback; durable
  encrypted mapping/projection integration under the existing native authority;
  group creation, verified absence/new-contact handling and bounded group delta
  reconciliation; protected review/release; controlled actual provider proof.
  Synthetic adapter tests are not those gates. Runtime remains unavailable.

Primary API references: [create](https://developers.google.com/people/api/rest/v1/people/createContact),
[search](https://developers.google.com/people/api/rest/v1/people/searchContacts),
[group read](https://developers.google.com/people/api/rest/v1/contactGroups/get),
[batch read](https://developers.google.com/people/api/rest/v1/people/getBatchGet),
[membership](https://developers.google.com/people/api/rest/v1/contactGroups.members/modify).
