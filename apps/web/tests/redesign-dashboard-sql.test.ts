// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { catalogSchema, workspaceRequest } from "../src/workspace/contracts";
import {
  dashboardSchema,
  koreaDate,
  rangeStart,
  validRange,
} from "../src/redesign/dashboard-contract";

const sql = (file: string) =>
  readFileSync(new URL(`../../../supabase/${file}`, import.meta.url), "utf8");
const actorA = "10000000-0000-4000-8000-000000000001";
const actorB = "10000000-0000-4000-8000-000000000002";
const companyA = "20000000-0000-4000-8000-00000000a001";
const companyB = "20000000-0000-4000-8000-00000000b002";
const bounds = { start_date: "2026-11-01", end_date: "2026-11-01" };
const identifier = (prefix: string, index: number) =>
  `${prefix}000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA app_private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES('${actorA}'),('${actorB}');
    CREATE FUNCTION public.sb_require_mfa() RETURNS void LANGUAGE plpgsql AS $$BEGIN IF current_setting('test.mfa',true)='deny' THEN RAISE EXCEPTION 'mfa_required';END IF;END$$;
    CREATE FUNCTION public.sb_rate_limit() RETURNS void LANGUAGE plpgsql AS $$BEGIN IF current_setting('test.rate',true)='deny' THEN RAISE EXCEPTION 'rate_limit_exceeded';END IF;END$$;
    CREATE TABLE companies(id text PRIMARY KEY,name text,ticker text,market text,provider text,is_demo boolean,last_ingested_at timestamptz);
    CREATE TABLE workspace_saved(user_id text,kind text CHECK(kind IN ('event','document','filing')),resource_id text);
    CREATE TABLE workspace_history(user_id text,kind text CHECK(kind IN ('company','event','document','filing')),resource_id text);
    CREATE TABLE documents(id text,company_id text,title text,source_url text,published_at timestamptz,publication_date date,publication_precision text,form_type text,is_demo boolean);
    CREATE TABLE events(id text,company_id text,document_id text,published_at timestamptz,event_type text,state text,published_to_users_at timestamptz);
    CREATE TABLE briefs(event_id text,headline text,what_happened text);
    CREATE TABLE us_filings(id uuid PRIMARY KEY,company_id text,form text,accession text,document_url text,filing_date date);
    CREATE TABLE dart_filings(id uuid PRIMARY KEY,company_id text,title text,receipt text,source_url text,filing_date date,publication_precision text);
    CREATE TABLE us_analyses(filing_id uuid PRIMARY KEY,status text,result jsonb,created_at timestamptz);
    CREATE TABLE dart_analyses(filing_id uuid PRIMARY KEY,status text,result jsonb,created_at timestamptz);
    CREATE TABLE audit_logs(action text,target_id text,details jsonb,created_at timestamptz);
    CREATE TABLE app_private.dart_reviews(filing_id uuid,decision text,created_at timestamptz);
    CREATE TABLE calendar_items(id text,user_id text,company_id text,title text,occurs_on date,origin text,calendar_status text,source_url text,source_timezone text,verified_at timestamptz);
    CREATE FUNCTION app_private.sb_event_visible(eid text) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.events WHERE id=eid AND state='published')$$;
    CREATE FUNCTION app_private.sb_document_visible(did text) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.events WHERE document_id=did AND state='published')$$;
    CREATE FUNCTION app_private.sb_calendar_confirmed(cid text) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.calendar_items WHERE id=cid AND verified_at IS NOT NULL AND calendar_status='confirmed')$$;
    INSERT INTO companies VALUES
      ('${companyA}','Synthetic US','TEST','NASDAQ','sec',false,now()),
      ('${companyB}','Synthetic Korean','123456','KOSPI','dart',false,now()),
      ('demo','Synthetic Demo','DEMO','NASDAQ','sec',true,now()),
      ('unsupported','Unsupported','ZZZ','UNKNOWN','other',false,now());
  `);
  // Execute the actual existing projection and approval predicates, not test reimplementations.
  await db.exec(
    sql(
      "workspace-migrations/20261019071121_company_detail_connections.sql",
    ).split("CREATE OR REPLACE FUNCTION app_mobile_private.document_detail")[0],
  );
  await db.exec(
    sql("workspace-migrations/20261030120000_source_visibility.sql").split(
      "CREATE INDEX document_chunks_search_text",
    )[0],
  );
  await db.exec(
    sql(
      "workspace-migrations/20261031125310_signed_in_content_workspace.sql",
    ).split("-- App-only notifications:")[0],
  );
  // Independently scoped RPC segment; a later calendar-reminder append has a separate fixture.
  await db.exec(
    sql("migrations/20261101014441_screenshot_dashboard.sql").split(
      "NOTIFY pgrst,'reload schema';",
    )[0],
  );
  return db;
}

