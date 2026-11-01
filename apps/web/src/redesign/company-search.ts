export type MarketGroup = "all" | "kospi" | "kosdaq" | "overseas" | "unclassified";
export function isSelectedTicker(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(value);
}

export function discoveredCompanyHref(id: string, ticker: string, hydration = "ready"): string {
  const params = new URLSearchParams();
  if (isSelectedTicker(ticker)) params.set("selected_ticker", ticker);
  if (hydration === "pending" || hydration === "unavailable") params.set("collection", hydration);
  return `/companies/${encodeURIComponent(id)}${params.size ? `?${params}` : ""}`;
}

/** Preserve meaningful words; the server handles aliases and separator matching. */
export function normalizeCompanyQuery(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 100);
}

export function marketCategory(value: string): Exclude<MarketGroup, "all"> {
  const market = value.trim().toUpperCase();
  if (["KOSPI", "코스피", "KRX:KOSPI"].includes(market)) return "kospi";
  if (["KOSDAQ", "코스닥", "KRX:KOSDAQ"].includes(market)) return "kosdaq";
  if (["US", "NASDAQ", "NYSE", "AMEX", "NYSEARCA", "NYSE ARCA", "NYSEAMERICAN", "CBOE", "OTC", "LSE", "TSE", "HKEX"].includes(market))
    return "overseas";
  return "unclassified";
}
