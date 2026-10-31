"""Guard the authorized signed-in MVP boundary; historical desktop checks remain intact.

Behavior is verified by the desktop/mobile research-workspace Playwright suite.
This separate guard detects edits outside the request, deleted retained features,
accidental release-flag changes, and CSS escaping its workspace boundary.
"""

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = "docs/signed-in-workspace-boundary.json"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def selected_files(root: Path, paths: list[str]) -> set[str]:
    files = set()
    for name in paths:
        path = root / name
        if path.is_file():
            files.add(name)
        elif path.is_dir():
            files.update(str(item.relative_to(root)) for item in path.rglob("*") if item.is_file())
    return files


def selector_parts(value: str) -> list[str]:
    parts, start, depth, quote, escaped = [], 0, 0, "", False
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
            parts.append(value[start:index].strip())
            start = index + 1
    parts.append(value[start:].strip())
    return parts


def positively_scoped(selector: str, scope: str) -> bool:
    """Require a positive scope class on the subject or one of its ancestors.

    Classes inside attributes, :not(), :has(), or selector-list pseudo-classes
    do not establish that requirement. A direct sibling of a scope class also
    lies outside its boundary. Unrecognized forms fail closed.
    """
    code, brackets, parentheses, quote, escaped = [], 0, 0, "", False
    for char in selector:
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if quote:
            if char == quote:
                quote = ""
            continue
        if char in "\"'":
            quote = char
        elif char == "[":
            brackets += 1
        elif char == "]":
            brackets -= 1
        elif not brackets and char == "(":
            parentheses += 1
        elif not brackets and char == ")":
            parentheses -= 1
        elif not brackets and not parentheses:
            code.append(char)
    if brackets or parentheses or quote or escaped:
        return False
    visible = "".join(code)
    for match in re.finditer(scope, visible):
        if match.end() < len(visible) and re.match(r"[\w-]", visible[match.end()]):
            continue
        tail = visible[match.end():]
        relation = re.search(r"\s+|[>+~|]", tail)
        if relation is None or relation.group() == ">":
            return True
        if relation.group().isspace():
            following = tail[relation.end():].lstrip()
            if not following or following[0] not in "+~|":
                return True
    return False


def css_failures(root: Path) -> list[str]:
    failures = []
    styles = [(path, r"\.sb-pc\b", "pc-") for path in (root / "apps/web/src/desktop").glob("*.css")]
    for name, scope in [
        ("components/research-workspace.css", r"\.rw-[\w-]+"),
        ("workspace/monitoring.css", r"\.(?:sb-monitor[\w-]*|sb-more[\w-]*|sb-personal-calendar|m-saved-tabs|pc-workspace-page)\b"),
        # The digest adjusts its two existing customer-notification parent rows.
        ("workspace/daily-digest.css", r"\.(?:sb-digest-settings|ws-notification-row|m-notification-settings)\b"),
    ]:
        styles.append((root / "apps/web/src" / name, scope, "sb-"))
    for path, scope, animation_prefix in styles:
        if not path.is_file():
            failures.append(f"Missing scoped stylesheet: {path.relative_to(root)}")
            continue
        source = re.sub(r"/\*.*?\*/", "", path.read_text(), flags=re.DOTALL)
        for name in re.findall(r"@keyframes\s+([^\s{]+)", source):
            if not name.startswith(animation_prefix):
                failures.append(f"Unscoped animation: {path.name}: {name}")
        for match in re.finditer(r"([^{}]+)\{", source):
            selector = match.group(1).strip()
            if selector.startswith("@"):
                continue
            for part in selector_parts(selector):
                if not positively_scoped(part, scope) and not re.fullmatch(r"(?:from|to|[\d.]+%)", part):
                    failures.append(f"Unscoped workspace CSS: {path.name}: {part}")
    return failures


def verify(root: Path = ROOT) -> dict:
    manifest = json.loads((root / MANIFEST).read_text())
    failures = []
    protected = manifest["protected_files"]
    actual = selected_files(root, manifest["protected_paths"])
    for name in sorted(actual - protected.keys()):
        failures.append(f"Unreviewed public/admin/auth source added: {name}")
    for name, expected in protected.items():
        path = root / name
        if not path.is_file() or digest(path) != expected:
            failures.append(f"Protected public/admin/auth source changed: {name}")
    for name, expected in manifest["retained_files"].items():
        path = root / name
        if not path.is_file() or digest(path) != expected:
            failures.append(f"Retained feature implementation changed or removed: {name}")

    flags = (root / "apps/web/src/lib/workspace-features.ts").read_text()
    match = re.search(r"Object\.freeze\(\{(.*?)\}\)", flags, re.DOTALL)
    body = match.group(1) if match else ""
    for feature in manifest["disabled_features"]:
        values = re.findall(rf"\b{re.escape(feature)}\s*:\s*(true|false)\b", body)
        if values != ["false"]:
            failures.append(f"Unverified customer feature enabled: {feature}")
    for name, feature in manifest["feature_entry_points"].items():
        source = (root / name).read_text()
        if f"workspaceFeatures.{feature}" not in source:
            failures.append(f"Missing customer feature gate: {name}: {feature}")

    layout = (root / "apps/web/src/app/(workspace)/layout.tsx").read_text()
    positions = [layout.find(f"return <{shell}>") for shell in ["ResearchShell", "MobileShell", "DesktopShell"]]
    if min(positions) < 0 or positions != sorted(positions):
        failures.append("Admin shell and mobile shell must precede desktop workspace routing")
    if layout.count("disabledWorkspaceRoute(path)?<WorkspaceUnavailable/>") != 2:
        failures.append("Disabled workspace routes must be blocked on both responsive shells")
    research = (root / "apps/web/src/desktop/research.tsx").read_text()
    if "export function LegacyDesktopCompany" not in research:
        failures.append("Retained desktop company implementation was removed")
    failures.extend(css_failures(root))
    return {
        "scope": "signed-in customer desktop and mobile MVP",
        "protected_baseline_commit": manifest["baseline_commit"],
        "protected_public_admin_auth_files": len(protected),
        "retained_feature_files": len(manifest["retained_files"]),
        "status": "FAIL" if failures else "PASS",
        "failures": failures,
    }


if __name__ == "__main__":
    result = verify()
    print(json.dumps(result, indent=2))
    raise SystemExit(result["status"] != "PASS")