async function call(db: PGlite, action: string, parameters: unknown = {}) {
  return (
    await db.query<{ data: unknown }>(
      "SELECT public.sb_redesign_workspace($1,$2::jsonb) data",
      [action, JSON.stringify(parameters)],
    )
  ).rows[0].data;
}
const dashboard = async (db: PGlite, parameters: unknown = bounds) =>
  dashboardSchema.parse(await call(db, "design_dashboard", parameters));
const directory = async (db: PGlite, parameters: unknown = {}) =>
  catalogSchema.parse(await call(db, "design_directory", parameters));

async function filing(
  db: PGlite,
  index: number,
  date = "2026-11-01",
  status?: string,
  reviewed = "2026-11-01T01:00:00Z",
) {
  const id = identifier("40", index),
    url = `https://www.sec.gov/Archives/edgar/data/1/synthetic-${index}.htm`;
  await db.query("INSERT INTO us_filings VALUES($1,$2,$3,$4,$5,$6)", [
    id,
    companyA,
    "10-Q",
    `synthetic-${index}`,
    url,
    date,
  ]);
  if (status) {
    const result = {
      validation: "quote_substring_and_numeric_check",
      source_url: url,
      normalized_excerpt: "Synthetic original evidence.",
      claims: [
        {
          text: `Synthetic claim ${index}.`,
          quote: "Synthetic original evidence.",
        },
      ],
    };
    await db.query("INSERT INTO us_analyses VALUES($1,$2,$3::jsonb,$4)", [
      id,
      status,
      JSON.stringify(result),
      "2026-10-30T00:00:00Z",
    ]);
    if (reviewed)
      await db.query("INSERT INTO audit_logs VALUES($1,$2,$3::jsonb,$4)", [
        "us_analysis_review",
        id,
        JSON.stringify({ status: "approved" }),
        reviewed,
      ]);
  }
  return id;
}

