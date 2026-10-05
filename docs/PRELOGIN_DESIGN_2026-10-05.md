# Pre-login reference design implementation — 2026-10-05

Source baseline: `6f6fe7ece8befff1ab0c4da71a599fa7936d78f2` (the current main plus a temporary isolated-tools export). Thirteen user-supplied desktop references, 1448 × 1086, were used as visual references. No screenshot is embedded as a page; layout, forms, diagrams and widgets are HTML/CSS/React/SVG.

## Routes

`/`, `/about`, `/features`, `/sources`, `/customers`, `/pricing`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/terms`, `/privacy`, `/disclaimer`.

Shared public header (five navigation destinations), compact footer, pale backgrounds, rising-bar decoration, button styles, card grids and typography are scoped to public pages. Desktop reference proportions and mobile 900/560px breakpoints are separate from the signed-in application. Each of the four primary hero dashboard illustrations and eight feature widgets has its own markup. Login/signup put the illustrated story on the left and the live form on the right; recovery has its own centered layout and password reset its own security layout. Legal pages have eight/eleven section anchors and the disclaimer has six warning cards.

## Functional and data boundaries

- Supabase password login, signup, Google OAuth, canonical callback handling, recovery request, password update and duplicate-request guards are preserved. Password minimum remains twelve characters, not the weaker requirement in the reference image. Consent remains unchecked by default.
- Demo tabs, issue filters, calendar month controls, question-preview acknowledgement, native FAQ details, the walkthrough dialog, and legal navigation are interactive. Account links continue to use authenticated destinations when signed in.
- Market widgets use explicitly labeled fictional illustration data. They do not replace the application's API data or claim live stock quotes. Customer cards are labeled usage scenarios, not invented testimonials or verified metrics.
- Proposed Pro/Team visual prices are marked unlaunched, non-billable design proposals. No payment or subscription integration was added.
- Existing beta/legal/data limitations are retained: no invented operator contact, retention deadline, customer totals, official contract date, or enabled domestic provider. Backend, schemas, environment variables, credentials and production auth configuration are unchanged.

## Validation

Local production build, TypeScript, 190 existing Vitest tests passed. ESLint: zero errors and five pre-existing warnings about location navigation. Static SSR/CSS previews rendered all thirteen routes at desktop 1448px and mobile 390px and 320px with no horizontal document overflow. This is visual inspection, not a pixel-perfect claim or an OAuth success claim.

The existing browser suites were updated to the new, user-specified navigation and layout, preserving signup/recovery calls, canonical redirects, disabled pending controls, twelve-character validation, password mismatch rejection, authenticated CTA routing, menu focus/Escape, document-preserving navigation and anonymous redirects. Additional checks cover all thirteen routes, distinct widgets, legal sections, preview interactivity, non-billable plans and desktop/mobile screenshots. GitHub Actions runs the real browser checks; their result is the release gate. Real Google user login and real email delivery are not exercised by these isolated fixtures.
