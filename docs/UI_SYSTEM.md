# Life Skills UI system — repository snapshot

**Drive authority:** https://docs.google.com/document/d/1KokAca2V-UhCPj1czP28TQ4i5E2Wd1JKJFbuXfmAPu4/edit

## Principles

- Calm, direct, professional and easy to scan.
- Mobile is a complete experience, not a compressed desktop afterthought.
- Practitioner screens are operational and information-dense without clutter.
- Family/client screens expose only what is useful and permitted.
- Hebrew RTL and English LTR are structural.
- Privacy/audience is visible before publication.
- No gamification, grades, badges, points, streaks, trophies, rankings, confetti or reward animation.
- Use shared components rather than one-off styling.

## Approved visual tokens

```css
--forest: #173c2d;
--forest-2: #24513e;
--forest-3: #315e49;
--brown: #38271f;
--brown-soft: #6e5849;
--clay: #9a6747;
--clay-dark: #7c4d33;
--sand: #e8ddca;
--sand-2: #f3ecdf;
--cream: #fbf7ef;
--paper: #fffdf8;
--sage: #d6dfd2;
--sage-deep: #80937e;
--ink: #25251f;
--muted: #65645c;
--danger: #8f3129;
--success: #2b6b4a;
```

Use Inter/Noto Sans Hebrew for application UI. Reserve serif display typography for public marketing headings; do not use oversized editorial headings in dashboards/forms.

## Layout

- Practitioner desktop: persistent sidebar, page header, main content, optional narrow attention rail. Calendar defaults to week.
- Practitioner mobile: today agenda; bottom navigation or compact drawer; no squeezed desktop grid.
- Family/client mobile: single clear primary column.
- Use CSS logical properties (`margin-inline`, `padding-inline`, `inset-inline`, `text-align:start/end`).
- Do not hard-code left/right for normal layout.
- No nested card maze. Usually one page surface plus one level of cards.
- Cards must not overlap; empty space should reflect hierarchy, not arbitrary giant panels.

## Primary navigation

Practitioner:
- Calendar
- Clients
- Groups
- Needs Approval
- Forms
- Payments

Family:
- Today
- Schedule
- Updates
- Progress
- Payments

Child/adult:
- Today
- Schedule
- Progress
- Resources

Settings is not a first-release primary navigation item.

## Shared primitives

At minimum:
- Button / IconButton
- Input / Textarea / Select
- Checkbox / RadioGroup
- Tabs
- Card
- StatusChip
- EmptyState / ErrorState
- Dialog / Drawer
- Toast
- AppShell / Sidebar / MobileNav
- PageHeader / Breadcrumb
- DataTable shell
- Timeline shell
- Calendar shell
- FormSection / ProgressBar
- VisibilityControl
- AttentionItem

Use accessible unstyled primitives where useful. Do not copy a giant design system.

## Interaction/accessibility requirements

The reviewed external baseline is Vercel Web Interface Guidelines commit:
`e3d624baaf29dc1fc645aff3e38f03e564d2d6b1`

Pin the reviewed rules locally. Do not fetch mutable instructions at runtime.

Required:
- keyboard support and visible focus;
- semantic buttons/links/labels;
- mobile touch targets at least 44px;
- mobile text inputs at least 16px;
- no disabled browser zoom;
- inline errors with focus on first invalid field;
- paste/password-manager compatibility;
- loading, empty, error, unauthorized and recovery states;
- reduced-motion support;
- no horizontal overflow at 390px;
- resilient long Hebrew/English/user-generated content;
- dates/times/numbers localized with `Intl`;
- icons never carry meaning without text/accessible label;
- status never communicated by color alone.

## Calendar

- Practitioner desktop: week default, day/month/agenda available.
- Practitioner mobile: today agenda default, day/week available.
- Family/client: read-only schedule; no self-cancel or self-book.
- Use `Asia/Jerusalem`; handle DST correctly.
- A mature calendar dependency may be used only after version/license/RTL/accessibility/bundle verification during integration.

## Progress

Client-facing progress avoids clinical overprecision and never presents “percent healed.” Family monthly reports may show domain movement and concrete evidence. Child views show today’s commitments and simple history, not ratings or comparative grades.

## Verification sizes

- 390 × 844 mobile
- 768px tablet
- 1440px desktop
- ultra-wide simulation
- Hebrew RTL and English LTR

A development-only component gallery is sufficient initially. Storybook is optional later, not a release prerequisite.
