import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import CompanyDetail, { exactDetailValue } from "../src/redesign/company";
import AnalysisDetail from "../src/redesign/analysis";
import {
  defaults,
  documentDetailSchema,
  type Resource,
} from "../src/workspace/contracts";
import { pageDataCache } from "../src/lib/page-data-cache";
import { companyBusinessProfiles } from "../src/lib/company-business-profiles";

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), request: vi.fn() }));
vi.mock("@/components/auth", () => ({
  useAuth: () => ({ token: "synthetic-detail-test-token" }),
}));
vi.mock("@/workspace/client", () => ({ workspace: mocks.workspace }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("../src/lib/api")>()),
  request: mocks.request,
}));
vi.mock("@/workspace/preferences", () => ({
  usePrefs: () => ({
    value: { ...defaults, locale: "en" },
    text: (_ko: string, en: string) => en,
    date: (date: string | null) => date ?? "Not available",
  }),
}));
vi.mock("@/components/company-profile", () => ({
  default: () => <section>Canonical profile endpoint</section>,
}));
vi.mock("@/components/company-news", () => ({
  CompanyNews: () => <section>Canonical news endpoint</section>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/companies/test",
}));

const companyId = "20000000-0000-4000-8000-000000000001";
const filingId = "40000000-0000-4000-8000-000000000001";
const analysisId = "40000000-0000-4000-8000-000000000002";
const company: Resource = {
  id: companyId,
  kind: "company",
  title: "Synthetic Company",
  summary: "",
  company_id: companyId,
  company_name: "Synthetic Company",
  ticker: "TEST",
  market: "NASDAQ",
  source_url: null,
  published_at: null,
  publication_precision: "date",
  category: "company",
  is_saved: false,
};
const officialOverview = {
  kind: "profile" as const, provider: "SEC EDGAR" as const,
  company_id: companyId, provider_company_id: "0000000001", ticker: "TEST",
  name: "Synthetic sourced legal name", english_name: null, industry_description: "Synthetic sourced industry",
  industry_code: "1234", established_on: null, ceo: null, website: null,
  source_url: "https://www.sec.gov/edgar/browse/?CIK=0000000001",
  source_sha256: "b".repeat(64), fetched_at: "2026-10-18T09:30:00Z",
};
const filing: Resource = {
  ...company,
  id: filingId,
  kind: "filing",
  title: "Synthetic filing",
  source_url: "https://www.sec.gov/Archives/synthetic.htm",
  published_at: "2026-10-01",
  category: "10-Q",
};
const analysisResource: Resource = {
  ...filing,
  id: analysisId,
  filing_id: filingId,
  kind: "us_analysis",
  title: "Synthetic approved excerpt",
  reviewed_at: "2026-10-31T03:00:00Z",
  coverage: "excerpt",
};
const approved: z.infer<
  typeof documentDetailSchema
