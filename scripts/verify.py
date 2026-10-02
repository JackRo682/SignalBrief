"""Run actual checks; BLOCKED is not PASS. --full is a release gate and returns nonzero on missing tooling."""

import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true")
    args = parser.parse_args()
    target = ROOT / "verification"
    target.mkdir(exist_ok=True)
    environment = {**os.environ, "PYTHONPATH": str(ROOT / "apps/api")}
    checks = [
        (
            "python_compile",
            [sys.executable, "-m", "compileall", "-q", "apps/api", "tests", "scripts"],
            ROOT,
            True,
        ),
        (
            "backend_tests",
            [sys.executable, "-m", "pytest", "-q", "--junitxml=" + str(target / "pytest.xml")],
            ROOT,
            True,
        ),
        ("openapi_export", [sys.executable, "scripts/export_openapi.py"], ROOT, True),
    ]
    if args.full:
        npm = shutil.which("npm.cmd" if os.name == "nt" else "npm") or "npm"
        checks += [
            (
                "backend_lint",
                [sys.executable, "-m", "ruff", "check", "apps/api", "tests", "scripts"],
                ROOT,
                importlib.util.find_spec("ruff") is not None,
            )
        ]
        for name, command in [
            ("frontend_lint", "lint"),
            ("frontend_typecheck", "typecheck"),
            ("frontend_unit_tests", "test"),
            ("frontend_build", "build"),
        ]:
            checks.append(
                (
                    name,
                    [npm, "run", command],
                    ROOT / "apps/web",
                    (ROOT / "apps/web/node_modules/next").exists(),
                )
            )
    results = []
    for name, command, cwd, available in checks:
        if not available:
            results.append(
                {
                    "check": name,
                    "status": "BLOCKED",
                    "reason": "Required local dependencies are not installed",
                }
            )
            continue
        result = subprocess.run(
            command,
            cwd=cwd,
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=600,
            shell=os.name == "nt" and name.startswith("frontend_"),
        )
        (target / (name + ".log")).write_text(result.stdout + result.stderr, encoding="utf-8")
        results.append(
            {
                "check": name,
                "status": "PASS" if result.returncode == 0 else "FAIL",
                "returncode": result.returncode,
                "command": command,
                "log": "verification/" + name + ".log",
            }
        )
    report = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "full_release_suite": args.full,
        "results": results,
        "not_in_this_script": [
            "Real provider credentials",
            "Google OAuth redirects",
            "Hosted deployment",
            "Human-labeled financial Gold Dataset",
            "Browser E2E (run Playwright separately)",
        ],
    }
    (target / "checks.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return int(any(x["status"] != "PASS" for x in results))


if __name__ == "__main__":
    raise SystemExit(main())
