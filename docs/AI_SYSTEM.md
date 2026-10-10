# AI system and validation boundaries

Pipeline: raw document → safe HTML/XML/ZIP parsing → normalized text/chunks → strict extraction → fact/quote validation →
previous published evidence retrieval → deterministic numeric change comparison → generic contextual brief → review/publish.
Source company resolution uses official provider company IDs, not a model guess. The caller supplies no arbitrary source host.

OpenAI Responses is called with a strict JSON schema, `store:false`, configured model, budget, timeout and bounded retries.
Schema validation precedes persistence of facts. Extra fields, refusals, incomplete output, wrong quote/number, exhausted budget
or unavailable keys fail closed. A run records input/output usage when actually returned; missing or uncertain usage remains unknown.
Price coefficients are operator configuration, not hard-coded claims about current API prices.

## Fact checks

The opt-in `sec-tables-v1` pilot uses replayable original HTML/XBRL table evidence instead of the prose
rule below. It explicitly covers consolidated revenue and operating income only; excluded concepts
are recorded. Reconstructed quotations identify the original cells/headers and never claim to be a
continuous source sentence. The original raw hash, namespaces, labels, currency/scale, exact fiscal
intervals, sign, complete selected-cell coverage and every returned field are rechecked before approval.
See [scope, real-source checks and remaining release gates](SEC_TABLE_REPAIR_20261008.md).
Quotes must be exact substrings of the claimed document chunk, with the chunk owned by that document.
The numeric token must exist in the quote and satisfy boundaries/context; field keywords, unit scaling, period/scope/basis are
checked conservatively. Missing numbers stay null. Validators return supported / partially_supported / unsupported /
conflicting_sources / numeric_mismatch / missing_source and persist reasons. This is NOT unrestricted semantic entailment proof.
Human review remains the default publication gate for real filings.

## Comparison
Use Decimal and versioned unit conversion. Same field/company, financial basis, consolidated scope and compatible period are
required. Ratios with zero or negative prior denominators do not manufacture a meaningful percentage; percentage-point units
have separate treatment. New/old fact IDs are persisted. No reliable published history yields insufficient_history.
A risk wording difference is labeled a literal wording change; an optional separately logged semantic comparison suggests
review context, never edits the quotes or bypasses the publisher.

## Ranking
Configured P=.30, M=.20, N=.15, S=.15, A=.10, T=.10. No licensed prices means A is missing and the other weights are renormalized.
The UI and API explicitly disclose the missing component. Portfolio relevance is holding/watchlist membership, NOT live
market-value weights; average acquisition cost is not used as a fake current price. Weights are hypotheses, not optimized metrics.

## Follow-up and interpretation
Answers choose validated exact excerpts from the event/old-new source context. Advice requests are refused. No evidence means
abstention. A deterministic brief distinguishes fact, change, general interpretation, uncertainty and next checks.
This deliberately does not attempt a free-form analyst that can make unsupported causal/market claims.

## Known handling limits
PDF/OCR is not implemented; over-budget long documents are not silently truncated. Unsupported formats and large inputs enter
failure/review. Unit/table context validation can create false negatives. Compare new revisions after historical approvals when
needed. Exhaustive XBRL taxonomy normalization, human-level semantic comparison and independently labeled real 100–150-case
Gold Dataset remain future work and release-quality validation tasks.