>["approved_analyses"][number] = {
  resource: analysisResource,
  analysis: {
    filing_id: filingId,
    status: "approved",
    created_at: "2026-10-30T02:00:00Z",
    reviewed_at: "2026-10-31T03:00:00Z",
    result: {
      claims: [
        {
          text: "Synthetic supported claim.",
          quote: "Synthetic original quotation.",
        },
      ],
      source_url: filing.source_url!,
      uncertainty: "Synthetic excerpt limitation.",
      validation: "quote_substring_and_numeric_check",
      coverage: "excerpt",
    },
  },
};
let detail: z.infer<typeof documentDetailSchema>;
let following: boolean, failFollow: boolean, failSave: boolean;
beforeEach(() => {
  vi.clearAllMocks();
  pageDataCache.reset();
  window.history.replaceState({}, "", "/");
  following = false;
  failFollow = false;
  failSave = false;
  detail = {
    document: filing,
    approved_analyses: [structuredClone(approved)],
    metadata: {
      mime_type: "text/html",
      size_bytes: null,
      page_count: null,
      provider: "sec",
      publication_timezone: "America/New_York",
      ingested_at: "2026-10-02T00:00:00Z",
      raw_sha256: null,
    },
    summaries: [],
    facts: [],
    sections: [],
    sections_total: 0,
    next_section_offset: null,
    events: [],
    related: [],
    counts: { summaries: 0, facts: 0, events: 0, related: 0 },
  };
  mocks.workspace.mockImplementation(async (_token, req) => {
    if (req.action === "company")
      return {
        company,
        documents: [filing],
        analyses: [analysisResource],
        events: [],
        facts: [],
        watching: following,
        holding: false,
      };
    if (req.action === "document_detail") {
      if (req.p.section_offset === 1)
        return {
          ...detail,
          sections: [
            {
              id: "second",
              title: "Second evidence section",
              location: "source:2",
              content: "Synthetic additional source.",
              page_start: null,
              page_end: null,
            },
          ],
          next_section_offset: null,
        };
      return structuredClone(detail);
    }
    if (req.action === "save") {
      if (failSave) throw new Error("Synthetic save failure");
      return { saved: req.p.saved };
    }
    if (req.action === "source_overview")
      return { calendar: [], historical_calendar: [] };
    if (req.action === "visit") return {};
    throw new Error(`Unexpected action: ${req.action}`);
  });
  mocks.request.mockImplementation(async (_path, _token, _schema, init) => {
    if (failFollow) throw new Error("Synthetic follow failure");
    following = init.method === "PUT";
    return undefined;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("redesigned detail screens", () => {
  it.each([undefined, "us"])("reuses the sourced curated company introduction in the %s document/analysis sidebar", async (analysis) => {
    const original = mocks.workspace.getMockImplementation()!;
    mocks.workspace.mockImplementation(async (...args) => {
      const result = await original(...args);
      return args[1].action === "company" ? {
        ...result, company: { ...company, ticker: "MU", official_overview: { ...officialOverview, ticker: "MU" } },
      } : result;
    });
    detail.document = { ...filing, ticker: "MU" };
    render(<AnalysisDetail id={filingId} kind="filing" analysis={analysis} />);
    expect(await screen.findByText(companyBusinessProfiles.MU.description[1])).toBeVisible();
    const sidebar = within(screen.getByRole("complementary"));
    expect(sidebar.getByRole("link", { name: companyBusinessProfiles.MU.sources[0].label })).toHaveAttribute("href", companyBusinessProfiles.MU.sources[0].url);
    expect(sidebar.getByText(companyBusinessProfiles.MU.verifiedOn)).toBeVisible();
    expect(sidebar.queryByText(/Synthetic sourced legal name/)).not.toBeInTheDocument();
    expect(mocks.workspace.mock.calls.every(([, req]) => ["company", "document_detail"].includes(req.action))).toBe(true);
  });
  it.each([undefined, "us"])("shows already-loaded official company facts in the %s document/analysis sidebar", async (analysis) => {
    const original = mocks.workspace.getMockImplementation()!;
    mocks.workspace.mockImplementation(async (...args) => {
      const result = await original(...args);
      return args[1].action === "company" ? { ...result, company: { ...company, official_overview: officialOverview } } : result;
    });
    render(<AnalysisDetail id={filingId} kind="filing" analysis={analysis} />);
    expect(await screen.findByText(/Synthetic sourced legal name.*Synthetic sourced industry/)).toBeVisible();
    const sidebar = within(screen.getByRole("complementary"));
    expect(sidebar.getByRole("link", { name: "Official company facts · SEC EDGAR" })).toHaveAttribute("href", officialOverview.source_url);
    expect(sidebar.getByText(/2026-10-18T09:30:00Z/)).toBeVisible();
  });
  it("shows issuer-level share-class semantics only after verifying the selected ticker", async () => {
    window.history.replaceState({}, "", `/companies/${companyId}?selected_ticker=TEST.B`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ items: [{ company_id: companyId, ticker: "TEST.B" }] })));
    render(<CompanyDetail id={companyId} />);
    expect(await screen.findByText(/The official directory identifies the same issuer/)).toBeVisible();
    expect(screen.getByText(/Selected ticker: TEST.B/)).toHaveTextContent("Representative ticker: TEST");
  });

  it("does not trust a valid-looking ticker query parameter as proof of the issuer mapping", async () => {
    window.history.replaceState({}, "", `/companies/${companyId}?selected_ticker=UNRELATED`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ items: [{ company_id: "20000000-0000-4000-8000-000000000099", ticker: "UNRELATED" }] })));
    render(<CompanyDetail id={companyId} />);
    expect(await screen.findByText(/The selected ticker relationship could not be verified/)).toBeVisible();
    expect(screen.queryByText(/The official directory identifies the same issuer/)).not.toBeInTheDocument();
  });

  it("rejects an invalid selected ticker without making a directory request", async () => {
    window.history.replaceState({}, "", `/companies/${companyId}?selected_ticker=${encodeURIComponent('<script>')}`);
    vi.stubGlobal("fetch", vi.fn());
    render(<CompanyDetail id={companyId} />);
    await screen.findByRole("tab", { name: "Overview" });
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByText(/Selected ticker/)).not.toBeInTheDocument();
  });

  it("refreshes failed initial collection without inventing a background success", async () => {
    window.history.replaceState({}, "", `/companies/${companyId}?collection=unavailable`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ company_id: companyId, hydration_status: "ready" })));
    render(<CompanyDetail id={companyId} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reload official data" }));
    expect(await screen.findByText("Official data has been refreshed.")).toBeVisible();
    expect(fetch).toHaveBeenCalledWith("/api/company-discovery", expect.objectContaining({ method: "POST", body: JSON.stringify({ company_id: companyId }) }));
    expect(new URLSearchParams(window.location.search).has("collection")).toBe(false);
  });

  it("keeps manual collection recovery available on a direct company reopen without a status query", async () => {
    window.history.replaceState({}, "", `/companies/${companyId}?tab=disclosures`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ company_id: companyId, hydration_status: "ready" })));
    mocks.workspace.mockResolvedValueOnce({ company, documents: [], analyses: [], events: [], facts: [], watching: false, holding: false });
    render(<CompanyDetail id={companyId} />);
    const reload = await screen.findByRole("button", { name: "Reload official data" });
    expect(screen.getAllByRole("button", { name: "Reload official data" })).toHaveLength(1);
    expect(screen.queryByText(/its official data update could not be completed/)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(reload);
    expect(await screen.findByText("Official data has been refreshed.")).toBeVisible();
    expect(fetch).toHaveBeenCalledWith("/api/company-discovery", expect.objectContaining({ method: "POST", body: JSON.stringify({ company_id: companyId }) }));
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("disclosures");
    expect(new URLSearchParams(window.location.search).has("collection")).toBe(false);
    expect(screen.getAllByRole("button", { name: "Reload official data" })).toHaveLength(1);
  });

  it("shows approved numeric quotations when legacy structured facts are empty without inventing units", async () => {
    const quote = "The source reports an increase from 123 to 456.";
    mocks.workspace.mockResolvedValueOnce({
      company, documents: [filing], analyses: [analysisResource], events: [], facts: [], watching: false, holding: false,
      numeric_evidence: [{ id: `${filingId}:1`, filing_id: filingId, kind: "us_analysis", title: "Synthetic reviewed numeric source", quote, claim_text: "The reviewed source contains a numeric change.", source_url: filing.source_url, published_at: "2026-10-01", reviewed_at: "2026-10-31T03:00:00Z" }],
    });
    render(<CompanyDetail id={companyId} />);
    expect(await screen.findByRole("heading", { name: "Numeric evidence from approved analyses" })).toBeVisible();
    expect(screen.getByText(quote).tagName).toBe("BLOCKQUOTE");
    expect(screen.getByText(/They have not been normalized into comparable metrics/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Open approved analysis ↗" })).toHaveAttribute("href", `/documents/${filingId}?kind=filing&analysis=us`);
    expect(screen.queryByText("USD")).not.toBeInTheDocument();
    expect(screen.queryByText("IFRS")).not.toBeInTheDocument();
  });
  it("shows a sourced factual introduction for an uncurated discovered company", async () => {
    mocks.workspace.mockResolvedValueOnce({
      company: { ...company, official_overview: officialOverview }, documents: [], analyses: [], events: [], facts: [], watching: false, holding: false,
    });
    render(<CompanyDetail id={companyId} />);
    expect(await screen.findByRole("heading", { name: "Official company introduction" })).toBeVisible();
    expect(screen.getByText(/Synthetic sourced legal name.*Synthetic sourced industry/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Official company facts · SEC EDGAR" })).toHaveAttribute("href", officialOverview.source_url);
    expect(screen.getByText(/2026-10-18T09:30:00Z/)).toBeVisible();
    expect(screen.queryByText(/No reviewed business description is available/)).not.toBeInTheDocument();
    expect(screen.getByText("No sourced product information is available.")).toBeVisible();
  });
  it("keeps reviewed business content ahead of the factual profile fallback", async () => {
    mocks.workspace.mockResolvedValueOnce({
      company: { ...company, ticker: "AAPL", official_overview: { ...officialOverview, ticker: "AAPL" } }, documents: [], analyses: [], events: [], facts: [], watching: false, holding: false,
    });
    render(<CompanyDetail id={companyId} />);
    expect(await screen.findByText(companyBusinessProfiles.AAPL.description[1])).toBeVisible();
    expect(screen.getByRole("heading", { name: "Business overview" })).toBeVisible();
    expect(screen.queryByText(/Synthetic sourced legal name/)).not.toBeInTheDocument();
  });
  it("preserves exact decimal strings and does not convert currency or round large values", () => {
    expect(exactDetailValue("9007199254740993.120000")).toBe(
      "9,007,199,254,740,993.120000",
    );
    expect(exactDetailValue("not a numeric source")).toBe(
      "not a numeric source",
    );
  });

  it("honors direct company tab links and synchronizes keyboard navigation and URL", async () => {
    window.history.replaceState({}, "", `/companies/${companyId}?tab=analyses`);
    render(<CompanyDetail id={companyId} />);
    expect(
      await screen.findByRole("tab", { name: "Analyses" }),
    ).toHaveAttribute("aria-selected", "true");
    await screen.findByRole("link", { name: /Synthetic approved excerpt/ });
    fireEvent.keyDown(screen.getByRole("tab", { name: "Analyses" }), {
      key: "ArrowLeft",
    });
    expect(screen.getByRole("tab", { name: "Disclosures" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(new URLSearchParams(window.location.search).get("tab")).toBe(
      "disclosures",
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: "Disclosures" }), {
      key: "Home",
    });
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(new URLSearchParams(window.location.search).has("tab")).toBe(false);
  });

  it("keeps a failed follow unchanged and persists a successful follow", async () => {
    failFollow = true;
    render(<CompanyDetail id={companyId} />);
    fireEvent.click(await screen.findByRole("button", { name: "Follow" }));
    await screen.findByText("Synthetic follow failure");
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    failFollow = false;
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    expect(
      await screen.findByRole("button", { name: "Following" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(mocks.request).toHaveBeenLastCalledWith(
      `/v1/watchlist/${companyId}`,
      "synthetic-detail-test-token",
      expect.anything(),
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("renders the requested approved excerpt with true source, creation and review dates", async () => {
    render(<AnalysisDetail id={filingId} kind="filing" analysis="us" />);
    await screen.findByRole("heading", {
      name: "Synthetic approved excerpt",
      level: 1,
    });
    expect(screen.getByText("Synthetic original quotation.")).toBeVisible();
    expect(screen.getByText("Synthetic excerpt limitation.")).toBeVisible();
    expect(screen.getAllByText("2026-10-30T02:00:00Z").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("2026-10-31T03:00:00Z")).toBeVisible();
    expect(screen.getByText("2026-10-01")).toBeVisible();
    expect(screen.getByText("Source excerpt")).toBeVisible();
    expect(
      screen.queryByText("Corporate research report"),
    ).not.toBeInTheDocument();
  });

  it("does not display a different provider analysis when the requested approval is absent", async () => {
    render(<AnalysisDetail id={filingId} kind="filing" analysis="dart" />);
    await screen.findByRole("heading", {
      name: "Published analysis unavailable",
    });
    expect(
      screen.queryByText("Synthetic supported claim."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Read disclosure" }),
    ).toHaveAttribute("href", `/documents/${filingId}?kind=filing`);
  });

  it("fails closed when an unapproved analysis bypasses the client schema in a transport test", async () => {
    // Deliberately violate the type at the transport boundary to test the display guard.
    Reflect.set(detail.approved_analyses[0].analysis, "status", "needs_review");
    render(<AnalysisDetail id={filingId} kind="filing" analysis="us" />);
    await screen.findByRole("heading", {
      name: "Published analysis unavailable",
    });
    expect(
      screen.queryByText("Synthetic original quotation."),
    ).not.toBeInTheDocument();
  });

  it("saves the canonical analysis identity only after the database write succeeds", async () => {
    failSave = true;
    render(<AnalysisDetail id={filingId} kind="filing" analysis="us" />);
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await screen.findByText("Synthetic save failure");
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    failSave = false;
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByRole("button", { name: "Saved" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(mocks.workspace).toHaveBeenLastCalledWith(
      "synthetic-detail-test-token",
      {
        action: "save",
        p: { kind: "us_analysis", id: analysisId, saved: true },
      },
      expect.anything(),
    );
  });

  it("loads real document evidence sections by cursor without replacing the existing sections", async () => {
    detail.sections = [
      {
        id: "first",
        title: "First evidence section",
        location: "source:1",
        content: "Synthetic first source.",
        page_start: null,
        page_end: null,
      },
    ];
    detail.sections_total = 2;
    detail.next_section_offset = 1;
    render(<AnalysisDetail id={filingId} kind="filing" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Load more source sections" }),
    );
    await screen.findByText("Second evidence section");
    expect(screen.getByText("First evidence section")).toBeVisible();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Load more source sections" }),
      ).not.toBeInTheDocument(),
    );
  });
});
