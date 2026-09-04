# Life Skills product contract — repository snapshot

**Contract version:** 1.0  
**Drive authority:** https://docs.google.com/document/d/1kJug8ojFwdGgZoPUx8BJt9fLKBjGYvX0wwbtarGTIIg/edit

This snapshot exists so repository-aware agents can identify the current product. When it conflicts with the linked Drive document, stop and reconcile rather than guessing.

## Product

One bilingual Life Skills private-practice application, built first for Rabbi Shloimie Dratler and structured so future workspaces can white-label name, colors and terminology.

The application supports:
- minor case with one shared family account and optional child login;
- minor case without child login;
- secondary adult-client case in the same product.

It is not a school/classroom system, general messaging app, gamified child app, CRM/marketing suite, or automatic clinical decision maker.

## Public child offer

- Category: hands-on emotional therapy for boys ages 8–12.
- Program: 12 weeks.
- Delivery: 12 weekly 60-minute individual meetings; 24 group project labs, two 90-minute labs each week; 3 parent-guidance meetings at beginning/middle/end; goals/accountability; forms/resources; monthly professional progress report.
- Cohort: starts after 4 compatible paid boys; target and maximum 5; grouped by age and developmental fit.
- Initial location: Beit Shemesh. Qualification captures city/travel and possible alternate area. Another location is not promised until four compatible paid boys, space, staffing, insurance and economics are confirmed.
- Price: ₪13,500, paid as three installments of ₪4,500.
- Missed group lab: no makeup or credit.
- Private-session makeup: practitioner discretion and availability; 24-hour notice policy.
- Installments are toward the full 12-week package, not independent monthly subscriptions. Exceptional withdrawal adjustments remain practitioner discretion subject to applicable law.
- Adult private work is not advertised publicly; current adult rate is ₪450 per session.

## Accounts and permissions

- One practitioner account in the first production version.
- One shared family account per minor case; no separate parent accounts.
- One principal family email and phone for administration/reminders.
- Optional child login enabled by practitioner.
- Adult client is the adult account holder.
- Client does not self-book or cancel in the app.

Shareable record visibility:
1. `private`
2. `family_title_completion`
3. `family_full`

The practitioner sets visibility after discussion with the child. Child users do not manage privacy settings. A missed-commitment explanation remains private by default.

Always family-visible: schedule, attendance, practitioner-recorded schedule changes, payment summary, parent forms due, parent-guidance appointments, deliberately published updates and monthly reports.

Never family-visible by default: raw recording, transcript, practitioner-private note, unapproved AI draft, private assessment answer, private child reflection, or another child’s information.

## Accountability

Canonical hierarchy: Goal → Commitment → Scheduled Occurrence → Check-in.

Check-in states:
- `done`
- `partly_done`
- `moved_later`
- `not_completed`

A commitment may use an exact time, time window, anytime that day, or before next meeting. Same-day rescheduling preserves one occurrence/history. No proof upload.

## Progress

No badges, points, streaks, trophies, levels, leaderboards, confetti, prizes, rankings, or gamification.

Parent-facing professional progress uses four domains:
1. Emotional Regulation — notice cues, pause, recover.
2. Communication and Relationships — express needs/boundaries, listen/perspective, cooperate and repair conflict.
3. Responsibility and Self-Governance — initiate, follow through or renegotiate, own choices and repair.
4. Problem-Solving and Flexibility — identify, generate/test options, adapt/persist/learn.

Rating:
- 1: requires direct support.
- 2: developing; uses with reminders.
- 3: usually independent in familiar situations.
- 4: uses under challenge/across settings.
- N/O: not sufficiently observed.

Each child also receives 2–4 observable contextual targets tied to the enrollment concern. Monthly report includes strengths, evidence, current difficulty, next focus, one or two home recommendations, attendance and prior-month comparison. It is not a child report card.

## Content and updates

Worksheet and resource are one Resource entity with types such as audio, PDF, video, link, text and digital form.

Therapeutically relevant communication is an asynchronous Updates record, not live chat: family observation, practitioner update, home recommendation, acknowledgement and reply. Administrative/reminder delivery remains WATI.

## Practitioner/client experience

Practitioner desktop defaults to a week calendar; mobile to today agenda. Main areas: Calendar, Clients, Groups, Needs Approval, Forms and Payments. Needs Approval contains intake review, transcript/AI drafts, parent observation, report due, unmatched provider reply and payment/reminder attention.

Family portal: schedule, attendance, payments, forms, updates, monthly reports and deliberately shared items.

Child/adult portal: Today, Schedule, Progress and Resources. Today shows schedule, commitments, forms and assigned resources. Completed forms leave the active task list.

## Leads and website

Ad → bilingual concise landing page → qualification form → Leads Google Sheet → practitioner review/contact → enrollment → active app case.

Landing page does not show price. Qualification form shows ₪13,500 and 3 × ₪4,500 before final submission and asks financial feasibility. It also asks language, city, child age, school status, broad difficulty, contexts, previous attempts, desired 12-week improvement, schedule feasibility, travel/alternate area, parent participation, and preferred contact times/Zoom/phone. No self-booking and no direct personal WhatsApp before qualification.

## Recordings and AI

Recording flow: private upload or restricted Drive intake → processing record → timestamped speaker transcript → source-linked AI drafts → practitioner approve/edit/reject → raw audio pending deletion → delete 30 days after transcript approval unless manually retained.

Initial extraction types: Goal, Commitment, Resource, Next Appointment, Practitioner Note and Parent Update Draft. AI never directly changes or publishes an official record.

## Systems of record

- Leads: private Google Sheet.
- Active client records: PostgreSQL application database.
- Recordings/transcripts/resources: private object/file storage.
- Product/build documents: Google Drive.
- Code: GitHub.
- Reminders: WATI with structured delivery events copied into the app.

No real client data, recordings, transcripts, assessment answers, credentials or secrets belong in GitHub or build artifacts.
