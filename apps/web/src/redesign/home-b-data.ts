import type { Resource } from "../workspace/contracts";
import type { CalendarEntry } from "./calendar-utils";

export type HomeCalendarCategory =
  | "earnings"
  | "investor"
  | "corporate"
  | "other";
export type HomeDocumentCategory = "filing" | "release" | "presentation";

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_‐‑‒–—-]+/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Categories describe the source title only; a webcast alone implies no event type. */
export function calendarCategory(
  item: Pick<CalendarEntry, "title">,
): HomeCalendarCategory {
  const title = normalized(item.title);
  if (
    /\bearnings\b|\b(?:financial|quarterly|annual|full year|year end|(?:first|second|third|fourth) quarter|q[1-4])\s+(?:financial\s+)?results\b|(?:경영\s*)?실적\s*(?:발표|설명|공시|컨퍼런스)/.test(
      title,
    )
  ) {
    return "earnings";
  }
  if (
    /\binvestors?'?\s+(?:day|conference|meeting|event|presentation|update|briefing)\b|\bcapital markets? day\b|\bir\s+(?:day|conference|event|meeting)\b|투자자\s*(?:의\s*날|행사|설명회|회의)|기업\s*설명회/.test(
      title,
    )
  ) {
    return "investor";
  }
  if (
    /\b(?:share|stock)holders?'?\s+meeting\b|\b(?:annual|extraordinary)\s+general\s+meeting\b|\b(?:agm|egm)\b|\bcorporate\s+(?:activities|activity|event|action)\b|\b(?:stock|share)\s+split\b|주주\s*(?:총회|미팅)|기업\s*(?:활동|행사)|주식\s*분할/.test(
      title,
    )
  ) {
    return "corporate";
  }
  return "other";
}

const releasePattern =
  /\b(?:press|news|media|earnings)\s+releases?\b|보도\s*자료/;
const presentationPattern =
  /\bpresentations?\b|\bslide\s+decks?\b|\bslides\b|발표\s*자료|프레젠테이션|설명회\s*자료/;
const filingCategoryPattern =
  /^(?:filings?|공시(?:\s*자료)?|sec|dart|(?:form\s+)?(?:10\s*[kq]|8\s*k|20\s*f|6\s*k|40\s*f|s\s*[1-4]|def\s*14a)(?:\s*\/\s*a)?)$/;

/** Explicit source categories win over title inference; uncategorized records stay filings. */
export function documentCategory(
  item: Pick<Resource, "title" | "category">,
): HomeDocumentCategory {
  const category = normalized(item.category);
  if (filingCategoryPattern.test(category)) return "filing";
  if (releasePattern.test(category)) return "release";
  if (presentationPattern.test(category)) return "presentation";

  const title = normalized(item.title);
  if (
    /\bform\s+(?:10\s*[kq]|8\s*k|20\s*f|6\s*k|40\s*f|s\s*[1-4]|def\s*14a)\b/.test(
      title,
    )
  )
    return "filing";
  // A press release announcing a presentation remains a press release.
  if (releasePattern.test(title)) return "release";
  if (presentationPattern.test(title)) return "presentation";
  return "filing";
}

export function documentLabel(
  item: Pick<Resource, "title" | "category">,
): string {
  const labels: Record<HomeDocumentCategory, string> = {
    filing: "공시",
    release: "발표자료",
    presentation: "프레젠테이션",
  };
  return labels[documentCategory(item)];
}
