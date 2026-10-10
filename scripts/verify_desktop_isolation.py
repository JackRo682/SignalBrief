"""Check the PC release against the exact mobile source that was already deployed."""

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "docs/desktop-mobile-baseline.json"


def mobile_expression(source: str) -> str:
    match = re.search(r"mobile=(\{.*?\})\s+desktop=", source, re.DOTALL)
    return match.group(1) if match else ""


def selectors(value: str) -> list[str]:
    """Split selector lists without splitting :is() or attribute arguments."""
    result, start, depth, quote, escaped = [], 0, 0, "", False
    for index, char in enumerate(value):
        if escaped:
            escaped = False
        elif char == "\\":
            escaped = True
        elif quote:
            if char == quote:
                quote = ""
        elif char in "\"'":
            quote = char
        elif char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        elif char == "," and depth == 0:
            result.append(value[start:index].strip())
            start = index + 1
    result.append(value[start:].strip())
    return result


def verify() -> dict:
    baseline = json.loads(BASELINE.read_text())
    failures = []
    for path, digest in baseline["files"].items():
        file = ROOT / path
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != digest:
            failures.append(f"Mobile dependency changed: {path}")
    for path, expression in baseline["route_mobile_expressions"].items():
        if mobile_expression((ROOT / path).read_text()) != expression:
            failures.append(f"Mobile route changed: {path}")
    layout = (ROOT / "apps/web/src/app/(workspace)/layout.tsx").read_text()
    branch = baseline["mobile_layout_branch"]
    if branch not in layout or layout.index(branch) > layout.index("if(desktop)"):
        failures.append("The original mobile shell must render before the desktop shell")
    for css in (ROOT / "apps/web/src/desktop").glob("*.css"):
        source = re.sub(r"/\*.*?\*/", "", css.read_text(), flags=re.DOTALL)
        for name in re.findall(r"@keyframes\s+([^\s{]+)", source):
            if not name.startswith("pc-"):
                failures.append(f"Unscoped animation name: {css.name}: {name}")
        for match in re.finditer(r"([^{}]+)\{", source):
            selector = match.group(1).strip()
            if selector.startswith("@"):
                continue
            for part in selectors(selector):
                if ".sb-pc" not in part and not re.fullmatch(r"(?:from|to|[\d.]+%)", part):
                    failures.append(f"Unscoped desktop CSS: {css.name}: {part}")
    return {
        "baseline_commit": baseline["commit"],
        "unchanged_mobile_dependencies": len(baseline["files"]),
        "unchanged_mobile_routes": len(baseline["route_mobile_expressions"]),
        "desktop_css_scoped": not any("CSS" in item or "animation" in item for item in failures),
        "status": "FAIL" if failures else "PASS",
        "failures": failures,
    }


if __name__ == "__main__":
    result = verify()
    print(json.dumps(result, indent=2))
    raise SystemExit(result["status"] != "PASS")
