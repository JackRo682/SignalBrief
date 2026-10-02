"""A deterministic parser for synthetic fixtures ONLY. Never used on DART or SEC documents."""

import re

from .schemas import ExtractedFact, ExtractionBatch, ScheduledDate

LABELS = {
    "Revenue": "revenue",
    "Operating income": "operating_income",
    "CAPEX": "capex",
    "Dividend": "dividend",
}
PATTERN = re.compile(
    r"^(Revenue|Operating income|CAPEX|Dividend): ([()0-9,.+-]+) (USD million|USD billion|KRW 억원|USD); period=(FY[0-9]{4}); scope=(consolidated|separate); basis=(guidance|actual)\.$",
    re.M,
)


class DemoExtractor:
    def extract(self, chunks):
        facts, dates, seen = [], [], set()
        for chunk in chunks:
            for match in PATTERN.finditer(chunk.text):
                if match.group() in seen:
                    continue
                seen.add(match.group())
                facts.append(
                    ExtractedFact(
                        field=LABELS[match[1]],
                        chunk_id=chunk.id,
                        quote=match.group(),
                        value_raw=match[2],
                        unit=match[3],
                        period=match[4],
                        scope=match[5],
                        basis=match[6],
                    )
                )
            for match in re.finditer(r"^(Risk|Management): .+$", chunk.text, re.M):
                if match.group() not in seen:
                    facts.append(
                        ExtractedFact(
                            field="risk_change" if match[1] == "Risk" else "management_change",
                            chunk_id=chunk.id,
                            quote=match.group(),
                            value_raw=None,
                            unit=None,
                            period=None,
                            scope="unknown",
                            basis="unknown",
                        )
                    )
                    seen.add(match.group())
            for match in re.finditer(r"Next update date: (\d{4}-\d{2}-\d{2})", chunk.text):
                dates.append(
                    ScheduledDate(
                        title="다음 공시 업데이트 · 합성 데모",
                        date_iso=match[1],
                        chunk_id=chunk.id,
                        quote=match.group(),
                    )
                )
        kind = "guidance" if any(f.basis == "guidance" for f in facts) else "earnings"
        if facts and all(f.field == "capex" for f in facts):
            kind = "capex"
        if facts and all(f.field == "dividend" for f in facts):
            kind = "dividend"
        if facts and all(f.field == "risk_change" for f in facts):
            kind = "risk"
        if facts and all(f.field == "management_change" for f in facts):
            kind = "management"
        return ExtractionBatch(event_type=kind if facts else "other", facts=facts, scheduled_dates=dates)
