# SignalBrief Product Vision

Version 1.1 • 2 October 2026 • Owner: Product / AI Architecture

Status: specification baseline for implementation, not a claim of product-market fit or production readiness. No application has been implemented in this task.

## Mission and promise

Help self-directed investors notice material changes in the companies they follow, understand the comparison, inspect the evidence, and know what to check next.

The product promise is: **“See what changed in the companies you follow, with the earlier information, the original evidence, and clear limits on what can be concluded.”** Coverage is limited to named supported companies, source types, and time ranges. Never promise to explain every price move or detect every important development.

SignalBrief provides investment information. It must not recommend buying, selling, position sizes, target prices, trades, or certain price outcomes. These are product prohibitions, not a determination of legal classification.

## Evidence labels and precedence

Every discovery claim uses one of four labels:

- **A — Documentary requirement:** directly present in the supplied vision or project instructions; it is an intention, not user validation.
- **B — Survey observation:** measured in the supplied aggregate report, with question, page, denominator, and qualification.
- **C — Inference:** interpretation supported by A/B, with alternatives acknowledged.
- **D — Unvalidated assumption:** a design default, target, proposed threshold, or hypothesis awaiting testing.

All product and engineering choices introduced by this specification are **D / design decisions** unless explicitly marked A, B, or C. “Must” makes them implementation requirements; it does not turn them into empirical findings. Current user instructions take precedence over the older vision's career-oriented suggestions. Survey conflicts are recorded, not silently resolved as facts.

Source identifiers V1, S1, and I1 are defined in [USER_RESEARCH.md](USER_RESEARCH.md). Technical references T1–T9 are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Target and job

Primary working persona: a self-directed Korean-speaking individual investor following a small set of Korean and/or US listed companies, already using brokerage apps and news, who wants help deciding which company developments deserve attention. This is an inferred persona, not a measured cluster.

The source vision assumed 5–30 followed names [A: V1 §2]. The survey median is four and mode three [B: S1 Q5, p4]. V1 therefore permits activation with one supported company, suggests three, and never requires portfolio amounts. Product capacity is 30 names; that limit is a design choice, not a population estimate.

JTBD: **When a company I follow publishes new information, help me identify the important change and check it against reliable evidence, so I can understand it without repeatedly searching and reconciling sources.**

## Principles

1. Facts → evidence → comparison → interpretation → uncertainty. The interface can summarize first, but its underlying provenance must follow this order.
2. Tier 1: regulator/exchange filings; Tier 2: issuer IR and official announcements; Tier 3: licensed reliable media/data; Tier 4: other secondary sources. Tier 3/4 are outside initial ingestion.
3. Lower-tier information cannot overwrite higher-tier facts. Match period, basis, effective date, and metric before declaring agreement or conflict. A newer forward-looking issuer statement can be a new event, not a rewrite of a past filing.
4. Contradictory comparable evidence produces `conflicting_evidence`, preserves both sources, and blocks the disputed conclusion.
5. Never confuse a missing baseline with no change, a source outage with no events, or temporal proximity with price causation.
6. Evidence citations are necessary but not sufficient: identity, location, numbers, context, and entailment require validation.
7. Plain language is the default. Detailed evidence is progressively disclosed; separate beginner/advanced products are deferred.
8. Publish less when evidence is inadequate. Rejected items remain observable in Ops.
9. Generate company analyses once; personalize ranking deterministically. Do not send private holdings to the model to write the same analysis again.
10. Track corrections visibly and measure omissions, not only mistakes in published content.

## Core loop

Watchlist / optional portfolio → official-source ingestion → event extraction → comparable earlier event → change detection → evidence validation → analysis → policy validation → personalized feed → source inspection / feedback → reviewed ranking and quality improvements.

Learning does not mean uncontrolled online weight changes. Product reviews and versioned evaluations precede ranking, model, prompt, and policy changes.

## V1 boundaries and release order

P0 proves the core loop with login, watchlist, small supported universe, feed, comparisons, evidence, basic timeline, plain-language explanations, feedback, evaluation, telemetry, and minimum Ops controls, including persistent accuracy notices for exposed viewers. P1 completes the named beta surfaces: optional portfolio, grounded follow-up, source-confirmed calendar, in-app alerts, and richer Ops. Both are V1; P1 does not block the first P0 pilot. Full feature contracts are in [MVP_SCOPE.md](MVP_SCOPE.md).

Initial operational envelope: 20 supported issuers, proposed split 12 KR / 8 US; 20–30 invited testers over 4–6 weeks; one operator. These are capacity assumptions. The final company roster depends on source coverage and consenting testers' needs. It must be committed and shown before invitations. Korean UI and explanations are the proposed beta default; original English source excerpts remain available and translations are labeled.

Explicitly excluded: trade execution, brokerage-account connection, recommendations, target prices, autonomous trading, price predictions, community, screener, tick charts, full financial modeling, crypto, robo-advice, and indiscriminate news aggregation. ETF holdings/look-through, licensed price context, and sector propagation require later evidence and data work.

## What the research validates

Information overload is the leading selected pain (49/105); concept helpfulness receives 60/105 top-two ratings. This supports testing a focused service, not declaring demand or retention proven. Change summaries receive 36/105 selections; monitoring 43/105; price-linked issue timelines 47/105. Evidence access, fact/interpretation separation, and freshness remain essential trust requirements even when they are not the highest-ranked feature. [B: S1 Q13, Q22–24]

The principal unresolved tension is price-context demand versus a filing-grounded product without licensed prices or reliable causal attribution. V1 explicitly tests whether a sourced event timeline is useful on its own. It does not claim this substitute fully validates the top-ranked survey feature.

## Success and stop conditions

North Star: weekly evidence-backed qualified sessions, with breadth across users and weeks reported beside volume. A session requires a relevant published event open plus an evidence or substantive engagement action; exact definitions are in [ANALYTICS.md](ANALYTICS.md).

Proceed beyond beta only after observed repeat use, useful-event feedback, acceptable time-to-insight, sufficient source coverage, and quality gates. Fix or narrow coverage when missing events undermine value. Suspend generated publication on unsupported material claims, wrong-issuer comparisons, uncontained access failures, or critical policy failures. Product learning cannot justify publishing known-invalid content.
