# Desktop reference screens — 2026-10-07

This release continues the latest GitHub main revision
`d09dac977ea4882b7faa1dd7da9d3f59afc98d01`. It implements the ten supplied
1448 × 1086 PC references in a dedicated desktop render branch. The deployed
mobile implementation remains the baseline: 93 mobile source files, assets and
shared dependencies retain their SHA-256 hashes, and all 21 mobile page expressions
remain unchanged. `scripts/verify_desktop_isolation.py` checks this boundary and
rejects desktop styles that are not scoped beneath `.sb-pc`.

The existing `useMobileViewport` boundary is unchanged: up to 767 CSS pixels uses
the existing mobile pages; wider screens mount the PC views. Only the visible
branch mounts. The PC shell uses the reference sidebar, top search, profile menu,
blue and white cards, company marks, typography and multi-column page layouts.
It adjusts columns for narrower desktop/tablet widths without altering mobile CSS.

## Exact reference-to-source mapping

All filenames below begin with `ChatGPT Image Oct 7, 2026, ` and are the user’s
uploaded `(1).png` copies.

| No. | Reference filename suffix | PC screen and route | Primary module |
|---|---|---|---|
| 01 | `09_44_53 AM-1(1).png` | Dashboard, `/today` | `apps/web/src/desktop/today.tsx` |
| 02 | `09_44_56 AM-2(1).png` | Discovery, `/explore` | `apps/web/src/desktop/search.tsx` |
| 03 | `09_44_58 AM-3(1).png` | Search results, `/search?q=…` | `apps/web/src/desktop/search.tsx` |
| 04 | `09_44_59 AM-4(1).png` | Company overview, `/companies/[id]` | `apps/web/src/desktop/research.tsx` |
| 05 | `09_45_01 AM-5(1).png` | Company timeline, `/timeline`, `/companies/[id]/timeline` | `apps/web/src/desktop/research.tsx` |
| 06 | `09_45_02 AM-6(1).png` | Event detail, `/events/[id]` | `apps/web/src/desktop/research.tsx` |
| 07 | `09_45_03 AM-7(1).png` | Evidence and sources, `/events/[id]?panel=evidence` | `apps/web/src/desktop/research.tsx` |
| 08 | `09_45_04 AM-8(1).png` | AI follow-up, `/questions?event=…` | `apps/web/src/desktop/questions.tsx` |
| 09 | `09_45_06 AM-9(1).png` | Document detail, `/documents/[id]?kind=document` or `filing` | `apps/web/src/desktop/research.tsx` |
| 10 | `09_45_07 AM-10(1).png` | Watchlist, `/watchlist` | `apps/web/src/desktop/watchlist.tsx` |

Shared PC components live in `desktop/ui.tsx`, the shell in `desktop/shell.tsx`,
and the account-partitioned data hook in `desktop/data.ts`. Each screen imports
only scoped PC styles. Existing portfolio, calendar, onboarding, saved/history,
notifications, help and settings routes remain reachable through navigation.
The release does not replace the existing mobile or unreferenced desktop pages.

## Interactions and actual data

### Dashboard and discovery

The dashboard reads the signed-in profile, watchlist, holdings, notifications,
published change feed, verified calendar and available market quotes. Holdings
use the existing exact decimal arithmetic. Missing, expired or future quotes
cannot silently produce a portfolio total. A daily USD/KRW reference is labelled
with its date; it is not described as an intraday quote. Unconnected market indices
remain unavailable. The watchlist daily average discloses quote coverage; quote
dates and provider information remain accessible. The gainers list is explicitly
limited to the user’s watched companies. Today’s unread notification count uses
the user’s timezone. Upcoming dates are independently limited to the next 30 days
because the hosted calendar endpoint can return a broader date collection.

Search submits the actual query, retains market/type/date/sort parameters and
resets pagination when a filter changes. The global search reflects the current
URL query and supports Control/Command-K. Recent searches obey the existing
history preference, and deletion waits for successful persistence. Suggestions
come from connected companies and records; no global popularity statistic is
invented. Industry tiles are keyword searches. Unconnected valuation, market-cap,
sector-classification and dividend metrics remain visibly unavailable.

