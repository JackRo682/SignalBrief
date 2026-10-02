# Analytics

User consent defaults false and is persisted. Allowlisted events record only bounded non-sensitive metadata.
The server queues PostHog exports and rechecks consent at delivery, so later opt-out suppresses queued exports.
Stable event IDs prevent duplicative external writes, distinct IDs are pseudonymous hashed identities, and IP/geolocation profiling
is suppressed. No raw questions, positions, account email, document bodies or secrets are included in analytics event properties.

Taxonomy supported by the API: see the authoritative `AnalyticsIn.event_name` declaration in `api_schemas.py`.
Main flow: onboarding_started/completed, watchlist_added, brief impression/open, source inspect, follow-up, feedback, density changes.
Events are a telemetry foundation; a rendered event emitter does not prove complete statistical instrumentation or optimized funnels.
Reports can derive onboarding completion, source inspection and return engagement after real users consent and usage is collected.
No sample size, retention result or conversion success is fabricated.

Sentry is optional, PII sending is disabled, request payloads/headers are stripped by the configured hook.
Metrics include failed runs, validations, latency and unknown AI costs; unknown tokens/pricing must not display false zero costs.
