import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompanyDiscovery from "../src/redesign/company-discovery";

const mocks = vi.hoisted(() => ({ push: vi.fn(), token: "synthetic-directory-token" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/auth", () => ({ useAuth: () => ({ token: mocks.token }) }));
vi.mock("@/workspace/preferences", () => ({ usePrefs: () => ({ text: (_ko: string, en: string) => en }) }));
const id = "22000000-0000-4000-8000-000000000001";
const otherId = "22000000-0000-4000-8000-000000000002";
const issuer = { provider: "sec", provider_company_id: "0000000042", ticker: "TEST.A", name: "Synthetic Issuer", market: "US", company_id: null };
const catalog = (items: unknown[] = [issuer], source_status = "ready") => ({ items, total: items.length, source_status });
beforeEach(() => {
  vi.clearAllMocks(); mocks.token = "synthetic-directory-token";
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json(catalog())));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("official company discovery", () => {
  it("normalizes fullwidth input and whitespace and excludes already displayed registered companies", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(catalog([
      { ...issuer, company_id: id, name: "Already visible" },
      { ...issuer, provider_company_id: "0000000043", ticker: "OTHER", company_id: otherId, name: "Other registered company" },
      { ...issuer, provider_company_id: "0000000044", ticker: "NEW", name: "New issuer" },
    ])));
    render(<CompanyDiscovery query="  ＴＥＳＴ　　company  " existingCompanies={[{ id, ticker: issuer.ticker }]} />);
    const existing = await screen.findByRole("link", { name: /Other registered company/ });
    expect(existing).toHaveAttribute("href", `/companies/${otherId}?selected_ticker=OTHER`);
    expect(screen.queryByText("Already visible")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New issuer Open company information" })).toBeVisible();
    expect(fetch).toHaveBeenCalledWith("/api/company-discovery?q=TEST+company", expect.objectContaining({ headers: { Authorization: "Bearer synthetic-directory-token" }, credentials: "omit" }));
  });

  it("resolves the selected ticker once and navigates only after a validated company UUID is returned", async () => {
    render(<CompanyDiscovery query="TEST" />);
    const button = await screen.findByRole("button", { name: "Synthetic Issuer Open company information" });
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(button); fireEvent.click(button);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith("/api/company-discovery", expect.objectContaining({ method: "POST", body: JSON.stringify({ provider: "sec", provider_company_id: "0000000042", ticker: "TEST.A" }) }));
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => { finish(Response.json({ company_id: id, hydration_status: "ready" })); });
    expect(mocks.push).toHaveBeenCalledWith(`/companies/${id}?selected_ticker=TEST.A`);
  });

  it("shows a real opening failure and retries without dropping the query results", async () => {
    render(<CompanyDiscovery query="TEST" />);
    const button = await screen.findByRole("button", { name: "Synthetic Issuer Open company information" });
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "upstream_unavailable" } }, { status: 502 }));
    fireEvent.click(button);
    const retry = await screen.findByRole("button", { name: "Retry company information" });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByText("Synthetic Issuer")).toBeVisible();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ company_id: id, hydration_status: "unavailable" }));
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/companies/${id}?selected_ticker=TEST.A&collection=unavailable`));
  });

  it("preserves the selected share-class ticker for issuers with a shared provider ID", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(catalog([issuer, { ...issuer, ticker: "TEST.B", name: "Synthetic Class B" }])));
    render(<CompanyDiscovery query="TEST" />);
    const button = await screen.findByRole("button", { name: "Synthetic Class B Open company information" });
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ company_id: id, hydration_status: "ready" }));
    fireEvent.click(button);
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(fetch).toHaveBeenLastCalledWith("/api/company-discovery", expect.objectContaining({ body: JSON.stringify({ provider: "sec", provider_company_id: "0000000042", ticker: "TEST.B" }) }));
  });

  it("keeps a registered alternative share class visible beside its canonical issuer result", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(catalog([
      { ...issuer, company_id: id },
      { ...issuer, ticker: "TEST.B", name: "Alternative class", company_id: id },
    ])));
    render(<CompanyDiscovery query="TEST" existingCompanies={[{ id, ticker: "TEST.A" }]} />);
    const link = await screen.findByRole("link", { name: /Alternative class/ });
    expect(link).toHaveAttribute("href", `/companies/${id}?selected_ticker=TEST.B`);
    expect(screen.queryByText("Synthetic Issuer")).not.toBeInTheDocument();
  });

  it("rejects a malformed response instead of navigating to an untrusted URL", async () => {
    render(<CompanyDiscovery query="TEST" />);
    const button = await screen.findByRole("button", { name: "Synthetic Issuer Open company information" });
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ company_id: "javascript:alert(1)", hydration_status: "ready" }));
    fireEvent.click(button);
    await screen.findByRole("button", { name: "Retry company information" });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("explains a daily new-company limit without promising that immediate retry will work", async () => {
    render(<CompanyDiscovery query="TEST" />);
    const button = await screen.findByRole("button", { name: "Synthetic Issuer Open company information" });
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "daily_company_limit" } }, { status: 429 }));
    fireEvent.click(button);
    expect(await screen.findByText(/Today's new-company connection limit has been reached/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Retry company information" })).not.toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("keeps source outages distinct from an empty directory and supports retry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(catalog([], "unavailable")));
    render(<CompanyDiscovery query="TEST" />);
    expect(await screen.findByText(/This does not mean there are no matching companies/)).toBeVisible();
    expect(screen.queryByText(/No matching company was found/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry company directory" }));
    expect(await screen.findByRole("button", { name: "Synthetic Issuer Open company information" })).toBeVisible();
  });

  it("retains usable rows and reports incomplete source coverage", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(catalog([issuer], "partial")));
    render(<CompanyDiscovery query="TEST" marketGroup="overseas" />);
    expect(await screen.findByRole("button", { name: "Synthetic Issuer Open company information" })).toBeVisible();
    expect(screen.getByText(/Some directory sources are unavailable/)).toBeVisible();
  });

  it("does not display an old query response after the search changes", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<CompanyDiscovery query="OLD" />);
    view.rerender(<CompanyDiscovery query="NEW" />);
    await screen.findByRole("button", { name: "Synthetic Issuer Open company information" });
    await act(async () => { finish(Response.json(catalog([{ ...issuer, name: "Stale query result" }]))); });
    expect(screen.queryByText("Stale query result")).not.toBeInTheDocument();
  });

  it("does not navigate if an outstanding resolve finishes after the query changes", async () => {
    const view = render(<CompanyDiscovery query="OLD" />);
    const button = await screen.findByRole("button", { name: "Synthetic Issuer Open company information" });
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(button);
    view.rerender(<CompanyDiscovery query="NEW" />);
    await screen.findByRole("button", { name: "Synthetic Issuer Open company information" });
    await act(async () => { finish(Response.json({ company_id: id, hydration_status: "ready" })); });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("treats invalid directory payloads as errors, and makes no request for an empty query", async () => {
    const view = render(<CompanyDiscovery query=" " />);
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ items: [], source_status: "ready" }));
    view.rerender(<CompanyDiscovery query="TEST" />);
    expect(await screen.findByRole("button", { name: "Retry company directory" })).toBeVisible();
    expect(screen.queryByText(/No matching company was found/)).not.toBeInTheDocument();
  });
});
