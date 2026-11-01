// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { DiscoveryError, parseSelection, parseSecDirectory, parseDartDirectoryResult, type DirectoryEntry } from "../../../supabase/functions/signalbrief-discovery/core";
import { parseProfile, parseSecProfile } from "../../../supabase/functions/signalbrief-profiles/core";
import { dartPage, koreaDate } from "../../../supabase/functions/signalbrief-collector/core";
import { ProviderError, obj, str } from "../../../supabase/functions/signalbrief-api/us-core";
import { dartRelay as signedDartRelay } from "../../../supabase/functions/signalbrief-collector/dart-relay";

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
    directoryClaims: { sec: false, dart: false },
    directorySigningFailed: false, directoryParseFailed: false, directoryHashMismatch: false,
  };
  const discoveryResult: Row = { items: [], total: 0, source_status: "unavailable" };
  const directoryBytes = new TextEncoder().encode("Synthetic original archive bytes for boundary-order verification");
  const directoryItems: DirectoryEntry[] = Array.from({ length: 100 }, (_, i) => ({ provider_company_id: String(i + 100).padStart(8, "0"), ticker: String(i + 100).padStart(6, "0"), name: `합성기업${i}`, market: "KR", official_english_name: `Synthetic Issuer ${i}` }));
  const company: Row = { id: companyId, name: "Synthetic issuer", ...selection, market: "NASDAQ" };
  const order: string[] = [];
  const uploads = vi.fn(async () => { order.push("archive"); return { error: state.archiveFailed ? { message: "Synthetic archival failure" } : null }; });
  const signedUrls = vi.fn(async (path: string, expiresIn: number) => {
    order.push(`signed:${expiresIn}`);
    return { data: { signedUrl: `https://synthetic.supabase.co/storage/v1/object/sign/signalbrief-raw/${path}?token=synthetic-private-read-token` }, error: state.directorySigningFailed ? { message: "Synthetic signing failure" } : null };
  });
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
      if (args.op === "claim") return { data: state.directoryClaims[p.provider as "sec" | "dart"] ?? false, error: null };
      if (args.op === "save") { order.push("directory_saved"); return { data: { count: (p.items as unknown[]).length }, error: null }; }
      if (args.op === "fail") { order.push("directory_failed"); return { data: {}, error: null }; }
    }
    return { data: null, error: null };
  });
  const readerRpc = vi.fn(async (name: string) => ({
    data: name === "sb_company_discovery" ? discoveryResult : true,
    error: name === "sb_require_mfa" && state.mfaDenied || name === "sb_rate_limit" && state.rateDenied ? { message: "Synthetic denial" } : null,
  }));
  const reader = { auth: { getUser: vi.fn(async () => ({ data: { user: state.authenticated ? { id: actorId } : null }, error: state.authenticated ? null : { message: "Expired JWT" } })) }, rpc: readerRpc };
  const db = {
    rpc: adminRpc,
    from: vi.fn((table: string) => table === "companies" ? { update: timestamp } : { upsert: filings }),
    storage: { from: () => ({ upload: uploads, createSignedUrl: signedUrls }) },
  };
  const createClient = vi.fn((_url: string, key: string) => key === "synthetic-service-key" ? db : reader);
  const secRaw = JSON.stringify({ cik: 42, tickers: ["TEST.A"], name: "Synthetic issuer", sic: "1234", fiscalYearEnd: "1231" });
  const secSubmissions = vi.fn(async () => ({ raw: secRaw, name: "Synthetic issuer", tickers: ["TEST.A"], filings: [{ accession: "0000000042-26-000001", form: "10-Q", filing_date: "2026-10-30", report_date: null, source_url: "https://data.sec.gov/submissions/CIK0000000042.json", document_url: "https://www.sec.gov/Archives/edgar/data/42/000000004226000001/synthetic.htm" }] }));
  const dartRelay = vi.fn(async (payload: Row) => {
    if (payload.kind === "directory") { order.push("directory_download"); return directoryBytes; }
    if (payload.kind === "directory_parse") {
      order.push("directory_parse");
      if (state.directoryParseFailed) throw new Error("Synthetic parser failed with synthetic-private-read-token");
      return new TextEncoder().encode(JSON.stringify({ source_sha256: state.directoryHashMismatch ? "f".repeat(64) : payload.sha, items: directoryItems }));
    }
    if (payload.kind === "company") return new TextEncoder().encode(JSON.stringify({ status: "000", corp_code: "12345678", stock_code: "123456", corp_name: "Synthetic Korean issuer", corp_cls: "Y" }));
    if (payload.page === state.failedDartPage) throw new Error("Synthetic provider failed with secret-never-reflect");
    return new TextEncoder().encode(JSON.stringify({ status: "000", total_page: state.dartPages, list: [{ corp_code: "12345678", rcept_no: `2026110100000${payload.page}`, rcept_dt: "20261101", report_nm: `Synthetic disclosure page ${payload.page}` }] }));
  });
  const globals = {
    obj, str, ProviderError, DiscoveryError, parseSelection, parseSecDirectory, parseDartDirectoryResult,
    parseProfile, parseSecProfile, dartPage, koreaDate,
    secSubmissions, dartRelay, providerFetch: vi.fn(), createClient,
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
  const get = () => handler(new Request("https://synthetic.test/?q=Synthetic", { headers: { Authorization: "Bearer " + "a".repeat(30) } }));
  const activations = () => adminRpc.mock.calls.filter(([name, args]) => name === "sb_discovery_admin" && args?.op === "activate");
  const completions = () => adminRpc.mock.calls.filter(([name, args]) => name === "sb_discovery_admin" && args?.op === "hydration_finish" && obj(args.p).code === null);
  return { state, company, order, uploads, signedUrls, directoryBytes, directoryItems, discoveryResult, filings, timestamp, adminRpc, readerRpc, reader, createClient, secSubmissions, dartRelay, handler, get, post, activations, completions };
}

