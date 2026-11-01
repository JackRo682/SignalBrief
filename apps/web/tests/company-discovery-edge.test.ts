// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { DiscoveryError, parseSelection, parseSecDirectory, parseDartDirectory } from "../../../supabase/functions/signalbrief-discovery/core";
import { parseProfile, parseSecProfile } from "../../../supabase/functions/signalbrief-profiles/core";
import { dartPage, koreaDate } from "../../../supabase/functions/signalbrief-collector/core";
import { ProviderError, obj, str } from "../../../supabase/functions/signalbrief-api/us-core";
import { inspectDartZIP, crc32 } from "../../../supabase/functions/signalbrief-collector/dart-document-core";

type Row = Record<string, unknown>;
const actorId = "10000000-0000-4000-8000-000000000001";
const companyId = "20000000-0000-4000-8000-000000000001";
const selection = { provider: "sec", provider_company_id: "0000000042", ticker: "TEST.A" };

function source(path: string) {
  return ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8").replace(/^import .*\r?\n/gm, "").replace(/^export /gm, ""),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
}

/** Execute the real handler and orchestration, replacing only external boundaries. */
function fixture() {
  const state = {
    authenticated: true, mfaDenied: false, rateDenied: false,
    activationDenied: false, archiveFailed: false, cacheFailed: false,
    filingsFailed: false, companyWriteFailed: false,
    claim: { ready: false, claimed: true },
    dartPages: 1, failedDartPage: 0,
  };
  const company: Row = { id: companyId, name: "Synthetic issuer", ...selection, market: "NASDAQ" };
  const order: string[] = [];
  const uploads = vi.fn(async () => { order.push("archive"); return { error: state.archiveFailed ? { message: "Synthetic archival failure" } : null }; });
  const filings = vi.fn(async () => { order.push("filings"); return { error: state.filingsFailed ? { message: "Synthetic filing write failure" } : null }; });
  const timestamp = vi.fn((values: Row) => {
    const query = { eq: () => query, in: () => query,
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        if ("last_ingested_at" in values) order.push("timestamp");
        return Promise.resolve({ error: state.companyWriteFailed ? { message: "Synthetic timestamp failure" } : null }).then(resolve, reject);
      },
    };
    return query;
  });
  const adminRpc = vi.fn(async (name: string, args: Row = {}) => {
    if (name === "sb_us_secrets") return { data: { SEC_CONTACT_EMAIL: "synthetic@example.test", DART_API_KEY: "b".repeat(40), DART_RELAY_SECRET: "a".repeat(64) }, error: null };
    if (name === "sb_us_cache") { order.push("profile"); return { data: args.v, error: state.cacheFailed ? { message: "Synthetic cache failure" } : null }; }
    if (name === "sb_discovery_admin") {
      const p = obj(args.p);
      if (args.op === "activate") {
        const matches = p.company_id === companyId || (p.provider === company.provider && p.provider_company_id === company.provider_company_id && p.ticker === company.ticker);
        if (state.activationDenied || !matches) return { data: null, error: { code: "PT404", message: "company_not_in_official_directory" } };
        return { data: company, error: null };
      }
      if (args.op === "hydration_claim") return { data: state.claim, error: null };
      if (args.op === "hydration_finish") { order.push(p.code === null ? "complete" : "failed"); return { data: {}, error: null }; }
      if (args.op === "claim") return { data: false, error: null };
    }
    return { data: null, error: null };
  });
  const readerRpc = vi.fn(async (name: string) => ({
    data: name === "sb_company_discovery" ? { items: [], total: 0, source_status: "unavailable" } : true,
    error: name === "sb_require_mfa" && state.mfaDenied || name === "sb_rate_limit" && state.rateDenied ? { message: "Synthetic denial" } : null,
  }));
  const reader = { auth: { getUser: vi.fn(async () => ({ data: { user: state.authenticated ? { id: actorId } : null }, error: state.authenticated ? null : { message: "Expired JWT" } })) }, rpc: readerRpc };
  const db = {
    rpc: adminRpc,
    from: vi.fn((table: string) => table === "companies" ? { update: timestamp } : { upsert: filings }),
    storage: { from: () => ({ upload: uploads }) },
  };
  const createClient = vi.fn((_url: string, key: string) => key === "synthetic-service-key" ? db : reader);
  const secRaw = JSON.stringify({ cik: 42, tickers: ["TEST.A"], name: "Synthetic issuer", sic: "1234", fiscalYearEnd: "1231" });
  const secSubmissions = vi.fn(async () => ({ raw: secRaw, name: "Synthetic issuer", tickers: ["TEST.A"], filings: [{ accession: "0000000042-26-000001", form: "10-Q", filing_date: "2026-10-30", report_date: null, source_url: "https://data.sec.gov/submissions/CIK0000000042.json", document_url: "https://www.sec.gov/Archives/edgar/data/42/000000004226000001/synthetic.htm" }] }));
  const dartRelay = vi.fn(async (payload: Row) => {
    if (payload.kind === "company") return new TextEncoder().encode(JSON.stringify({ status: "000", corp_code: "12345678", stock_code: "123456", corp_name: "Synthetic Korean issuer", corp_cls: "Y" }));
    if (payload.page === state.failedDartPage) throw new Error("Synthetic provider failed with secret-never-reflect");
    return new TextEncoder().encode(JSON.stringify({ status: "000", total_page: state.dartPages, list: [{ corp_code: "12345678", rcept_no: `2026110100000${payload.page}`, rcept_dt: "20261101", report_nm: `Synthetic disclosure page ${payload.page}` }] }));
  });
  const globals = {
    obj, str, ProviderError, DiscoveryError, parseSelection, parseSecDirectory, parseDartDirectory,
    parseProfile, parseSecProfile, dartPage, koreaDate, inspectDartZIP, crc32,
    secSubmissions, dartRelay, providerFetch: vi.fn(), unzipSync: vi.fn(), createClient,
    fetch: vi.fn(() => { throw new Error("Unexpected real HTTP boundary"); }),
    Response, Request, Headers, URL, Uint8Array, TextEncoder, TextDecoder, crypto, Date,
    Deno: { env: { get: (key: string) => ({ SUPABASE_URL: "https://synthetic.supabase.co", SUPABASE_ANON_KEY: "synthetic-anon-key", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key" })[key] ?? "" } },
  };
  const service = runInNewContext(source("../../../supabase/functions/signalbrief-discovery/service.ts") + "\n({ discoveryRpc, discoverySecrets, refreshDirectory, hydrateCompany });", globals) as Record<string, unknown>;
  let handler!: (req: Request) => Promise<Response>;
  runInNewContext(source("../../../supabase/functions/signalbrief-discovery/index.ts"), {
    ...globals, ...service, Deno: { ...globals.Deno, serve: (fn: typeof handler) => { handler = fn; } },
  });
  const post = (value: unknown = selection, authorization = "Bearer " + "a".repeat(30)) => handler(new Request("https://synthetic.test/", { method: "POST", headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(value) }));
  const activations = () => adminRpc.mock.calls.filter(([name, args]) => name === "sb_discovery_admin" && args?.op === "activate");
  const completions = () => adminRpc.mock.calls.filter(([name, args]) => name === "sb_discovery_admin" && args?.op === "hydration_finish" && obj(args.p).code === null);
  return { state, company, order, uploads, filings, timestamp, adminRpc, readerRpc, reader, createClient, secSubmissions, dartRelay, handler, post, activations, completions };
}

describe("discovery edge authentication and activation boundaries", () => {
  it("rejects anonymous requests before any database or provider work", async () => {
    const f = fixture();
    expect((await f.post(selection, "")).status).toBe(401);
    expect(f.createClient).not.toHaveBeenCalled();
    expect(f.activations()).toHaveLength(0);
    expect(f.secSubmissions).not.toHaveBeenCalled();
  });
  it("rejects an expired or forged JWT before acquiring a service client", async () => {
    const f = fixture(); f.state.authenticated = false;
    expect((await f.post()).status).toBe(401);
    expect(f.createClient).toHaveBeenCalledTimes(1);
    expect(f.activations()).toHaveLength(0);
    expect(f.secSubmissions).not.toHaveBeenCalled();
  });
  it.each([["mfaDenied", 403], ["rateDenied", 429]] as const)("preserves %s enforcement before activation", async (flag, status) => {
    const f = fixture(); f.state[flag] = true;
    expect((await f.post()).status).toBe(status);
    expect(f.createClient).toHaveBeenCalledTimes(1);
    expect(f.activations()).toHaveLength(0);
    expect(f.adminRpc).not.toHaveBeenCalled();
  });
  it.each([
    { ...selection, actor: "10000000-0000-4000-8000-000000000099" },
    { ...selection, company_id: companyId },
    { ...selection, provider: "untrusted" },
    { ...selection, provider_company_id: "https://attacker.test" },
    { ...selection, ticker: "../OTHER" },
  ])("rejects spoofed or malformed selections without activating: %j", async value => {
    const f = fixture();
    expect((await f.post(value)).status).toBe(422);
    expect(f.activations()).toHaveLength(0);
    expect(f.secSubmissions).not.toHaveBeenCalled();
  });
  it("passes only the verified user as actor and preserves authoritative-directory rejection", async () => {
    const f = fixture(); f.state.activationDenied = true;
    const response = await f.post();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "company_not_in_official_directory" } });
    expect(f.activations()[0][1]).toEqual({ op: "activate", p: { ...selection, actor: actorId } });
    expect(f.secSubmissions).not.toHaveBeenCalled();
  });
  it("allows company-id refresh only through the same authorization and activation boundary", async () => {
    const f = fixture();
    expect((await f.post({ company_id: companyId })).status).toBe(200);
    expect(f.activations()[0][1]).toEqual({ op: "activate", p: { company_id: companyId, actor: actorId } });
  });
});

