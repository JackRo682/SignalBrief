"""Conservative credential pattern and env hygiene check; not a security certification."""

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = [
    re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(rb"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})"),
    re.compile(rb"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(rb"\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b"),
    re.compile(rb"\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"),
]


def main() -> None:
    listing = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT
    )
    paths = [ROOT / name.decode("utf-8") for name in listing.split(b"\0") if name]
    assets = ROOT / "apps/web/.next/static"
    if assets.exists():
        paths.extend(path for path in assets.rglob("*") if path.is_file())
    failures: list[str] = []
    for path in paths:
        if path.name.startswith(".env") and path.name != ".env.example":
            failures.append(f"unexpected env file: {path.relative_to(ROOT)}")
        if any(pattern.search(path.read_bytes()) for pattern in PATTERNS):
            # Never print matched credentials.
            failures.append(f"credential pattern: {path.relative_to(ROOT)}")
    for name in (".env", "apps/web/.env.local"):
        result = subprocess.run(["git", "check-ignore", "--quiet", name], cwd=ROOT)
        if result.returncode != 0:
            failures.append(f"local env ignore rule missing: {name}")
    if failures:
        raise SystemExit("\n".join(failures))
    print(f"Secret patterns and env hygiene passed ({len(paths)} source/static files)")


if __name__ == "__main__":
    main()
