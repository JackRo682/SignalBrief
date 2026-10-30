"""Download public SEC originals and freeze disjoint development/held-out manifests.

No model calls. SEC_USER_AGENT is supplied by the operator, never saved in artifacts.
Selection uses metadata only, before any parser outcome is known.
"""

import argparse
import gzip
import hashlib
import json
import os
import time
from datetime import date, datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "evals/financial-v1"
ISSUERS = {"AAPL": "0000320193", "MSFT": "0000789019", "NVDA": "0001045810"}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def rows(columns):
    return [{key: values[i] for key, values in columns.items()} for i in range(len(columns["form"]))]


def choose_pairs(filings, split, count):
    quarters = sorted(
        (r for r in filings if r["form"] == "10-Q" and r.get("reportDate")),
        key=lambda r: r["reportDate"],
        reverse=True,
    )
    candidates = []
    for current in quarters:
        end = date.fromisoformat(current["reportDate"])
        if not (
            "2024-01-01" <= current["reportDate"] <= "2026-09-30"
            if split == "development"
            else "2020-01-01" <= current["reportDate"] <= "2022-12-31"
        ):
            continue
        prior = [r for r in quarters if 350 <= (end - date.fromisoformat(r["reportDate"])).days <= 378]
        if len(prior) == 1:
            candidates.append((prior[0], current))
    if len(candidates) < count:
        raise ValueError(f"insufficient_{split}_pairs:{len(candidates)}")
    return candidates[:count]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--download", action="store_true", help="Explicit free SEC network access")
    args = parser.parse_args()
    if not args.download:
        parser.error("Use --download to prepare public originals")
    if (TARGET / "manifest.json").exists():
        parser.error("Frozen manifest exists; create a new version to change selection")
    ua = os.environ.get("SEC_USER_AGENT", "")
    if "@" not in ua:
        parser.error("SEC_USER_AGENT must contain the operator's contact email")
    sources = {}
    pairs = []
    with httpx.Client(headers={"User-Agent": ua}, timeout=45, follow_redirects=False) as client:

        def fetch(url):
            time.sleep(0.55)
            response = client.get(url)
            response.raise_for_status()
            return response.content

        for ticker, cik in ISSUERS.items():
            metadata_url = f"https://data.sec.gov/submissions/CIK{cik}.json"
            metadata = fetch(metadata_url)
            (TARGET / "metadata").mkdir(parents=True, exist_ok=True)
            (TARGET / "metadata" / f"{ticker}.json.gz").write_bytes(gzip.compress(metadata, mtime=0))
            data = json.loads(metadata)
            filings = rows(data["filings"]["recent"])
            for archive in data["filings"].get("files", []):
                if archive["filingTo"] < "2019-01-01":
                    continue
                blob = fetch("https://data.sec.gov/submissions/" + archive["name"])
                (TARGET / "metadata" / (archive["name"] + ".gz")).write_bytes(gzip.compress(blob, mtime=0))
                filings.extend(rows(json.loads(blob)))
            for split, count in (
                ("development", 4 if ticker == "AAPL" else 3),
                ("held_out", 6 if ticker == "NVDA" else 7),
            ):
                for index, (previous, current) in enumerate(choose_pairs(filings, split, count), 1):
                    refs = []
                    for row in (previous, current):
                        accession = row["accessionNumber"]
                        refs.append(accession)
                        if accession in sources:
                            continue
                        url = (
                            f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
                            f"{accession.replace('-', '')}/{row['primaryDocument']}"
                        )
                        path = TARGET / "originals" / (accession + ".htm.gz")
                        path.parent.mkdir(parents=True, exist_ok=True)
                        # Resume interrupted downloads without requesting the same bytes again.
                        raw = gzip.decompress(path.read_bytes()) if path.exists() else fetch(url)
                        if b"<html" not in raw.lower():
                            raise ValueError("non_html_original")
                        path.write_bytes(gzip.compress(raw, mtime=0))
                        sources[accession] = {
                            "ticker": ticker,
                            "cik": cik,
                            "accession": accession,
                            "url": url,
                            "report_date": row["reportDate"],
                            "filing_date": row["filingDate"],
                            "accepted_at": row.get("acceptanceDateTime"),
                            "form": row["form"],
                            "raw_sha256": digest(raw),
                            "bytes": len(raw),
                            "path": str(path.relative_to(ROOT)).replace("\\", "/"),
                            "retrieved_at": datetime.now(timezone.utc).isoformat(),
                            "verification_status": "original_downloaded_human_review_pending",
                        }
                    pairs.append(
                        {
                            "id": f"{split}-{ticker}-{index:02}",
                            "ticker": ticker,
                            "split": split,
                            "previous": refs[0],
                            "current": refs[1],
                            "comparison": "year_over_year",
                            "period_kind": "quarter",
                            "human_review": {"status": "pending", "reviewer": None, "date": None},
                        }
                    )
                    print(f"prepared {split} {ticker} {index}", flush=True)
    dev = {p[k] for p in pairs if p["split"] == "development" for k in ("previous", "current")}
    held = {p[k] for p in pairs if p["split"] == "held_out" for k in ("previous", "current")}
    assert not dev & held
    manifest = {
        "version": "financial-v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "selection": "Newest 10-Q YoY pairs in fixed date windows, before extraction",
        "development_window": ["2024-01-01", "2026-09-30"],
        "held_out_window": ["2020-01-01", "2022-12-31"],
        "held_out_status": "sealed_not_evaluated",
        "sources": sources,
        "pairs": pairs,
    }
    save(TARGET / "manifest.json", manifest)
    (TARGET / "manifest.sha256").write_text(digest((TARGET / "manifest.json").read_bytes()) + "\n")
    print(json.dumps({"pairs": len(pairs), "originals": len(sources)}))


if __name__ == "__main__":
    main()
