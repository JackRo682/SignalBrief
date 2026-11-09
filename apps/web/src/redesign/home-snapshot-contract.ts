import { z } from "zod";
import { watchlistSchema } from "@/lib/contracts";
import {
  catalogSchema,
  contentNotificationsSchema,
  monitoringSchema,
  savedSchema,
} from "@/workspace/contracts";
import { isoDaySchema } from "./calendar-utils";
import { dashboardSchema, rangeStart } from "./dashboard-contract";

/** One authorized, consistent read for the default data shared by both Homes. */
export const homeSnapshotSchema = z.object({
  as_of: z.string().datetime({ offset: true }),
  today: isoDaySchema,
  watchlist: watchlistSchema,
  monitoring: z.array(monitoringSchema),
  directory: catalogSchema,
  documents: catalogSchema,
  analyses: catalogSchema,
  saved: savedSchema,
  notifications: contentNotificationsSchema,
  dashboard: dashboardSchema,
}).superRefine((value, context) => {
  if (value.dashboard.end_date !== value.today ||
      value.dashboard.start_date !== rangeStart(value.today, 30)) {
    context.addIssue({
      code: "custom",
      path: ["dashboard"],
      message: "Home dashboard does not match the requested date window",
    });
  }
});

export type HomeSnapshot = z.infer<typeof homeSnapshotSchema>;
