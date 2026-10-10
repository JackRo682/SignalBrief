# Financial evaluation v1

This corpus contains **real SEC original filings**, unlike `evals/datasets/synthetic-v1.jsonl`.
It contains **no human-verified financial ground truth**. It is a development corpus and a sealed evaluation candidate set.

## Reproduce without paid APIs

From the repository root, using Python 3.12+:

```sh
python -m pip install -e '.[dev]'
python -m pytest tests/test_financial_benchmark.py -q
python scripts/run_financial_adversarial.py
python scripts/run_financial_benchmark.py --method B --output verification/my-run/development-B.json
```

On restricted Windows machines where editable installation fails, dependencies must still be installed and `PYTHONPATH=apps/api` supplied. Use a repository-local `--basetemp=var/pytest-local` if the default temporary directory is denied. Windows native path failures are not test passes. Linux CI runs the full supported toolchain.

`manifest.json` freezes 10 development pairs (AAPL 4/MSFT 3/NVDA 3) and 20 held-out pairs (AAPL 7/MSFT 7/NVDA 6). These are quarterly **year-over-year** comparisons, not the older PR #13 quarter-over-quarter pilot. Selection uses SEC metadata and date windows before looking at extraction outcomes. The collector stores 48 immutable originals compressed losslessly, official metadata, accession, source URL, reporting date, publication timestamp and SHA-256. The manifest and original bytes are checked at load time. LF normalization makes the manifest hash portable. Public SEC originals are included for reproducibility; no contact email or API secret is persisted.

The dev window is 2024–2026 reporting dates; held-out current dates are 2020–2022. Older comparison filings are also part of each split. There is no accession or byte-hash overlap. Within a split some source filings recur, so pairs are correlated, not independent statistical samples. Both parser candidates and label review must retain exact fiscal start/end dates; a calendar-quarter label is not a substitute. Currency is normalized to base USD using original inline scale, without rounding the value.

## Methods and equivalent conditions

| Method | Input and behavior | Current execution |
|---|---|---|
| A | Both complete SEC HTML documents, direct structured LLM summarization, no deterministic answer supplied | BLOCKED, no paid approval/model configuration |
| B | Existing SEC table parser, exact fiscal context, Decimal calculation | Executed on 10 development pairs |
| C | B output plus LLM arithmetic interpretation, original fact IDs and strict claim/evidence validation | BLOCKED, no paid approval/model configuration |

The common task is consolidated actual quarterly revenue and operating income, with 4 facts and 2 comparisons per pair. No segments, EPS, causal explanation, guidance, investment advice or general filing summary is in scope. C's interpretation gate is deliberately narrow: it accepts a canonical arithmetic statement and rejects additional causal or qualitative claims. This must not be marketed as unrestricted semantic validation.

A/C share the same structured schema, model version, 5,000-output-token cap, no retries, immutable inputs, pair order and scoring. Full HTML is supplied to A without silent truncation. C sees the structure derived from those same originals. Missing/extra/duplicate outputs are penalized. Compare all arms on the same frozen version; record model snapshot, prompt/code hashes, price rates, usage and failures. A large document or over-budget request may abstain; do not quietly filter it out. Method B does not call an LLM, so no LLM cost or hallucination superiority can be inferred from B alone.

Paid execution is opt-in. Set `SB_OPENAI_API_KEY`, a snapshot `SB_OPENAI_MODEL`, and current `SB_OPENAI_INPUT_USD_PER_MILLION`/`SB_OPENAI_OUTPUT_USD_PER_MILLION` in process environment only. After explicit operator approval, supply `--method A` or `--method C` and `--approve-paid-usd <approved-lifetime-ceiling>`. The existing durable reservation mechanism uses an isolated local SQLite budget ledger (`var/financial-eval-budget.db`) and zero retries. Do not delete/reset that ledger to evade its ceiling. A numeric flag records operator intent; it is not itself proof that a human granted permission. Never inherit a production database or publish from an evaluation run.

## Metrics and denominators

- Numeric agreement: correct returned values/expected slots plus extra or duplicate predictions. There are 40 expected development fact slots. Missing outputs remain failures to complete.
- Comparison agreement: correct direction/arithmetic and both operand identities/20 expected comparisons plus extra outputs. Percentage uses `(new-old)/old*100`, four decimals; old<=0 yields null percentage.
- Citation agreement: correct source accession, exact period, field, value, unit, inline fact ID and verbatim tag text/expected or emitted slots, whichever is larger. Quote presence or an SEC URL alone is insufficient.
- Unsupported-claim rate: unsupported emitted facts, comparisons and interpretations/all emitted claims. An empty output has an undefined rate, not 0% hallucination.
- Useful completion: all required facts, citations and comparisons correct with no unsupported interpretation/all attempted pairs, including abstentions.
- Safe abstention: requires human answerability labels. It remains null. Technical rejection of an unsupported parser format does not prove calibrated model abstention.
- Latency: wall-clock per pair from method start to output/abstention, including parsing and any model call/validation. Download and independent reference construction are excluded. Median and nearest-rank p95 are reported over all attempts. This is a cold offline pipeline measurement, not production request latency or a user-experience SLA.
- Cost: per-response tokens are measured only for real API responses. Token-rate cost is an estimate with recorded rates; actual billed cost remains null until reconciled to provider billing. Transport uncertainty remains null. B's API usage cost is zero. No new paid calls were made in this work.

The independent reference reader reads undimensioned inline XBRL without calling the production table parser. It is **automated candidate evidence**, not an oracle: taxonomy/presentation ambiguity and repeated tags still require human review. Therefore `human_verified_accuracy` is null for every present run. Do not compute a confidence interval on 16 self-selected returned values and call it product accuracy. There are only 4 completed pairs from one issuer.

## Held-out and review discipline

Held-out originals have been downloaded and hashed, but not extracted, scored, used for prompt tuning or included in the human worksheet shown to the developer. Before unsealing, freeze code/prompts/metric definitions, obtain independent signed labels outside the tuning process, record an evaluation plan and run once with `--split held_out --unlock-held-out`. The flag is an accidental-use guard, not access-control against a collaborator who can read the repository. A disappointing result must remain in the report. Any tuning after unsealing requires a new held-out version. Public historical filings may be in an LLM's pretraining, so model-training contamination cannot be ruled out.

Review each development slot in `human-review.csv` against its official original. Confirm accession/issuer, consolidated statement, US-GAAP concept, exact start/end, quarter vs cumulative, currency/scale/sign, visible row/column and original inline context, both calculation operands, subtraction/percentage and citation. Fill actual reviewer/date and decision separately. Publication approval is not a financial-label attestation. The agent must never sign these fields as a human.

## Known scope limits discovered by the actual run

Apple repeats identical consolidated operating-income totals in some originals. The benchmark adapter deduplicates only identical value/unit/entity/period signatures, preserving the earliest source location; conflicting repeats abstain. Microsoft development originals exceed the existing 4 MB parser limit. NVIDIA development headers fail the existing HTML/XBRL date check. These six pairs abstain; neither document trimming nor relaxed validation was used to manufacture successful outputs. Expanding support needs targeted parser/envelope tests and another development version before a held-out run.
