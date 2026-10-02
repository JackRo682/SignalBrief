# SignalBrief UX Specification

Version 1.1 • Screen contracts • P0/P1 scheduling follows [MVP_SCOPE.md](MVP_SCOPE.md)

## Shared design and content rules

Korean-first beta UI is a proposed design decision; specification labels here are English semantic labels for implementation. Preserve issuer names and original source language; clearly label machine translations. Use a restrained information hierarchy: company/event → change → relevance → date/status → evidence → interpretation → uncertainty/next checks. Red/green must not imply buy/sell or be the only status encoding.

Every screen supports keyboard use, semantic headings, associated form labels, visible focus, screen-reader status announcements, sufficient contrast, reduced motion and 200% zoom. Test 360px mobile, 768px tablet and 1280px desktop widths. Minimum 44px primary touch targets. No essential hover-only behavior. Tables have a stacked accessible mobile presentation; numeric comparison cells retain labels and units.

Loading: skeletons matching layout, no invented placeholder numbers. For processes exceeding 2 seconds show status; bounded timeout offers retry. Empty, filtered-empty, unsupported-coverage, stale-data and failed-load are different states. Errors have an action and a trace reference safe to share. On mutation errors keep unsaved input. Display original publication date, first ingestion time when relevant, and last successful coverage check separately. If publication precision is date-only, do not invent a time.

Public reliability labels are `Evidence checked`, `Limited comparison`, `Conflicting evidence`, `Source delayed`, and `Corrected/Withdrawn`, with explanations. Do not expose uncalibrated confidence percentages or suggest that “checked” guarantees truth. Top cards have one main CTA. A persistent footer links coverage, privacy and information-only policy.

## 1. Login — `/login` — P0

| Field | Contract |
|---|---|
| Goal | Create or resume a private account with minimal setup |
| Information hierarchy | Product promise; Google CTA; supported coverage; limits; privacy/terms |
| Components | Logo, short explanation, Google sign-in button, coverage link, auth-error region |
| Actions | Start OAuth; read policies; retry; sanitized return path after success |
| Empty state | Signed out is the normal state; no fake personalized examples |
| Loading state | Disable duplicate OAuth starts; “Connecting to Google”; maintain cancel/back path |
| Error state | Distinguish canceled consent, expired callback and provider outage; no token details |
| Mobile | Single column; CTA above fold; full-width readable buttons; normal browser OAuth redirect |

## 2. Onboarding — `/onboarding` — P0

| Field | Contract |
|---|---|
| Goal | Set expectations and reach watchlist setup |
| Information hierarchy | What service covers; what evidence labels mean; timezone; optional analytics; continue |
| Components | Two brief steps, coverage summary, timezone selector, unchecked optional analytics toggle, progress indicator |
| Actions | Set timezone, choose analytics preference, continue/resume; no investment experience questionnaire required |
| Empty state | Default timezone visible and editable; no portfolio values requested |
| Loading state | Save progress once; disable repeat continue; allow safe resume |
| Error state | Keep selections; save retry; authentication expiry leads to login with progress preserved server-side |
| Mobile | One question group per viewport; footer CTA does not cover text or system keyboard |

## 3. Watchlist setup — `/watchlist` — P0

| Field | Contract |
|---|---|
| Goal | Follow at least one supported company |
| Information hierarchy | Search; matching issuer/ticker/exchange; coverage; selected names; continue |
| Components | Debounced 300ms search (min 1 character), market filter, issuer disambiguation rows, selected chips/list, count /30 |
| Actions | Add/remove; inspect coverage start/forms; request unsupported company; continue with ≥1; edit later |
| Empty state | Explain search with illustrative query text only; no presumed holdings; no-result offers coverage request |
| Loading state | Search rows skeleton; previous result not silently assigned to new query; save progress indicator |
| Error state | Retry search; duplicate add treated as success; 30-limit and unsupported ID validation inline |
| Mobile | Selected list beneath search; keyboard-safe CTA; name and exchange cannot be truncated together |

## 4. Portfolio setup — `/portfolio` — P1

| Field | Contract |
|---|---|
| Goal | Optionally distinguish held companies and manual exposure |
| Information hierarchy | Optionality and no broker link; holdings; weight status/as-of; save |
| Components | One portfolio, company picker, held-company rows, optional weight %, entry date, known-weight total |
| Actions | Create; add/edit/remove holdings; leave all weights blank; return to feed |
| Empty state | “Your watchlist works without a portfolio”; add held company |
| Loading state | Skeleton rows; atomic save; keep editor values until success |
| Error state | Reject weight <0 or >100%, total >100%, duplicate issuer, >30 holdings; explain incomplete weights rather than normalizing |
| Mobile | Editable company cards with weight field; no multi-column valuation table |

No quantity, cost basis, P&L, live market value, FX conversion or trade recommendation. Manual weights display last-updated date; after 30 days mark stale and ranking ignores the weight bonus until reconfirmed.

## 5. Today's Changes — `/today` — P0

