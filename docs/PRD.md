# Product specification — SignalBrief V1

## Basis and evidence classification
The attached markdown is the requested product/engineering specification. The underlying Product Vision and 105-person
survey it cites were not separately attached to this task; no survey percentage is independently revalidated here.

Source-confirmed: portfolio/watchlist important changes; what changed, importance, evidence, previous value and next check;
Google auth, Today, event detail, company timeline, follow-up, calendar, alerts, internal operations; evidence-first AI.
Implementation decisions: conservative extractive answers; human approval for live analyses; a DB outbox instead of Redis;
three synthetic demo companies; manual/explicit-source dates; in-app notifications only; missing market-price input excluded
and score weights renormalized. These are declared scope decisions, not survey findings.

## User journey and promise
Sign in → select at least three companies → see ranked relevant changes → inspect old/new evidence → ask an evidence-bound
follow-up → save a notification rule and monitor future changes. Beginner and advanced views share facts.
Promise: traceable changes from official documents, not complete real-time news coverage or a forecast of stock returns.

## Boundaries
No buy/sell recommendations, target price, broker order placement, trading, payment gateway, live market data feed,
news aggregation, email or native mobile push. Price movements cannot be attributed to an event without a market data source.

## Success criteria
A new user can finish onboarding, inspect an actual source and distinguish fact from interpretation.
Every published numerical change has typed prior/current values with compatible scope/unit/time basis and two source refs.
No unsupported/missing/numeric-mismatch claim is published. Conflicts route to review.
Operations can inspect failed jobs, raw source provenance and model/prompt metadata and perform audited actions.

## Product hypotheses
Ranking weights and activation design are V1 hypotheses. Retention and willingness to pay are unvalidated here.
No conversion, satisfaction, return improvement or production hallucination rate is invented.
