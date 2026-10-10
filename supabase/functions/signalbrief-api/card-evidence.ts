type Row = Record<string, unknown>;
const labels: Record<string, string> = {revenue:"매출",operating_income:"영업이익",guidance:"가이던스",capex:"설비투자",dividend:"배당",management_change:"경영진",risk_change:"위험 문구"};
const text = (x: unknown): string => typeof x === "string" ? x : "";

// Match the immutable brief to its current supporting change. Never use UUID
// ordering, which can select a different metric or a comparative/YTD column.
export function headlineFact(headline: string, facts: Row[], changes: Row[]): Row | undefined {
  const field = Object.keys(labels).find(key => headline.startsWith(labels[key] + " "));
  if (!field) return;
  let candidates = facts.filter(f => f.validation_status === "supported" && f.field === field);
  if (!candidates.length) return;
  const latest = candidates.map(f => text(f.period).split("/").at(-1) ?? "").sort().at(-1);
  candidates = candidates.filter(f => text(f.period).split("/").at(-1) === latest);
  if (headline === `${labels[field]} 확인 · 비교 근거 추가 필요`) {
    const period = candidates.map(f => text(f.period)).sort().at(-1);
    candidates = candidates.filter(f => text(f.period) === period);
  } else {
    const directions: Record<string,string> = {increased:"증가",decreased:"감소",wording_changed:"문구 변경"};
    const ids = new Set(changes.filter(c => {
      const direction = directions[text(c.change_type)];
      const suffix = c.percentage_change == null ? "" : ` ${c.percentage_change}%`;
      return direction && `${labels[text(c.field)]} ${direction}${suffix}` === headline;
    }).map(c => c.current_fact_id));
    candidates = candidates.filter(f => ids.has(f.id));
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}