| Field | Contract |
|---|---|
| Goal | Select the few relevant developments worth inspecting |
| Information hierarchy | Date/timezone and coverage; top changes; remaining new events; separately labeled recent history |
| Components | P0 accuracy-notice banner and expandable persistent notice list, freshness banner, top-three cards, company/type filters, feed pagination, “Why shown” disclosure |
| Actions | Open event; inspect/acknowledge accuracy notice; filter; manage followed companies; retry; view recent seven-day history |
| Empty state | No followed companies → setup; current source/no changes → quiet day; backfill incomplete → coverage pending; filtered-empty → clear filters |
| Loading state | Three card skeletons; no background LLM call on page load; retain last safe feed while refreshing |
| Error state | API fail shows retry; source outage shows last successful check; partial company failures name affected coverage without claiming completeness |
| Mobile | Vertical cards; wrapping company labels; date/filter drawer; no forced horizontal scrolling |

Card fields: company/market, event title, one-sentence change, event class, publication precision, evidence status, source count, held/watched reason, unread/corrected flag. Materiality is event significance, never a bullish/bearish signal. “Today” means source publication date in user timezone where precise; date-only uses source-local date labeled as such. Old first-seen documents appear under “Newly indexed history,” not today's news. Include all eligible published events in the complete list; only rank the top three, never fabricate three.

The P0 accuracy list is part of Today, not an additional screen or P1 feature. Show safe reason, affected revision, action date and validated replacement/canonical link when available; never repeat withdrawn narrative. It survives quiet/no-followed-company states and failed normal-alert loading. Acknowledgement is optional and never blocks navigation; loading/error/keyboard/mobile behavior follows the shared rules. Persisted notices remain discoverable after acknowledgement.

Feed eligibility requires a validated substantive change or explicit new announcement. A genuinely unchanged filing is history-only in the company timeline; absence of a previous source is labeled as a comparison gap, not invented novelty.

## 6. Event Detail — `/events/:id` — P0

| Field | Contract |
|---|---|
| Goal | Understand change and its limits |
| Information hierarchy | Revision/status; what changed; before/after; evidence; why it may matter; limitations; next checks |
| Components | Title/date, correction banner, comparative fact table, atomic citation chips, interpretation block, glossary, feedback buttons, evidence/follow-up tabs |
| Actions | Inspect citation, open timeline, expand metric context, rate/report, follow-up when enabled |
| Empty state | Valid facts but no comparator → “Earlier comparable information unavailable”; no validated analysis → factual source notice only if verified |
| Loading state | Structural skeleton; the previous event's content must clear on navigation |
| Error state | Missing event 404; withdrawn content shows withdrawal notice and safe source metadata; load fail retry |
| Mobile | Before and after stacked with periods/units repeated; evidence panel opens full-screen with return focus |

Comparison always includes metric, issuer, period, basis (consolidated/separate, GAAP/non-GAAP), currency/unit, previous/current values, change type, and source links. A percent delta never appears with missing/zero/negative prior base. Date of the event and date first seen by SignalBrief are distinct.

## 7. Evidence panel — event subroute — P0

| Field | Contract |
|---|---|
| Goal | Verify exactly what supports the selected claim |
| Information hierarchy | Selected claim; cited excerpt; document/issuer; location/date/tier; original link; related/contradicting evidence |
| Components | Claim selector, verbatim excerpt, page/section/table/cell locator, original-language switch, source status, previous/current tabs |
| Actions | Open validated original URL; inspect another citation; report mismatch; close with focus restoration |
| Empty state | Never substitute a generic homepage for absent evidence; unsupported claim removed/withheld |
| Loading state | Excerpt skeleton; preserve selected claim ID; links activate only for resolved evidence |
| Error state | Original unavailable → retained verified excerpt plus availability warning and last check; locator invalid → hide affected claim pending review |
| Mobile | Full-height sheet/page, large close target, bounded readable excerpt, horizontally scrollable source table only when essential |

Render sanitized text, never raw source HTML. Display Tier 1 as source origin, not an endorsement of all issuer claims. Excerpts are bounded and subject to recorded source rights.

## 8. Company Timeline — `/companies/:id/timeline` — P0

| Field | Contract |
|---|---|
| Goal | Reconstruct official-company event history and revisions |
| Information hierarchy | Company/coverage start; reverse chronological events; type filters; comparison links |
| Components | Date-grouped event list, correction chains, source status, baseline badges, pagination |
| Actions | Open event/prior event/source; change type filter; follow/unfollow |
| Empty state | No validated history with explicit coverage start; do not say no company events occurred |
| Loading state | Date/list skeleton; append pages without resetting scroll |
| Error state | Partial history warning; failed next page retry; withdrawn revisions remain labeled |
| Mobile | Single-column timeline; compact dates; no price plot or implied causal line |

## 9. AI Follow-up — event subroute — P1