describe("redesigned dashboard and directory RPCs in disposable PostgreSQL", () => {
  it("counts the full eligible set before limits, uses approval dates, and isolates private calendar dates", async () => {
    const db = await fixture();
    try {
      await db.exec(`SET test.uid='${actorA}';`);
      for (let i = 1; i <= 7; i++)
        await filing(db, i, "2026-11-01", i <= 6 ? "approved" : undefined);
      await filing(db, 20, "2026-10-31", "approved", "2026-10-31T15:00:00Z"); // KST midnight belongs to Nov 1.
      await filing(db, 21, "2026-11-02", "needs_review");
      await filing(db, 22, "2026-10-31", "rejected");
      await filing(db, 23, "2026-10-31", "approved", ""); // Approval time absent is not guessed.
      const invalid = await filing(db, 24, "2026-10-31", "approved");
      await db.query(
        "UPDATE us_analyses SET result=jsonb_set(result,'{claims,0,quote}','\"Not in original source\"'::jsonb) WHERE filing_id=$1",
        [invalid],
      );
      for (let i = 0; i < 7; i++)
        await db.query(
          "INSERT INTO calendar_items VALUES($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            `public-${i}`,
            companyB,
            `Synthetic public event ${i}`,
            "2026-11-01",
            "official",
            "confirmed",
            "https://example.com/ir",
            "Asia/Seoul",
            "2026-10-31T00:00:00Z",
          ],
        );
      await db.exec(`INSERT INTO calendar_items VALUES
        ('000-owner-a','${actorA}','${companyB}','Owner A event','2026-11-01','official','confirmed','https://example.com/ir','Asia/Seoul',now()),
        ('001-owner-b','${actorB}','${companyB}','Owner B event','2026-11-01','official','confirmed','https://example.com/ir','Asia/Seoul',now()),
        ('002-unverified',NULL,'${companyB}','Unverified event','2026-11-01','official','confirmed','https://example.com/ir','Asia/Seoul',NULL),
        ('003-withdrawn',NULL,'${companyB}','Withdrawn event','2026-11-01','official','withdrawn','https://example.com/ir','Asia/Seoul',now()),
        ('004-personal','${actorA}','${companyB}','Personal event','2026-11-01','manual','confirmed','https://example.com/ir','Asia/Seoul',now()),
        ('005-demo',NULL,'demo','Demo event','2026-11-01','official','confirmed','https://example.com/ir','Asia/Seoul',now()),
        ('006-unsupported',NULL,'unsupported','Unsupported event','2026-11-01','official','confirmed','https://example.com/ir','Asia/Seoul',now());`);
      const a = await dashboard(db);
      expect(a).toMatchObject({
        filing_count: 7,
        analysis_count: 7,
        event_count: 8,
        timezone: "Asia/Seoul",
      });
      expect(a.filings).toHaveLength(5);
      expect(a.analyses).toHaveLength(5);
      expect(a.events).toHaveLength(5);
      expect(a.events.map((event) => event.id)).toContain("000-owner-a");
      expect(JSON.stringify(a)).not.toMatch(
        /Owner B|Unverified|Withdrawn|Personal event|Demo event|Unsupported event|Not in original source/,
      );
      await db.exec(`SET test.uid='${actorB}';`);
      const b = await dashboard(db);
      expect(b.event_count).toBe(8);
      expect(b.events.map((event) => event.id)).toContain("001-owner-b");
      expect(JSON.stringify(b)).not.toContain("Owner A");
      const filtered = await dashboard(db, { ...bounds, company_id: companyA });
      expect(filtered).toMatchObject({
        filing_count: 7,
        analysis_count: 7,
        event_count: 0,
      });
    } finally {
      await db.close();
    }
  }, 30000);

  it("handles date-only UTC dates and exact KST timestamp boundaries independently", async () => {
    const db = await fixture();
    try {
      // Current SEC/DART filings have date precision. Add typed synthetic projection
      // rows to exercise the timestamp branch without rewriting its SQL logic.
      await db.exec(`ALTER FUNCTION app_private.sb_customer_resources() RENAME TO sb_customer_resources_real;
        CREATE TABLE synthetic_resource_projection AS SELECT * FROM app_private.sb_customer_resources_real() WITH NO DATA;
        CREATE FUNCTION app_private.sb_customer_resources() RETURNS SETOF synthetic_resource_projection LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
          SELECT * FROM app_private.sb_customer_resources_real() UNION ALL SELECT * FROM public.synthetic_resource_projection
        $$;
        REVOKE ALL ON FUNCTION app_private.sb_customer_resources() FROM PUBLIC,anon,authenticated;
        SET test.uid='${actorA}';`);
      const examples = [
        ["date-in", "2026-11-01T23:59:59Z", "date"],
        ["date-out", "2026-10-31T23:59:59Z", "date"],
        ["ts-before", "2026-10-31T14:59:59.999Z", "timestamp"],
        ["ts-start", "2026-10-31T15:00:00Z", "timestamp"],
        ["ts-end", "2026-11-01T14:59:59.999Z", "timestamp"],
        ["ts-after", "2026-11-01T15:00:00Z", "timestamp"],
      ];
      for (const [id, published, precision] of examples)
        await db.query(
          `INSERT INTO synthetic_resource_projection(id,kind,title,summary,company_id,company_name,ticker,market,source_url,published_at,publication_precision,category,is_saved,provider)
        VALUES($1,'filing',$1,'',$2,'Synthetic US','TEST','NASDAQ','https://www.sec.gov/Archives/edgar/data/1/example.htm',$3,$4,'10-Q',false,'sec')`,
          [id, companyA, published, precision],
        );
      const result = await dashboard(db);
      expect(result.filing_count).toBe(3);
      expect(result.filings.map((item) => item.id).sort()).toEqual([
        "date-in",
        "ts-end",
        "ts-start",
      ]);
    } finally {
      await db.close();
    }
  }, 30000);

  it("filters market and text across the full company set before pagination", async () => {
    const db = await fixture();
    try {
      await db.exec(`SET test.uid='${actorA}';`);
      for (let i = 0; i < 65; i++)
        await db.query(
          "INSERT INTO companies VALUES($1,$2,$3,$4,$5,false,now())",
          [
            identifier("20", i),
            `A synthetic domestic ${String(i).padStart(3, "0")}`,
            `D${i}`,
            i % 2 ? "KOSDAQ" : "KOSPI",
            "dart",
          ],
        );
      for (const [i, name, ticker, market] of [
        [80, "Z overseas one", "ZX1", "NYSE"],
        [81, "Z overseas two", "ZX2", "NASDAQ"],
        [82, "Z unclassified", "ZX3", "KRX"],
      ] as const)
        await db.query(
          "INSERT INTO companies VALUES($1,$2,$3,$4,$5,false,now())",
          [identifier("20", i), name, ticker, market, "sec"],
        );
      const all = await directory(db, { limit: 50 });
      expect(all.total).toBe(70);
      expect(all.items).toHaveLength(50);
      expect(all.next_offset).toBe(50);
      const second = await directory(db, { limit: 50, offset: 50 });
      expect(second.items).toHaveLength(20);
      expect(second.next_offset).toBeNull();
      const overseas = await directory(db, {
        market_group: "overseas",
        limit: 1,
      });
      expect(overseas.total).toBe(3);
      expect(overseas.items).toHaveLength(1);
      expect(overseas.next_offset).toBe(1);
      const lastOverseas = await directory(db, {
        market_group: "overseas",
        limit: 2,
        offset: 1,
      });
      expect(lastOverseas.items.map((item) => item.ticker)).toEqual([
        "ZX1",
        "ZX2",
      ]);
      expect(lastOverseas.next_offset).toBeNull();
      expect((await directory(db, { market_group: "kospi" })).total).toBe(34);
      expect((await directory(db, { market_group: "kosdaq" })).total).toBe(32);
      expect(
        (await directory(db, { market_group: "unclassified" })).items.map(
          (item) => item.ticker,
        ),
      ).toEqual(["ZX3"]);
      expect(
        (await directory(db, { q: "zx2", market_group: "overseas" })).items.map(
          (item) => item.ticker,
        ),
      ).toEqual(["ZX2"]);
      expect(
        (await directory(db, { q: "zx2", market_group: "kospi" })).total,
      ).toBe(0);
      expect(
        all.items.some((item) => ["demo", "unsupported"].includes(item.id)),
      ).toBe(false);
    } finally {
      await db.close();
    }
  }, 30000);

  it("denies anonymous, invalid-identity, MFA and rate-limited access and validates filters", async () => {
    const db = await fixture();
    try {
      await expect(dashboard(db)).rejects.toThrow("authentication_required");
      await db.exec("SET test.uid='10000000-0000-4000-8000-000000000099';");
      await expect(directory(db)).rejects.toThrow("authentication_required");
      await db.exec(`SET test.uid='${actorA}';SET test.mfa='deny';`);
      await expect(dashboard(db)).rejects.toThrow("mfa_required");
      await db.exec("SET test.mfa='';SET test.rate='deny';");
      await expect(directory(db)).rejects.toThrow("rate_limit_exceeded");
      await db.exec("SET test.rate='';SET ROLE anon;");
      await expect(dashboard(db)).rejects.toThrow("permission denied");
      await db.exec("RESET ROLE;SET ROLE authenticated;");
      expect((await directory(db)).total).toBe(2);
      await expect(
        db.query("SELECT * FROM app_private.sb_customer_resources()"),
      ).rejects.toThrow("permission denied");
      await db.exec("RESET ROLE;");
      for (const p of [
        { ...bounds, start_date: "2026-02-30" },
        { ...bounds, start_date: "2026-11-02" },
        { ...bounds, start_date: "2025-01-01" },
        { ...bounds, surprise: true },
      ])
        await expect(dashboard(db, p)).rejects.toThrow(/invalid_/);
      for (const p of [
        { limit: 51 },
        { offset: -1 },
        { market_group: "nasdaq" },
        { q: "x".repeat(101) },
        { extra: true },
      ])
        await expect(directory(db, p)).rejects.toThrow(/invalid_/);
      const privilege = (
        await db.query<{ prosecdef: boolean }>(
          "SELECT prosecdef FROM pg_proc WHERE oid='public.sb_redesign_workspace(text,jsonb)'::regprocedure",
        )
      ).rows[0];
      expect(privilege.prosecdef).toBe(false);
      expect(
        workspaceRequest.safeParse({
          action: "design_directory",
          p: { market_group: "overseas", offset: 10000, limit: 50 },
        }).success,
      ).toBe(true);
      expect(
        workspaceRequest.safeParse({
          action: "design_dashboard",
          p: { ...bounds, company_id: actorA },
        }).success,
      ).toBe(true);
    } finally {
      await db.close();
    }
  }, 30000);

  it("normalizes uppercase company UUIDs and rejects non-UUID 36-character identifiers", async () => {
    const db = await fixture();
    try {
      await db.exec(`SET test.uid='${actorA}';`);
      await filing(db, 1);
      expect(
        (await dashboard(db, { ...bounds, company_id: companyA.toUpperCase() }))
          .filing_count,
      ).toBe(1);
      await expect(
        dashboard(db, { ...bounds, company_id: "-".repeat(36) }),
      ).rejects.toThrow("invalid_company");
    } finally {
      await db.close();
    }
  }, 30000);
});

describe("dashboard date contract", () => {
  it("keeps Korean midnight and inclusive preset range boundaries stable", () => {
    expect(koreaDate(new Date("2026-10-31T14:59:59.999Z"))).toBe("2026-10-31");
    expect(koreaDate(new Date("2026-10-31T15:00:00Z"))).toBe("2026-11-01");
    expect(rangeStart("2026-11-01", 3)).toBe("2026-10-30");
    expect(validRange("2026-02-30", "2026-03-01")).toBe(false);
    expect(validRange("2026-11-02", "2026-11-01")).toBe(false);
    expect(validRange("2026-01-01", "2027-01-01")).toBe(true);
    expect(validRange("2026-01-01", "2027-01-02")).toBe(false);
  });
});
