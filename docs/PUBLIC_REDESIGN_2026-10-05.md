# Public page redesign

Source: 13 supplied screenshot-in-HTML TXT files, extracted and inspected as design references. Actual implementation uses React components and CSS, with no screenshot-as-page rendering.

Scope: home, introduction, features, sources, pricing, customer use cases, login, forgot password, reset password, signup, terms, privacy and investment disclaimer. Existing authenticated workspace sidebar, top bar and branding components remain unchanged. Public header component remains unchanged.

Acceptance: responsive card layouts, real route links, retained Supabase authentication handlers, recovery errors and loading states, independent password visibility controls and signup password confirmation. Source links open authoritative provider pages. Illustrative dashboard controls are labelled examples; real user data requires authentication. Prices in supplied designs are proposed, unlaunched plans; customer performance claims and invented contact details are not published as facts. Existing legal content is retained rather than replacing operational policy with unverified screenshot text.

Dependencies: existing NEXT_PUBLIC_SITE_URL and Supabase runtime configuration; Google OAuth provider and callback allowlist, email confirmation and recovery delivery. No new API keys or paid subscriptions are introduced. Payments remain unconnected. Existing FastAPI/database schema is unchanged.

Validation: Next production build, TypeScript and 190 unit tests pass. ESLint has no errors and 5 existing navigation warnings. Full scripted release verification passes: Python compile, 243 backend tests (2 PostgreSQL skips), OpenAPI export, backend lint, frontend lint, typecheck, 190 unit tests and production build. Browser and PostgreSQL release checks remain unverified. Browser visual comparison and live OAuth are not verified in this environment: Sites managed preview requires the unavailable control-browser capability. Exact pixel equivalence is not claimed. PostgreSQL isolation requires a disposable test database.

Deployment: proposed GitHub change; production deployment is not claimed until release checks and deployment are confirmed.
