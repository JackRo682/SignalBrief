# Evaluation methodology

Execute `signalbrief eval` or the Python module equivalent. A JSON and human-readable markdown report are written with dataset
hash, case count, model/prompt/methodology identifiers, denominators and per-case observations. A history row is stored in DB.
Expected labels are not fed to the extractor. Poisoned labels must lower performance; this is a regression test itself.

Classification: macro F1 over the union of expected/predicted labels, per-label 2TP/(2TP+FP+FN).
Fact extraction: correct exact typed fact tuples divided by union of expected/predicted tuples.
Change detection: expected change objects matched on type/current/prior/delta/percentage over scored comparison cases.
Citation coverage: extracted claims with source quote/chunk references over total extracted claims.
Citation correctness: correct verdicts on deliberately perturbed supported/unsupported source checks over validator cases.
Numeric consistency: validated exact numeric evidence matches over numeric facts.
Synthetic false acceptance: bad adversarial candidate cases incorrectly accepted over bad adversarial cases.
Hallucination rate in this report: unsupported published-candidate acceptance fraction in this bounded test harness, not a general
estimate of all real financial hallucinations. Abstention measures evidence-gate refusal correctness, not arbitrary dialogue.
Latency uses measured elapsed wall time; synthetic model cost is zero because no model API is called. Live unknown cost remains null.

The provided 120 cases are generated **synthetic regression**, not independent human-labeled real financial gold. Some metrics can
be perfect on these cases without implying useful real filing coverage. A real 100–150-case expert-reviewed dataset, held-out
splits, ambiguous units/tables, restatements, multilingual errors, conflicting claims and human semantic judging remain required
before stating production quality. Do not tune prompts against the only holdout dataset.