describe("discovery hydration completion", () => {
  it("archives sources, stores the validated profile and filings, and only then returns ready", async () => {
    const f = fixture();
    const response = await f.post();
    expect(await response.json()).toEqual({ company_id: companyId, hydration_status: "ready" });
    expect(f.order).toEqual(["archive", "profile", "filings", "timestamp", "complete"]);
    expect(f.uploads).toHaveBeenCalledWith(expect.stringMatching(/^us\/sec\/submissions\/[a-f0-9]{64}\.json$/), expect.any(Uint8Array), expect.objectContaining({ upsert: false }));
    expect(f.completions()).toHaveLength(1);
  });
  it("does not respond ready while a filing persistence operation is still pending", async () => {
    const f = fixture(); let finish!: (value: { error: null }) => void, responded = false;
    f.filings.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const response = f.post().then(value => { responded = true; return value; });
    await vi.waitFor(() => expect(f.filings).toHaveBeenCalledTimes(1));
    expect(responded).toBe(false); expect(f.completions()).toHaveLength(0);
    finish({ error: null });
    expect(await (await response).json()).toMatchObject({ hydration_status: "ready" });
  });
  it.each(["archiveFailed", "cacheFailed", "filingsFailed", "companyWriteFailed"] as const)("does not claim readiness when %s occurs", async flag => {
    const f = fixture(); f.state[flag] = true;
    const response = await f.post();
    expect(await response.json()).toMatchObject({ company_id: companyId, hydration_status: "unavailable" });
    expect(f.completions()).toHaveLength(0);
    expect(f.order.at(-1)).toBe("failed");
  });
  it("does not hydrate twice when another request already holds the collection lease", async () => {
    const f = fixture(); f.state.claim = { ready: false, claimed: false };
    expect(await (await f.post()).json()).toMatchObject({ hydration_status: "unavailable", error: "collection_in_progress" });
    expect(f.secSubmissions).not.toHaveBeenCalled(); expect(f.uploads).not.toHaveBeenCalled();
    expect(f.completions()).toHaveLength(0);
  });
  it("uses prior confirmed completion without a duplicate provider call", async () => {
    const f = fixture(); f.state.claim = { ready: true, claimed: false };
    expect(await (await f.post()).json()).toEqual({ company_id: companyId, hydration_status: "ready" });
    expect(f.secSubmissions).not.toHaveBeenCalled(); expect(f.uploads).not.toHaveBeenCalled();
  });
  it("rejects a source for another ticker before archiving or writing company data", async () => {
    const f = fixture(); f.secSubmissions.mockResolvedValueOnce({ raw: "{}", name: "Wrong issuer", tickers: ["OTHER"], filings: [] });
    expect(await (await f.post()).json()).toMatchObject({ hydration_status: "unavailable", error: "company_identity_mismatch" });
    expect(f.uploads).not.toHaveBeenCalled(); expect(f.filings).not.toHaveBeenCalled();
  });
  it("does not expose provider exception text containing credentials", async () => {
    const f = fixture(); f.secSubmissions.mockRejectedValueOnce(new Error("https://provider.test/?key=secret-never-reflect"));
    const response = await f.post(), text = await response.text();
    expect(text).toContain('"hydration_status":"unavailable"');
    expect(text).not.toContain("secret-never-reflect"); expect(text).not.toContain("provider.test");
    expect(f.completions()).toHaveLength(0);
  });
  it("keeps a partially completed DART refresh unavailable when a required page fails", async () => {
    const f = fixture(); Object.assign(f.company, { provider: "dart", provider_company_id: "12345678", ticker: "123456", market: "KR" });
    f.state.dartPages = 2; f.state.failedDartPage = 2;
    const response = await f.post({ provider: "dart", provider_company_id: "12345678", ticker: "123456" });
    expect(await response.json()).toMatchObject({ hydration_status: "unavailable" });
    expect(f.uploads).toHaveBeenCalledTimes(1); // The profile source was archived before page 2 failed.
    expect(f.filings).not.toHaveBeenCalled(); expect(f.completions()).toHaveLength(0);
    expect(f.dartRelay).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }), expect.any(String), 15000);
  });
});