### Research, evidence and documents

Company pages connect related published events, actual supported financial facts,
documents, available price history, watchlist status and holding entry. Timeline
company selection, date ranges, event types, source destinations, expandable
interpretations and saved monitoring items use existing account APIs. Event pages
separate reported facts, changes, reviewed interpretations and uncertainty.
Bookmark and holding mutations preserve their previous state on failure.

Evidence views expose original quotes, precise locations, provider, source tier,
publication precision and current/prior-period lineage. Full quote dialogs retain
the entire quote. Claim-to-source mapping and source/provider/period filters use
the persisted evidence records. Original URLs are validated before linking.

Document detail uses the existing reviewed-section API. It supports tabs, section
navigation, actual supported facts, linked events, full source text, pagination,
bookmarks and original/download destinations when available. Missing file size,
MIME type and page counts remain unavailable. A SEC form name is not treated as
proof of a PDF. A filing’s submissions-envelope checksum is labelled separately
from the original document’s byte checksum. Questions open a linked published
event; a filing without a visible reviewed event does not receive a fabricated
AI context.

### Questions and watchlist

AI follow-up uses the existing event-bound question service and the caller’s
persisted question history. It supports suggested questions, sending, event
selection, exact numbered citations, safe source links, answer copying, history
restore and confirmed history deletion. Switching event or account clears the
previous context from view. Answered, abstained, unavailable and policy-blocked
states remain distinct. New conversation opens event selection; it does not
delete saved history. The current backend has no per-answer rating or uploaded
research-document ingestion endpoint, and the UI does not simulate those actions.

Watchlist supports persistent add/remove, per-company notification mute, market
and name filters, available daily-change sorting, rising/falling subsets and bulk
selection. Partial bulk-removal failures retain failed items. Its side panels
show actual watched-company notifications and changes. Missing daily change is
`—`, not a fabricated zero or historical investment return.

## APIs and persistence

No new database table, schema migration, vendor integration or server secret is
needed by this PC release. It reuses the reviewed deployment’s APIs and policies.

| Surface | Existing request path / action | Authority and failure behavior |
|---|---|---|
| Profile and onboarding gate | `/api/v1/me`, existing AuthProvider | Verified bearer identity; unfinished onboarding returns to onboarding |
| Feed and full event | `/api/v1/feed`, `/api/v1/events/[id]` | Published visible records and validated response contracts |
| Watchlist and holdings | `/api/v1/watchlist`, `/api/v1/watchlist/[id]`, `/api/v1/portfolio`, `/api/v1/portfolio/positions/[id]` | Caller-owned collections; exact quantity/cost strings |
| Calendar and notifications | `/api/v1/calendar`, `/api/v1/notifications` | Caller-owned / published data; no promised background delivery |
| Company timeline | `/api/v1/companies/[id]/timeline` | Visible events; bounded server request plus explicit display filters |
| Questions | `/api/v1/events/[id]/questions`, `/api/v1/questions` | Event-bound reviewed evidence and account-owned history |
| Catalog, company, saves and history | `POST /api/workspace`: `catalog`, `company`, `resource`, `save`, `visit`, `saved_list`, `searches`, `search_record`, `search_delete`, `searches_clear` | Existing strict request validation, browser-origin, ownership and MFA checks |
| Document detail | `POST /api/workspace`: `document_detail` | Existing reviewed-section visibility; actual pagination and source metadata |
| Preferences / mute | Existing versioned preferences API | Conflict/error responses retain persisted state |
| Quotes and FX | `/api/market`, `/api/us/reference-rate` | Existing provider entitlement/budget checks; explicit unavailable states |

Primary PC GETs reuse the existing in-memory, bearer-partitioned 15-second cache.
They are not written to local storage. A shared request can finish after one view
unmounts, but its response cannot update a different account or route. Detail,
history and other uncached reads remain abortable. Explicit reload and successful
mutations invalidate the collection cache. Authentication, ownership, response
validation and source visibility remain server responsibilities.

## External services, configuration and costs

