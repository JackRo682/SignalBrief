# PC / mobile reference UI reconstruction

The twenty uploaded HTML/text files each wrap a full-page WebP. They are visual references, not an executable specification. Their source/image SHA-256 hashes are in `RESPONSIVE_DESIGN_SOURCES_2026-10-04.json`. The images were decoded only into ignored local review artifacts; no uploaded bytes, Base64, raster screenshot or canvas is used as the shipped UI.

Implemented with the existing Next App Router, React components, self-hosted Pretendard and scoped CSS:

- `/`: two-column hero, responsive phone preview, six features, six source categories, four steps, plans, use examples and FAQ.
- `/features`: interactive synthetic portfolio/watchlist, fact/interpretation, source, timeline and question samples; actual account/workspace links.
- `/sources`: evidence/source cards, source links, processing flow, scope/status links and FAQ.
- `/pricing`: Free/Pro/Pro+ cards, monthly/annual display toggle, scrollable comparison table and FAQ. Current free beta and unavailable paid plans are explicit.
- `/customers`: clearly identified use examples, four concepts and a native dialog with the actual use flow.
- `/login`, `/signup`, `/forgot-password`: desktop form left / illustration right; mobile form first. Email, Google PKCE and recovery call the existing Supabase methods. Optional name goes only to Supabase user metadata. The signup checkbox acknowledges the current service/privacy notices for email and Google; it is not a new stored legal-consent or analytics-consent record.
- `/terms`: responsive eleven-part service guide with an active table of contents. Formal contractual terms remain pending.
- `/privacy`: existing operational facts preserved in eleven numbered topics, desktop expanded details / mobile collapsible details, table of contents and settings/contact links.

The existing header/logo and authenticated workspace sidebar/topbar are retained. Client links keep the auth provider alive. Existing canonical domain, callback exchange, API contracts, caching and progressive rendering remain intact. Auth requests are not replaced with mock operations; synthetic examples are confined to the public feature preview.

Product differences from the artwork are intentional: Korean text; current free beta instead of inconsistent sample dollar prices; no fabricated customer testimonials, performance, user counts, provider partnerships or legal operating details. Market/news source cards link to actual connection/scope status. DART/KRX remain explicitly on hold. Native links/buttons/forms/details/dialog have keyboard behavior and labels; input font size stays at least 16px on mobile.

## Verification

- `python scripts/verify.py --full`: all eight checks passed in a physical isolated source/dependency copy, including typecheck, lint, unit tests and production build. The copy prevents the production build from disrupting the user's running development server or modifying tracked generated files.
- Backend: 243 passed; two optional PostgreSQL checks skipped in the general suite, then both passed separately against two disposable loopback PostgreSQL databases. The test container was removed afterwards.
- Frontend: 189 unit tests passed. Lint exited successfully with the existing five canonical/full-document-navigation warnings; none were suppressed.
- Browser: 44 desktop/mobile regressions passed across auth/navigation/performance/public pages and the new design suite. Following the last mobile grid sizing and recovery-heading refinements, all 20 affected design/auth UI checks were rerun and passed. The new regression checks that the third preview card is inside the frame, rather than only checking document overflow. Narrow 320px, mobile input sizing and keyboard operations are covered.
- Reviewed local desktop/mobile screenshots of all ten supplied page types. No uploaded screenshot is used as a page or artwork.
- Live Google consent and actual email delivery require a real user account and were not performed; isolated auth tests verify the original Supabase request and callback behavior.

Deployment and remote CI evidence are recorded separately after GitHub publication. Existing unrelated dependency audit findings remain visible; the dependency lockfile is unchanged.