describe("directory refresh avoids full XML work in Edge", () => {
  it("bounds the signed parser response before JSON allocation and hides transport details", async () => {
    const payload = { kind: "directory_parse", source_url: "https://synthetic.supabase.co/storage/v1/object/sign/signalbrief-raw/directory/dart/" + "b".repeat(64) + ".zip?token=private-read-token", sha: "b".repeat(64) };
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Uint8Array(4_000_001)));
    await expect(signedDartRelay(payload, "a".repeat(64), 20000)).rejects.toThrow("response_too_large");
    expect(fetcher).toHaveBeenCalledWith("https://signalbrief.online/api/internal/dart", expect.objectContaining({ method: "POST", redirect: "error", signal: expect.any(AbortSignal) }));
    const request = fetcher.mock.calls[0][1]!;
    expect(JSON.parse(request.body as string)).toEqual({ ...payload, nonce: expect.stringMatching(/^[a-f0-9]{64}$/) });
    fetcher.mockRejectedValueOnce(new Error("Provider leaked private-read-token"));
    await expect(signedDartRelay(payload, "a".repeat(64), 20000)).rejects.toThrow("dart:relay_network_failed");
  });
  it("archives original bytes before signing and remote parsing, then saves hash-bound verified entries", async () => {
    const f = fixture(); f.state.directoryClaims.dart = true;
    expect((await f.get()).status).toBe(200);
    expect(f.order).toEqual(["directory_download", "archive", "signed:60", "directory_parse", "directory_saved"]);
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", f.directoryBytes)).toString("hex");
    const path = `directory/dart/${digest}.zip`;
    expect(f.uploads).toHaveBeenCalledWith(path, f.directoryBytes, { contentType: "application/zip", upsert: false });
    expect(f.signedUrls).toHaveBeenCalledWith(path, 60);
    expect(f.dartRelay).toHaveBeenCalledWith({ kind: "directory", key: "b".repeat(40) }, "a".repeat(64), 15000);
    expect(f.dartRelay).toHaveBeenCalledWith({ kind: "directory_parse", source_url: `https://synthetic.supabase.co/storage/v1/object/sign/signalbrief-raw/${path}?token=synthetic-private-read-token`, sha: digest }, "a".repeat(64), 20000);
    expect(f.adminRpc).toHaveBeenCalledWith("sb_discovery_admin", { op: "save", p: { provider: "dart", lease: expect.any(String), sha: digest, object_key: path, items: f.directoryItems } });
  });
  it.each(["archiveFailed", "directorySigningFailed", "directoryParseFailed", "directoryHashMismatch"] as const)("retains cached SEC results and does not publish a DART snapshot after %s", async flag => {
    const f = fixture(); f.state.directoryClaims.dart = true; f.state[flag] = true;
    Object.assign(f.discoveryResult, { items: [{ provider: "sec", ticker: "TEST.A", name: "Cached synthetic SEC issuer" }], total: 1, source_status: "partial" });
    const response = await f.get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(f.discoveryResult);
    expect(f.adminRpc.mock.calls.filter(([name, args]) => name === "sb_discovery_admin" && args?.op === "save")).toHaveLength(0);
    expect(f.order.at(-1)).toBe("directory_failed");
    const failure = f.adminRpc.mock.calls.find(([name, args]) => name === "sb_discovery_admin" && args?.op === "fail")?.[1];
    expect(JSON.stringify(failure)).not.toContain("synthetic-private-read-token");
    expect(f.activations()).toHaveLength(0);
    if (flag === "archiveFailed") expect(f.signedUrls).not.toHaveBeenCalled();
  });
  it("rejects duplicate or malformed parser identities before persistence", async () => {
    const f = fixture(); f.state.directoryClaims.dart = true;
    f.directoryItems[99] = { ...f.directoryItems[0] };
    expect((await f.get()).status).toBe(200);
    expect(f.order.at(-1)).toBe("directory_failed");
    expect(f.adminRpc.mock.calls.filter(([name, args]) => name === "sb_discovery_admin" && args?.op === "save")).toHaveLength(0);
  });
});

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