| Field | Contract |
|---|---|
| Goal | Clarify the displayed event using its approved evidence |
| Information hierarchy | Scope/version; suggested questions; question input; validated answer or limitation; citations |
| Components | ≤1,000-character input, submit, pending status, quota indicator, answer sections, citations, report button |
| Actions | Submit question; inspect evidence; retry terminal failure deliberately; reset question; no open web research tool |
| Empty state | Suggestions such as “Which period is being compared?” and “What is not yet known?” |
| Loading state | Queued/retrieving/validating indicator; poll bounded job; no unvalidated token streaming |
| Error state | Unsupported question → abstention with reason; prohibited request → neutral refusal; stale revision → open correction; timeout/quota → actionable status |
| Mobile | Composer above keyboard; answer in normal page flow; source opens full-screen; no miniature chat window |

No free-ranging portfolio advice. Maximum five questions per user/local day and two in flight are proposed beta caps. Server enforces them; hidden buttons are not controls.

## 10. Calendar — `/calendar` — P1

| Field | Contract |
|---|---|
| Goal | Track the next source-confirmed company checks |
| Information hierarchy | Date range/timezone; upcoming company events; source and date status |
| Components | Agenda default, optional desktop month grid, company filter, confirmed/estimated/rescheduled/canceled badges |
| Actions | Open evidence; go to company; adjust range; inspect revision |
| Empty state | “No sourced upcoming dates in this range”; does not mean no events will happen |
| Loading state | Agenda skeleton; retain range |
| Error state | Source stale warning; unknown date displayed unscheduled; never guess from last year's date |
| Mobile | Agenda only; date-only events in all-day area; original timezone visible for precise timestamps |

## 11. Alert Center — `/alerts` — P1

| Field | Contract |
|---|---|
| Goal | Review selective in-app changes and control interruptions |
| Information hierarchy | Opt-in status; unread count; correction notices; relevant alerts; preferences |
| Components | Unread/read list, importance threshold, company mute, daily-cap explanation, mark-all-read |
| Actions | Opt in/out; open event; mark read; mute; rate useful/not useful |
| Empty state | Disabled → explain opt-in; enabled/no alerts → quiet state; no forced permission prompt |
| Loading state | Notification skeleton; optimistic read with rollback on failure |
| Error state | Save failure restores prior preference; opened withdrawn event routes to withdrawal notice |
| Mobile | List cards, large actions; no swipe-only delete/read controls |

In-app only. Normal alerts capped at three/user/local day, generated only on eligible publication with materiality ≥0.75 by default; versioned preferences may change threshold. Correction/withdrawal notices to exposed viewers already exist in P0 and are read from the accuracy-notice API; they bypass normal opt-in/mute/cap and are labeled separately. Opting out of normal alerts never hides these notices. Do not create a second notice copy during the P1 upgrade.

## 12. Settings — `/settings` — P0, portfolio/alert preferences P1

| Field | Contract |
|---|---|
| Goal | Control account, data, coverage and privacy |
| Information hierarchy | Account; followed-company/portfolio links; timezone; analytics; alerts; export/delete/logout; policies |
| Components | Read-only login email, timezone selector, consent toggle, coverage page, data-request status, deletion confirmation |
| Actions | Change preferences; export own data; reauthenticate/delete; log out |
| Empty state | Default preferences clearly labeled; no preference inferred from financial behavior |
| Loading state | Per-section save indicators; no all-screen lock for one toggle |
| Error state | Inline field error; failed export retry; deletion failure tracked without re-enabling a deleted account silently |
| Mobile | Stacked sections; destructive action separated spatially with explicit confirmation |

## 13. Internal Ops Console — `/ops` — P0, richer version control P1

| Field | Contract |
|---|---|
| Goal | Detect ingestion/analysis failures and control publication safely |
| Information hierarchy | Critical incidents and stale coverage; review queue; run/source detail; validation; actions; latency/cost/version dashboards |
| Components | Jobs/runs tables, class/status filters, side-by-side evidence, validator results, review reason field, action confirmation, audit history |
| Actions | Approve passing candidate; reject; withdraw; mark duplicate; replay; pause publication; P1 select evaluated config/rollback |
| Empty state | No pending review distinct from ingestion offline; show last pipeline heartbeat |
| Loading state | Query skeleton; mutations pending until committed; disable duplicate action |
| Error state | 403 for non-admin; stale revision 409 reload; gate failure explains block; replay failure remains inspectable |
| Mobile | Readable stacked run summaries; critical pause/withdraw possible; complex comparisons expand into sequential panels |

Operator actions require server-side authorization and reasons, not a client role flag. Source text cannot instruct an operator tool or change configuration. No raw secrets, private portfolio weights or unrestricted prompt editor.

## Usability acceptance

First-value, source verification, invalid comparison, stale coverage, conflict, correction, report, quota, account deletion, and unauthorized Ops must each have a fixture-driven screen state. A small unmoderated comprehension test asks participants to find the original source, identify the compared period and distinguish fact from inference. Record actual results later; this specification does not claim usability passed.
