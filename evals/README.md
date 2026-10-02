# Evaluation
Run `python -m signalbrief.cli eval` from the repository root after initializing the database.
The 120 bundled cases are synthetic regression cases, not the 100–150 independently labeled real-filing Gold Dataset envisioned in the source document.
There are numeric increases/decreases/unchanged values, different scales/scopes/years, missing history, deliberately corrupted citations/numbers/units, and extractive-answer rejection cases.
Gold input format: one JSON object per line with the same fields as `datasets/synthetic-v1.jsonl`; replace `dataset_kind` with `expert_labeled_real_filing` and use `--live` with configured model/key.
`expected.facts` entries are `[field,value_raw,unit,period,scope,basis]`. Expected changes contain field, change_type, percentage_change.
Never use the labels as extraction inputs. Freeze a held-out split before prompt optimization.
Run history is written to JSON and Markdown with dataset hash, model and prompt versions; `eval_results` stores aggregate metrics.
Metrics/denominators and narrow operational meanings are documented in docs/AI_EVAL.md. A perfect synthetic score is not launch approval.
