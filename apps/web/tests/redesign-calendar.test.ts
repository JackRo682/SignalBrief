import { describe, expect, it } from "vitest";
import {
  addDays,
  calendarHref,
  calendarIcs,
  dayInZone,
  isoDaySchema,
  matchesCalendarScope,
  moveAnchor,
  visibleDays,
  type CalendarEntry,
} from "@/redesign/calendar-utils";

const entry: CalendarEntry = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Synthetic calendar fixture",
  occurs_on: "2028-02-29",
  company_id: "00000000-0000-4000-8000-000000000002",
  event_id: "00000000-0000-4000-8000-000000000003",
  origin: "official",
  quote: "Synthetic source quote",
  source_url: "https://example.org/source",
};

describe("calendar date and identity boundaries", () => {
  it("rejects invalid dates rather than silently rolling them into the following month", () => {
    expect(isoDaySchema.safeParse("2027-02-29").success).toBe(false);
    expect(isoDaySchema.safeParse("2028-02-29").success).toBe(true);
    expect(isoDaySchema.safeParse("2026-04-31").success).toBe(false);
  });
  it("preserves date-only precision independently of user timezone", () => {
    expect(dayInZone("2026-11-01", "America/Los_Angeles")).toBe("2026-11-01");
    expect(dayInZone("2026-11-01", "Asia/Seoul")).toBe("2026-11-01");
    expect(dayInZone("2026-11-01T16:00:00Z", "Asia/Seoul")).toBe("2026-11-02");
    expect(dayInZone("2026-11-01T16:00:00Z", "America/Los_Angeles")).toBe(
      "2026-11-01",
    );
  });
  it("handles month/year and leap-day navigation without date overflow", () => {
    expect(moveAnchor("2026-01-31", "month", 1)).toBe("2026-02-01");
    expect(moveAnchor("2026-01-31", "month", -1)).toBe("2025-12-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(moveAnchor("2026-11-01", "week", -1)).toBe("2026-10-25");
  });
  it("generates actual month/week/day ranges rather than just relabeling the month", () => {
    const month = visibleDays("2028-02-15", "month");
    expect(month).toContain("2028-02-29");
    expect(month.length % 7).toBe(0);
    expect(new Date(month[0] + "T00:00:00Z").getUTCDay()).toBe(0);
    expect(visibleDays("2026-11-04", "week")).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
    ]);
    expect(visibleDays("2026-11-04", "day")).toEqual(["2026-11-04"]);
  });
  it("does not interpret a verified calendar occurrence id as a published event id", () => {
    expect(calendarHref(entry)).toBe(`/events/${entry.id}?kind=calendar`);
    expect(calendarHref(entry)).not.toContain(entry.event_id!);
  });
  it("does not fall back to all companies when the follow/specific selection is empty", () => {
    expect(matchesCalendarScope(entry, "following", new Set(), new Set())).toBe(
      false,
    );
    expect(
      matchesCalendarScope(
        entry,
        "selected",
        new Set([entry.company_id!]),
        new Set(),
      ),
    ).toBe(false);
    expect(
      matchesCalendarScope(
        entry,
        "selected",
        new Set(),
        new Set([entry.company_id!]),
      ),
    ).toBe(true);
    expect(
      matchesCalendarScope(
        { ...entry, origin: "user" },
        "following",
        new Set(),
        new Set(),
        false,
      ),
    ).toBe(false);
  });
});

describe("calendar ICS output", () => {
  const now = new Date("2026-11-01T03:45:00Z");
  it("exports all-day dates with an exclusive end and a stable occurrence UID", () => {
    const result = calendarIcs([entry], { now });
    expect(result).toContain("DTSTART;VALUE=DATE:20280229\r\n");
    expect(result).toContain("DTEND;VALUE=DATE:20280301\r\n");
    expect(result).toContain(`UID:${entry.id}@signalbrief.online\r\n`);
    expect(result).not.toContain("BEGIN:VALARM");
    expect(result).not.toContain("T090000");
  });
  it("encodes user-supplied text without allowing calendar property injection", () => {
    const result = calendarIcs(
      [
        {
          ...entry,
          title: "Title\r\nATTENDEE:attacker@example.org;comma,slash\\",
        },
      ],
      { now },
    );
    expect(result).not.toContain("\r\nATTENDEE:");
    expect(result).toContain(
      "SUMMARY:Title\\nATTENDEE:attacker@example.org\\;comma\\,slash\\\\",
    );
  });
  it("folds Korean UTF-8 lines to at most 75 bytes without splitting characters", () => {
    const result = calendarIcs(
      [{ ...entry, title: "한글 일정 제목 ".repeat(30) }],
      { now },
    );
    for (const line of result.split("\r\n"))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const unfolded = result.replace(/\r\n /g, "");
    expect(unfolded).toContain(`SUMMARY:${"한글 일정 제목 ".repeat(30)}`);
    expect(unfolded).not.toContain("\uFFFD");
  });
  it("adds an explicit calendar-app alarm only when selected", () => {
    expect(calendarIcs([entry], { now, alarmDays: 1 })).toContain(
      "TRIGGER:-P1D\r\n",
    );
    expect(calendarIcs([entry], { now, alarmDays: 0 })).toContain(
      "TRIGGER:PT0S\r\n",
    );
    expect(() => calendarIcs([entry], { alarmDays: -1 })).toThrow();
  });
  it("omits unsafe source URLs", () => {
    expect(
      calendarIcs([{ ...entry, source_url: "javascript:alert(1)" }], { now }),
    ).not.toContain("URL:");
    expect(
      calendarIcs(
        [{ ...entry, source_url: "https://user:secret@example.org" }],
        { now },
      ),
    ).not.toContain("URL:");
  });
});
