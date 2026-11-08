# Home B reference implementation — 2026-11-08

## Scope and visual contract

Home B uses the supplied dashboard image below the existing Korean header and
administrator A/B comparison bar. It contains four summary cards, two columns of
content panels, and a right sidebar. The panels show followed-company updates,
upcoming dates, recent documents, approved analyses, news, saved items, official
calendar coverage, and notifications. At narrower widths the sidebar and panels
stack; the metrics use a two-by-two arrangement on phones.

`home-b.tsx` now selects `home-b-dashboard.tsx`; all presentation rules remain
under `.sb-home-b`. The B-only container rule in `home-experiment.css` matches A's
existing geometry, including its mobile padding, so the supplied comparison bar
does not shift between layouts. The shared shell, navigation, logo, search,
account menu, original `home.tsx`/`home.css`, and allocation/authorization logic
are retained. The experiment ID and approximately 50/50 account assignment stay
unchanged; this change does not claim a measured A/B outcome.

### Spacing refinement

The November 8 follow-up gives B more breathing room through wider card gutters,
larger card insets, clearer separation below headings and filter controls, and
more vertical space within list rows. Existing breakpoint rules reduce these
insets on small screens while retaining comfortable control sizes. The change
is confined to B's stylesheet; the header, comparison bar, Home A, data requests,
filters, navigation and persistence behavior are retained.

## Existing data and actions

| Section | Existing source / behavior |
| --- | --- |
| Followed companies | `/v1/watchlist` and `source_overview`; intersect monitoring rows with the personal watchlist and choose actual filing/review dates. |
| Upcoming dates | `useCalendarData`, confirmed official calendar rows, today through today + 6 inclusive; canonical `calendarHref` details. Categories describe explicit source title wording. |
| New documents | `catalog(kind=document, days=30, sort=newest, limit=50)`; total count is server-supplied. Filters classify this bounded preview, with an explicit notice when more than 50 records exist. |
| Approved analysis | Existing `catalog(kind=analysis)` visibility rules and `resourceHref`, including filing IDs and US/DART analysis query parameters. |
| News | Existing `/api/news` market query or authenticated company query, validated `newsResponse`, original source links and NAVER attribution. |
| Saved items | Existing `saved_list` and `save` actions. Document saves/removals refresh both the document and Saved panels. History is read only when the preference allows it. |
| Coverage | Existing `sb_calendar_coverage` through `useCalendarCoverage(null)`. Counts describe registered companies' configured official calendar source coverage under the backend's rules; SEC IR sources additionally require a successful collection. They are not a universal collection-success or freshness/uptime percentage. Pending and covered sets can overlap. |
| Notifications | `useContentNotifications` plus `markContentNotificationRead`. A normal click waits for the persisted write before navigating; failures remain visible. Modified/middle clicks preserve native navigation and still request the same confirmed read. |

Every panel retains independent loading, empty, error and retry behavior. Failed
or unresolved requests never become successful zero-count results. User-scoped
hooks and keyed renderer mounts retain the existing account isolation.

## Data boundaries and dependencies

The screenshot's sample counts, prices, dates, event times, page counts, and
percentage are not production data. The existing market-data feature is disabled;
the quote column displays `— / 시세 미제공`. The existing quote adapter remains
available behind that release flag. Calendar data currently has date precision,
so no meeting time or reminder state is invented.

No database migration, new API, new paid service, new account, or additional secret
is required. The page uses the current Supabase authentication/workspace/calendar
setup and existing NAVER news configuration. Production demo auth is not enabled.

## Verification

Focused unit checks cover document/event classification, account allocation and
single-renderer behavior, news response isolation and error/retry handling.
`e2e/home-ab-layout.spec.ts` covers retained A, authorization, unchanged header,
the new B panels, 320px layout, real filters, inclusive date boundaries, canonical
navigation, saved-item persistence, and rejected/successful notification reads.
Its records and transport stubs are isolated test fixtures and are never used in
the production component.

Run the standard `python scripts/verify.py --full`, scope guard, the repository
browser suite and the disposable PostgreSQL CI job before release. The authoring
container's system Chromium could not launch because its socket operation was
denied; this is not a browser-test pass. Exact-source CI and the production
release endpoint must establish browser and deployment results independently.
