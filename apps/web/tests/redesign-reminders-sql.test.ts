// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, it, expect } from "vitest";

const userA = "10000000-0000-4000-8000-000000000001";
const userB = "10000000-0000-4000-8000-000000000002";
const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20261101014441_screenshot_dashboard.sql",
    import.meta.url,
  ),
  "utf8",
);
const start = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.sb_reference_reminders(p jsonb)",
);
if (start < 0)
  throw new Error("Reminder replacement missing from the actual migration.");
const reminderSql = migration.slice(start);

/** Synthetic upstream predicates isolate this RPC's ownership and eligibility contract. */
async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE SCHEMA app_private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE FUNCTION public.sb_require_mfa() RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF current_setting('test.mfa',true)='deny' THEN RAISE EXCEPTION 'mfa_required'; END IF; END $$;
    CREATE FUNCTION public.sb_rate_limit() RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE TABLE public.calendar_items(id text PRIMARY KEY,calendar_status text,user_id text,origin text,company_id text,event_id text);
    CREATE TABLE public.calendar_reminders(user_id text,calendar_id text,PRIMARY KEY(user_id,calendar_id));
    CREATE TABLE public.watchlists(id text PRIMARY KEY,user_id text);
    CREATE TABLE public.watchlist_items(watchlist_id text,company_id text);
    CREATE TABLE public.portfolios(id text PRIMARY KEY,user_id text);
    CREATE TABLE public.positions(portfolio_id text,company_id text);
    CREATE TABLE public.synthetic_visible_events(id text PRIMARY KEY);
    CREATE TABLE public.synthetic_verified_calendars(id text PRIMARY KEY);
    CREATE FUNCTION app_private.sb_event_visible(id text) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.synthetic_visible_events x WHERE x.id=$1) $$;
    CREATE FUNCTION app_private.sb_calendar_confirmed(id text) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.synthetic_verified_calendars x WHERE x.id=$1) $$;
    INSERT INTO public.calendar_items VALUES
      ('verified','confirmed',NULL,'official','company-a',NULL),
      ('reviewed','confirmed',NULL,'official','company-a','visible-event'),
      ('hidden','confirmed',NULL,'official','company-a','hidden-event'),
      ('cancelled','cancelled',NULL,'official','company-a','visible-event'),
      ('personal-a','confirmed','${userA}','user',NULL,NULL),
      ('personal-b','confirmed','${userB}','user',NULL,NULL);
    INSERT INTO public.synthetic_visible_events VALUES('visible-event');
    INSERT INTO public.synthetic_verified_calendars VALUES('verified');
    INSERT INTO public.watchlists VALUES('list-a','${userA}'),('list-b','${userB}');
    INSERT INTO public.watchlist_items VALUES('list-a','company-a'),('list-b','company-a');
    INSERT INTO public.portfolios VALUES('portfolio-a','${userA}');
  `);
  await db.exec(reminderSql);
  return db;
}
const rpc = async (db: PGlite, p: Record<string, unknown>) =>
  (
    await db.query<{ result: unknown }>(
      "SELECT public.sb_reference_reminders($1::jsonb) AS result",
      [JSON.stringify(p)],
    )
  ).rows[0].result;
const identify = (db: PGlite, user: string) =>
  db.query("SELECT set_config('test.uid',$1,false)", [user]);

describe("saved-date RPC ownership and eligibility regression", () => {
  it("allows own deletion after unfollow and cancellation while preserving another user’s row", async () => {
    const db = await setup();
    try {
      await identify(db, userA);
      expect(
        await rpc(db, {
          action: "set",
          calendar_id: "verified",
          enabled: true,
        }),
      ).toEqual({ saved: true, delivery: "saved_interest_only" });
      await identify(db, userB);
      await rpc(db, { action: "set", calendar_id: "verified", enabled: true });
      await db.exec(
        "DELETE FROM watchlist_items WHERE watchlist_id='list-a'; UPDATE calendar_items SET calendar_status='cancelled' WHERE id='verified'; DELETE FROM synthetic_verified_calendars;",
      );
      await identify(db, userA);
      expect(
        await rpc(db, {
          action: "set",
          calendar_id: "verified",
          enabled: false,
        }),
      ).toEqual({ saved: true, delivery: "saved_interest_only" });
      expect(await rpc(db, { action: "list" })).toEqual([]);
      const left = await db.query<{ user_id: string }>(
        "SELECT user_id FROM calendar_reminders",
      );
      expect(left.rows).toEqual([{ user_id: userB }]);
      // Idempotent removal still cannot delete another account's record.
      await rpc(db, { action: "set", calendar_id: "verified", enabled: false });
      expect(
        (
          await db.query<{ n: number }>(
            "SELECT count(*)::int n FROM calendar_reminders",
          )
        ).rows[0].n,
      ).toBe(1);
      await identify(db, userB);
      expect(await rpc(db, { action: "list" })).toEqual([
        { calendar_id: "verified" },
      ]);
    } finally {
      await db.close();
    }
  }, 20000);

  it("keeps confirmation, official visibility and ownership requirements on save", async () => {
    const db = await setup();
    try {
      await identify(db, userA);
      await expect(
        rpc(db, { action: "set", calendar_id: "hidden", enabled: true }),
      ).rejects.toThrow("calendar_not_found");
      await expect(
        rpc(db, { action: "set", calendar_id: "cancelled", enabled: true }),
      ).rejects.toThrow("calendar_not_found");
      await expect(
        rpc(db, { action: "set", calendar_id: "personal-b", enabled: true }),
      ).rejects.toThrow("calendar_not_found");
      await rpc(db, {
        action: "set",
        calendar_id: "personal-a",
        enabled: true,
      });
      await rpc(db, { action: "set", calendar_id: "reviewed", enabled: true });
      await rpc(db, { action: "set", calendar_id: "reviewed", enabled: true });
      expect(
        (
          await db.query<{ n: number }>(
            "SELECT count(*)::int n FROM calendar_reminders",
          )
        ).rows[0].n,
      ).toBe(2);
      await db.exec("DELETE FROM watchlist_items WHERE watchlist_id='list-a';");
      await expect(
        rpc(db, { action: "set", calendar_id: "verified", enabled: true }),
      ).rejects.toThrow("calendar_not_found");
      await db.exec("INSERT INTO positions VALUES('portfolio-a','company-a');");
      expect(
        await rpc(db, {
          action: "set",
          calendar_id: "verified",
          enabled: true,
        }),
      ).toEqual({ saved: true, delivery: "saved_interest_only" });
      await db.exec("DELETE FROM positions; DELETE FROM watchlist_items;");
      // A personal owned date does not require watchlist membership.
      expect(
        await rpc(db, {
          action: "set",
          calendar_id: "personal-a",
          enabled: true,
        }),
      ).toEqual({ saved: true, delivery: "saved_interest_only" });
    } finally {
      await db.close();
    }
  }, 20000);

  it("rejects anonymous/malformed calls and preserves MFA and SQL grant boundaries", async () => {
    const db = await setup();
    try {
      await expect(rpc(db, { action: "list" })).rejects.toThrow(
        "authentication_required",
      );
      await expect(
        rpc(db, { action: "set", calendar_id: "verified", enabled: false }),
      ).rejects.toThrow("authentication_required");
      await identify(db, userA);
      await expect(
        rpc(db, { action: "set", calendar_id: "verified", enabled: "false" }),
      ).rejects.toThrow("invalid_reminder_action");
      await expect(rpc(db, { action: "set", enabled: false })).rejects.toThrow(
        "invalid_calendar_id",
      );
      await expect(
        rpc(db, {
          action: "set",
          calendar_id: "verified",
          enabled: false,
          user_id: userB,
        }),
      ).rejects.toThrow("invalid_reminder_action");
      await db.exec("SET test.mfa='deny';");
      await expect(
        rpc(db, { action: "set", calendar_id: "verified", enabled: false }),
      ).rejects.toThrow("mfa_required");
      const privileges = await db.query<{
        anonymous_denied: boolean;
        authenticated_allowed: boolean;
      }>(
        "SELECT NOT has_function_privilege('anon','public.sb_reference_reminders(jsonb)','execute') anonymous_denied,has_function_privilege('authenticated','public.sb_reference_reminders(jsonb)','execute') authenticated_allowed",
      );
      expect(privileges.rows[0]).toEqual({
        anonymous_denied: true,
        authenticated_allowed: true,
      });
    } finally {
      await db.close();
    }
  }, 20000);
});
