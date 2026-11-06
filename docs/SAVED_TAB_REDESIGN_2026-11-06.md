# Saved tabs and layout — November 6, 2026

## Problem confirmed in production

The four category controls on `/saved` were anchor links into one long page.
`저장한 일정` was the second control but its section appeared last, after discovery,
analyses, documents and history. Clicking it changed the hash and scrolled away
from the controls. The discovery panel, section panels and inner cards also
repeated borders and containers.

## Change

- Category buttons now form an accessible tab list. Only the selected panel is
  visible. Arrow keys, Home and End move selection and keyboard focus.
- The selected category is represented by `?tab=analysis`, `?tab=event`,
  `?tab=document` or `?tab=history`. Native history updates preserve filters and
  loaded data without page scrolling. Refresh, Back/Forward and detail return
  recover the selected category; existing `#rd-saved-*` entry links still work.
- Underline navigation, a plain filter toolbar and divided list rows replace
  nested containers. The stylesheet is scoped to the Saved screen.
- Suggestions appear below an empty analysis or document category and contain
  that category's real catalog results. They are never presented as saved items.
- Schedule rows retain occurrence links `/events/<id>?kind=calendar`; they do
  not use published-analysis IDs. Save and removal operations retain their
  existing authenticated persistence paths.
- Counts are unavailable while their source is loading or failed. Unavailable
  saved schedules remain removable and are counted with accessible schedules.

No authentication, database schema, permission policy, production data or
provider integration changes are included.

## Verification

The focused Saved unit suites cover tab semantics, URL restoration, keyboard
navigation, category-specific suggestions, canonical resource identities,
persistence failures and account isolation. The browser regressions in
`research-workspace.spec.ts` and `redesign-reliability.spec.ts` additionally check
scroll position, refresh, Back/Forward, correct calendar detail and responsive
overflow on desktop and mobile.

Release gates are `python scripts/verify.py --full`, the workspace scope guard,
real disposable PostgreSQL tests, and the exact browser selection in
`.github/workflows/ci.yml`. Browser tests use isolated synthetic data and reject
unexpected external requests. They do not establish live provider coverage.

The local full Chromium runner cannot create its process-singleton socket in
this executor; the headless-shell download is also unavailable. These attempts
are blocked environment checks, not browser passes. The GitHub `web` job runs
the real browser gate before merge. Production acceptance separately verifies
the deployment commit at `/api/release` and the visible Saved page.