This release reuses the owner’s existing Vercel and Supabase projects. It creates
no subscription, paid worker, new project, provider budget, license or webhook.
Existing hosting and usage charges remain subject to the owner’s current plans.

| Service/capability | Existing configuration | Availability boundary |
|---|---|---|
| Vercel website and BFF | Existing SignalBrief project; same-origin `/api`; public Supabase URL and publishable/legacy anon key | Secret/service/vendor keys stay server-side |
| Supabase Auth, database and storage | Existing project, RLS, account ownership, reviewed-source RPCs and MFA rules | No schema migration required for these PC screens |
| Google OAuth | Provider client ID/secret in Supabase Auth; Google callback `https://xabzzhtdmqsaqdauthbu.supabase.co/auth/v1/callback`; app redirect `https://signalbrief.online/auth/callback` | Initiation/callback configuration and completed interactive consent are separate checks |
| Recovery / verification mail | Existing Supabase Auth mail/SMTP configuration and permitted redirects | Actual receipt requires a live delivery check; no mail service is purchased |
| SEC collection | Server-side `SEC_CONTACT_EMAIL` and operator ingestion/review pipeline | Credentials alone do not imply that data has been collected or published |
| Prices and charts | Server-side `FMP_API_KEY`; valid display rights; `fmp_display_enabled`, license reference and expiry | API key presence does not grant display rights; disabled/unlicensed data remains unavailable |
| Generative SEC extraction | Server-side `OPENAI_API_KEY` and approved positive `ai_daily_budget_usd` | Existing evidence follow-up is separate; no new paid model usage is enabled |
| Optional headlines | `GNEWS_API_KEY` plus a valid site entitlement | Not required for the reference screens; no subscription activated |
| Alert email/digests | Delivery implementation, `RESEND_API_KEY`, verified sender and `resend_from` | Current UI does not claim unimplemented delivery is enabled |
| Timed reminders / push | Separate worker and subscription/permission lifecycle | Saved interest is persistence, not a delivery guarantee |
| Scheduled ingestion / webhooks | Separate explicit operational configuration | No new schedule or webhook added by this change |
| Korea source coverage | Existing deferred OpenDART/KRX work | Not manufactured from reference-image Korean tickers |

The reference images contain sample prices, dates, counts, user imagery and other
measurements. They establish the visual target. Production contents come from the
real account and available services, so an empty or unavailable production state
can legitimately differ from the populated synthetic visual test fixtures.

## Verification and reproducible source exports

Required release checks are `python scripts/verify.py --full`,
`python scripts/verify_desktop_isolation.py`, all existing mobile and desktop browser
suites plus `desktop-references.spec.ts`, and disposable PostgreSQL/schema replay
tests. The PC browser fixture intercepts every account/provider API request and
fails unexpected external calls. It captures all ten screens at 1448 × 1086 and
1280 × 900, exercises persisted research/watchlist/question flows, and reopens the
same mobile routes at 432 and 390 pixels. Fixtures never mutate production data.

The repair workspace has frontend and Python dependencies, but Windows sandbox
permissions prevent local native web tests/builds and default temporary-directory
backend tests. Local lint and type checking pass; this is not an all-gates pass.
GitHub Actions runs the complete release suite,
browser checks and disposable PostgreSQL tests before merge. Final CI run links,
the merged commit and the production deployment identity are reported with the
release. Browser artifacts are visually inspected before publication.

The existing development-only dependency advisory is tracked separately in
`docs/SECURITY_ADVISORY_20261003.md`. This change does not weaken that audit gate,
silence it or downgrade the framework to manufacture a clean result. Production
dependency audit and application/schema/browser verification are distinct checks.

`scripts/package_desktop_references.py` takes an explicit committed revision,
deployment identifier and verification URLs. It emits one TXT for each reference
and a ZIP containing those ten files. Each TXT includes complete relevant frontend
source, transitive shared imports, existing API/BFF/Edge/database/backend source,
tests and configuration, labelled with repository paths and SHA-256 hashes.
It reads committed text only and excludes environment secrets, private account
data and binary assets. Fonts and logos retain their committed repository paths.
