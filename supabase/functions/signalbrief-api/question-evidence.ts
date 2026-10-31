type Row = Record<string, unknown>;
const text = (value: unknown): string => typeof value === "string" ? value : "";
const aliases: Record<string, string[]> = {
  매출: ["revenue"], 배당: ["dividend"], 설비: ["capex"], 투자: ["capex"], 위험: ["risk"], 리스크: ["risk"],
  경영진: ["management"], 전망: ["guidance"], 영업: ["operating"], 직원: ["employee", "headcount"],
  인원: ["employee", "headcount"], 수익: ["profit"], 부채: ["debt"], 현금: ["cash"], 자산: ["asset"],
};
const sourceWords = /원문|원본|출처|근거|인용|증거|공시|문서|\b(?:sources?|citations?|references?|evidence|original|documents?|filings?|reports?)\b/i;
const comparisonWords = /(?:변화|바뀐|달라|이전|비교)[가-힣]*|\b(?:changes?|changed|previous|compare|compared|comparison)\b/i;
const stopwords = new Set((
  "what how why where when which does do did is are was were the this that these those with from about please show tell me give of to and has have had can could would in on for be been any an " +
  "all available actual supporting supported verified complete full current us you your its it their they we our as at by get see find provide view list link links " +
  "보여줘 보여주세요 알려줘 알려주세요 주세요 어디 어디서 어떤 무엇 무엇이 뭐야 확인 확인해줘 부탁해 부탁드립니다 관련 대한 대해서 있는 있어 에서 으로 그리고 달라졌어 바뀌었어"
).split(" "));
function safeSource(value: unknown): boolean {
  const raw = text(value);
  if (!/^https?:\/\//i.test(raw) || /[\u0000-\u0020\u007f\\]/.test(raw)) return false;
  try {
    const url = new URL(raw);
    return ["https:", "http:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}

// Retrieval only. The saving RPC independently verifies publication, ownership,
// supported facts and canonical current/previous pairs before recording an answer.
export function selectQuestionEvidence(question: string, facts: Row[], evidence: Row[]) {
  if (/매수|매도|목표\s*주가|목표가|살까|팔까|사야|팔아야|\bbuy\b|\bsell\b|price\s*target|guaranteed/i.test(question)) {
    return {reason: "advice", fact_ids: [] as string[]};
  }
  const sourceRequest = sourceWords.test(question);
  const changed = comparisonWords.test(question);
  const fields = new Map(facts.map(f => [text(f.id), text(f.field)]));
  const supported = new Set(facts.filter(f => f.validation_status === "supported").map(f => text(f.id)));
  // "Source" describes the requested format, not the topic. Remove these words
  // before matching so "revenue evidence" cannot match unrelated risk evidence.
  const topical = question.toLowerCase().replace(new RegExp(sourceWords.source, "gi"), " ")
    .replace(new RegExp(comparisonWords.source, "gi"), " ");
  const words = [...new Set([
    ...(topical.match(/[a-z가-힣]{2,}/g) ?? []),
    ...Object.entries(aliases).filter(([key]) => question.includes(key)).flatMap(([, values]) => values),
  ])].filter(word => !stopwords.has(word));
  const available = evidence.filter(item =>
    text(item.fact_id) && text(item.quote).trim() && safeSource(item.source_url) &&
    (item.validation_status === "supported" || (item.validation_status === undefined && supported.has(text(item.fact_id))))
  );
  const selected = available.filter(item =>
    // A comparison source request must retain prior evidence for the server's
    // canonical pair validation. A plain source request stays on this document.
    (!sourceRequest || changed || item.role !== "previous") &&
    (words.length === 0 ? sourceRequest || changed : words.some(word =>
      (text(item.quote) + " " + (text(item.field) || fields.get(text(item.fact_id)) || "")).toLowerCase().includes(word)))
  );
  const fact_ids = [...new Set(selected.map(item => text(item.fact_id)))].slice(0, 6);
  return {reason: fact_ids.length ? (changed ? "changes" : "current") : "no_evidence", fact_ids};
}
