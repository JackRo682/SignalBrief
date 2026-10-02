# UX and user flows

Primary hierarchy: today's important company changes, not charts or price speculation. Cards show source tier, publication time,
importance/confidence, portfolio relevance, change count and brief access. Missing market input and stale ingestion are explicit.

Login uses Google in live mode and a prominently synthetic dev demo in demo mode. Onboarding requires at least three selected
companies. Watchlist and portfolio have actual add/remove/edit calls with empty/loading/error states and quantity validation.
Today is personalized by watched/held company membership. Event detail separates FACT / CHANGE / INTERPRETATION / UNCERTAINTY,
keeps old/current quotations and official links in context, and supports follow-up and feedback. Company view is a change timeline.
Calendar distinguishes manual from explicitly sourced dates. Alerts are in-app rule settings and unread/read history.
Settings persist density and optional analytics consent. Beginner and advanced views never use different facts.
Ops navigation requires server-authorized admin; API enforces the same independently.

Responsive CSS has desktop/sidebar, narrower layouts and mobile single-column behavior. Semantic buttons/forms, labels,
focus outlines and a skip link are present. Actual browser visual/accessibility audits remain release checks, not inferred passes.
Legal/privacy text is an operator-configured placeholder rather than a claim about actual service compliance.
