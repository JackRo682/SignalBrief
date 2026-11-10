# Launch production verification — 2026-11-10

Runtime release: e67bc810742e049adc78e0721f1f7b2b64e0b923, exact tested tree 238d7534ef7b8f252901bea9075c16cd2f55dbbc. Vercel production was READY before the following live smoke checks.

## Live results at 06:56 UTC

- All nine public pages returned HTTP 200 with `index, follow`; `/signup` and `/login` remained `noindex, nofollow`.
- `/robots.txt` and `/sitemap.xml` returned 200; the sitemap contained exactly nine public URLs.
- The actual consent UI sent page-view records to the production database with the fixed GeekNews referral category.
- A subsequent direct test of the production API returned `200 {ok:true,recorded:true}` for a temporary visitor; erase returned `200 {ok:true}`; delayed replay returned `200 {ok:true,recorded:false}`.
- Anonymous aggregate read returned 401; cross-origin POST returned 403.
- All three explicitly identified verification-only visitor records were removed; no real signup account or email was created.
- Both traffic tables have RLS enabled and no SELECT permission for anon/authenticated. The private implementation is not executable by anon. Daily `signalbrief-traffic-retention` cron is active.
- Security advisors returned no advisories. This is not a full penetration-test certification.

## Migration bookkeeping

Supabase recorded the applied migration as `20261110064509_launch_acquisition_analytics`. The repository migration is renamed to that exact version with its original blob unchanged (`26781af2760c646b462582bea20c86d8bac4461e`), and the test fixture path is updated. This prevents a future migration push attempting to replay the same DDL. No production schema history is rewritten and no application runtime code changes in this follow-up.

## Remaining limits

Live delivery/verification of signup email and a real new-user onboarding session remain unverified because the account-creation tool action was blocked. Calendar changes mitigate repeated upstream restrictions; they do not lift provider 403 restrictions or fix the separate missing official IR link. See LAUNCH_READINESS_20261110.md for the full scope, test results and limitations.
