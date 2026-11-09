"use client";

import type { z } from "zod";
import { request } from "@/lib/api";
import { companiesSchema, watchlistSchema } from "@/lib/contracts";
import { pageDataCache } from "@/lib/page-data-cache";
import { workspace } from "@/workspace/client";
import { catalogSchema, savedSchema, sourceOverviewSchema, type WorkspaceRequest } from "@/workspace/contracts";
import { loadCalendarData } from "./calendar-query";
import { loadCalendarCoverage } from "./calendar-data";
import { addDays, dayInZone, visibleDays } from "./calendar-utils";
import { koreaDate } from "./dashboard-contract";
import type { HomeVariant } from "./home-variant";
import { loadHomeSnapshot } from "./home-snapshot";

export const navigationPaths = ["/today", "/explore", "/watchlist", "/calendar", "/saved"] as const;
export type NavigationPath = (typeof navigationPaths)[number];

type Options = { timezone: string; homeVariant: HomeVariant; now?: Date };

/** Warm the same validated reads the destination consumes, never a second data source. */
export async function prefetchNavigation(token: string, path: NavigationPath, options: Options) {
  if (!pageDataCache.isCurrent(token)) return;
  const jobs: Promise<unknown>[] = [];
  const current = () => pageDataCache.isCurrent(token);
  const read = <T,>(input: WorkspaceRequest, schema: z.ZodType<T>) => {
    if (!current()) return;
    const key = "workspace:" + JSON.stringify(input);
    jobs.push(pageDataCache.request(token, key, "GET", () => workspace(token, input, schema)));
  };
  const resource = <T,>(url: string, schema: z.ZodType<T>) =>
    pageDataCache.request(token, url, "GET", () => request(url, token, schema));
  const now = options.now ?? new Date();
  const today = dayInZone(now, options.timezone);

  if (path === "/explore") {
    read({ action: "design_directory", p: { market_group: "all", q: "", limit: 50, offset: 0 } }, catalogSchema);
    read({ action: "source_overview", p: { scope: "all", days: 0 } }, sourceOverviewSchema);
  } else if (path === "/watchlist") {
    read({ action: "source_overview", p: { scope: "following", days: 0 } }, sourceOverviewSchema);
    jobs.push(resource("/v1/watchlist", watchlistSchema).then(list => {
      if (current()) return loadCalendarData(token, {
        from: today, until: addDays(today, 365), companyIds: list.items.map(company => company.id).sort(), includePersonal: false,
      });
    }));
  } else if (path === "/calendar") {
    const days = visibleDays(today, "month");
    jobs.push(resource("/v1/companies?limit=100", companiesSchema), resource("/v1/watchlist", watchlistSchema));
    jobs.push(
      loadCalendarData(token, { from: days[0], until: days[days.length - 1], includePersonal: true }),
      loadCalendarData(token, { from: today, until: addDays(today, 365), includePersonal: true }),
      loadCalendarData(token, { from: addDays(today, -90), until: addDays(today, -1), order: "desc", includePersonal: true }),
    );
  } else if (path === "/saved") {
    read({ action: "saved_list", p: { kind: "", sort: "newest" } }, savedSchema);
  } else if (path === "/today") {
    const homeDay = koreaDate(now);
    jobs.push(loadHomeSnapshot(token, homeDay));
    jobs.push(loadCalendarData(token, {
      from: homeDay, until: addDays(homeDay, options.homeVariant === "B" ? 6 : 30), includePersonal: false,
    }));
    if (options.homeVariant === "B") {
      jobs.push(loadCalendarCoverage(token, null));
    }
  }
  // A failed speculative read must not disturb the current page. The destination
  // retries normally and presents its existing error/retry controls if needed.
  await Promise.allSettled(jobs);
}
