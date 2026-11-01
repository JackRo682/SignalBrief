import { z } from "zod";
import { resourceSchema, verifiedCalendarSchema } from "@/workspace/contracts";
export const dashboardSchema = z.object({
  as_of: z.string(),
  timezone: z.literal("Asia/Seoul"),
  start_date: z.string(),
  end_date: z.string(),
  filing_count: z.number().int().nonnegative(),
  analysis_count: z.number().int().nonnegative(),
  event_count: z.number().int().nonnegative(),
  filings: z.array(resourceSchema),
  analyses: z.array(resourceSchema),
  events: z.array(verifiedCalendarSchema.extend({ company_name: z.string() })),
});
export function koreaDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function rangeStart(end: string, days: number) {
  const date = new Date(`${end}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days + 1);
  return date.toISOString().slice(0, 10);
}
export function validRange(start: string, end: string) {
  const dates = [start, end].map((d) => new Date(`${d}T00:00:00Z`));
  return (
    dates.every(
      (d, i) =>
        Number.isFinite(+d) && d.toISOString().slice(0, 10) === [start, end][i],
    ) &&
    +dates[0] <= +dates[1] &&
    +dates[1] - +dates[0] <= 365 * 864e5
  );
}
