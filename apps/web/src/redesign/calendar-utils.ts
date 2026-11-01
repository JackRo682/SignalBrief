import { z } from "zod";

export const isoDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Invalid calendar date");

/** Calendar storage currently has DATE precision, never an inferred meeting time. */
export const calendarEntrySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  occurs_on: isoDaySchema,
  company_id: z.string().uuid().nullable(),
  event_id: z.string().uuid().nullable(),
  origin: z.string(),
  quote: z.string().nullable(),
  source_url: z.string().nullable(),
  source_timezone: z.string().nullable().optional(),
  verified_at: z.string().nullable().optional(),
});
export type CalendarEntry = z.infer<typeof calendarEntrySchema>;
export type CalendarScope = "all" | "following" | "selected";
export type CalendarView = "month" | "week" | "day";

export function dayInZone(
  value: Date | number | string,
  timeZone = "Asia/Seoul",
): string {
  // Date-only values must remain the source calendar day in every display timezone.
  if (typeof value === "string" && isoDaySchema.safeParse(value).success)
    return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid instant");
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDays(value: string, days: number): string {
  isoDaySchema.parse(value);
  if (!Number.isInteger(days)) throw new Error("Days must be an integer");
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function moveAnchor(
  anchor: string,
  view: CalendarView,
  direction: number,
): string {
  isoDaySchema.parse(anchor);
  if (view !== "month")
    return addDays(anchor, direction * (view === "week" ? 7 : 1));
  const date = new Date(`${anchor}T00:00:00Z`);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + direction);
  return date.toISOString().slice(0, 10);
}

export function visibleDays(anchor: string, view: CalendarView): string[] {
  isoDaySchema.parse(anchor);
  if (view === "day") return [anchor];
  const date = new Date(`${anchor}T00:00:00Z`);
  if (view === "week")
    return Array.from({ length: 7 }, (_, i) =>
      addDays(anchor, i - date.getUTCDay()),
    );
  const first = anchor.slice(0, 7) + "-01";
  const firstDate = new Date(`${first}T00:00:00Z`);
  const lastDate = new Date(
    Date.UTC(firstDate.getUTCFullYear(), firstDate.getUTCMonth() + 1, 0),
  );
  const count =
    Math.ceil((firstDate.getUTCDay() + lastDate.getUTCDate()) / 7) * 7;
  return Array.from({ length: count }, (_, i) =>
    addDays(first, i - firstDate.getUTCDay()),
  );
}

export function calendarHref(item: Pick<CalendarEntry, "id">): string {
  // An occurrence id is not a published analysis/event id, even when both are UUIDs.
  return `/events/${encodeURIComponent(item.id)}?kind=calendar`;
}

export function matchesCalendarScope(
  item: CalendarEntry,
  scope: CalendarScope,
  followed: ReadonlySet<string>,
  selected: ReadonlySet<string>,
  includePersonal = true,
): boolean {
  if (item.origin === "user") return includePersonal;
  if (scope === "all") return true;
  return (
    item.company_id !== null &&
    (scope === "following" ? followed : selected).has(item.company_id)
  );
}

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldIcsLine(line: string): string {
  let result = "",
    bytes = 0;
  for (const char of line) {
    const length = new TextEncoder().encode(char).length;
    if (bytes + length > 75) {
      result += "\r\n ";
      bytes = 1;
    }
    result += char;
    bytes += length;
  }
  return result;
}

/** RFC 5545 all-day export. Optional alarms are delivered by the importing calendar. */
export function calendarIcs(
  items: ReadonlyArray<CalendarEntry>,
  options: { now?: Date; alarmDays?: number } = {},
): string {
  const alarm = options.alarmDays;
  if (
    alarm !== undefined &&
    (!Number.isInteger(alarm) || alarm < 0 || alarm > 30)
  )
    throw new Error("Invalid alarm lead time");
  const stamp =
    (options.now ?? new Date())
      .toISOString()
      .replace(/[-:]/g, "")
      .split(".")[0] + "Z";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SignalBrief//Calendar//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const item of items) {
    calendarEntrySchema.parse(item);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${encodeURIComponent(item.id)}@signalbrief.online`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${item.occurs_on.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${addDays(item.occurs_on, 1).replace(/-/g, "")}`,
      `SUMMARY:${escapeIcs(item.title)}`,
    );
    if (item.quote) lines.push(`DESCRIPTION:${escapeIcs(item.quote)}`);
    if (item.source_url) {
      try {
        const url = new URL(item.source_url);
        if (url.protocol === "https:" && !url.username && !url.password)
          lines.push(`URL:${url.href}`);
      } catch {
        /* Invalid provider links are not exported. */
      }
    }
    if (alarm !== undefined)
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeIcs(item.title)}`,
        `TRIGGER:${alarm === 0 ? "PT0S" : `-P${alarm}D`}`,
        "END:VALARM",
      );
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
