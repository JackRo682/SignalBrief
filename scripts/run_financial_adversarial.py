"""Execute the explicit 40-case regression matrix and preserve per-case outcomes."""

import json
import os
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    cases = json.loads((ROOT / "evals/financial-v1/adversarial.json").read_text())
    target = ROOT / "verification/financial-20261010"
    target.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable,
        "-m",
        "pytest",
        "-q",
        "--basetemp=var/pytest-adversarial",
        "--junitxml=" + str(target / "adversarial.xml"),
        *[c["nodeid"] for c in cases],
    ]
    result = subprocess.run(
        command,
        cwd=ROOT,
        env={**os.environ, "PYTHONPATH": str(ROOT / "apps/api")},
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    (target / "adversarial.log").write_text(
        (result.stdout + result.stderr).replace(str(ROOT), "<repo>"), encoding="utf-8"
    )
    xml = ET.parse(target / "adversarial.xml")
    outcomes = {
        t.attrib["name"]: "FAIL"
        if t.find("failure") is not None or t.find("error") is not None
        else "BLOCKED"
        if t.find("skipped") is not None
        else "PASS"
        for t in xml.iter("testcase")
    }
    records = [{**case, "status": outcomes.get(case["nodeid"].split("::")[-1], "BLOCKED")} for case in cases]
    (target / "adversarial.json").write_text(
        json.dumps(
            {
                "kind": "controlled_regression_not_real_llm_evaluation",
                "cases": len(cases),
                "pass": sum(r["status"] == "PASS" for r in records),
                "fail": sum(r["status"] == "FAIL" for r in records),
                "blocked": sum(r["status"] == "BLOCKED" for r in records),
                "records": records,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"{sum(r['status'] == 'PASS' for r in records)}/{len(cases)} PASS")
    return result.returncode or int(any(r["status"] != "PASS" for r in records))


if __name__ == "__main__":
    raise SystemExit(main())
