import type { components } from "./generated.js";

type Fact = components["schemas"]["Fact"];
declare const fact: Fact;
const value: string | null = fact.value_decimal;
const zero: Fact["value_decimal"] = "0";
const unknown: Fact["value_decimal"] = null;
// @ts-expect-error Decimal JSON boundaries never accept floating point numbers.
const floating: Fact["value_decimal"] = 0;
// @ts-expect-error Versioned units reject unregistered values.
const invalidUnit: Fact["unit"] = "dollars";
// @ts-expect-error Nullable fields remain required.
const incomplete: Fact = { fact_id: "synthetic" };
declare const stage: components["schemas"]["StageResult"];
if (stage.stage === "event_extraction" && stage.output !== null) {
  const events = stage.output.events;
  void events;
  // @ts-expect-error Extraction cannot masquerade as a publication decision.
  stage.output.publication_decision;
}
void [value, zero, unknown, floating, invalidUnit, incomplete];
