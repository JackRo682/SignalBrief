import json
import shutil
from pathlib import Path

import pytest

from scripts.verify_workspace_scope import MANIFEST, ROOT, positively_scoped, verify


@pytest.fixture
def scope_copy(tmp_path):
    manifest = json.loads((ROOT / MANIFEST).read_text())
    names = set(manifest["protected_files"]) | set(manifest["retained_files"])
    names.update(manifest["feature_entry_points"])
    names.update([MANIFEST, "apps/web/src/lib/workspace-features.ts", "apps/web/src/app/(workspace)/layout.tsx", "apps/web/src/desktop/research.tsx"])
    names.update(str(path.relative_to(ROOT)) for path in (ROOT / "apps/web/src/desktop").glob("*.css"))
    names.update(f"apps/web/src/{name}" for name in ["components/research-workspace.css", "workspace/monitoring.css", "workspace/daily-digest.css"])
    for name in names:
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)
    return tmp_path


@pytest.mark.parametrize(("name", "replacement", "failure"), [
    ("apps/web/src/components/auth.tsx", "// unauthorized auth edit", "Protected public/admin/auth source changed"),
    ("apps/web/src/mobile/today-legacy.tsx", None, "Retained feature implementation changed or removed"),
    ("apps/web/src/lib/workspace-features.ts", ("marketData: false", "marketData: true"), "Unverified customer feature enabled: marketData"),
    ("apps/web/src/desktop/escaped.css", "body{color:red}", "Unscoped workspace CSS"),
    ("apps/web/src/app/(workspace)/layout.tsx", ("disabledWorkspaceRoute(path)?<WorkspaceUnavailable/>", "false?<WorkspaceUnavailable/>"), "Disabled workspace routes must be blocked"),
])
def test_workspace_guard_rejects_boundary_regressions(scope_copy: Path, name, replacement, failure):
    path = scope_copy / name
    if replacement is None:
        path.unlink()
    elif isinstance(replacement, tuple):
        source = path.read_text()
        assert replacement[0] in source
        path.write_text(source.replace(*replacement, 1))
    else:
        path.write_text(replacement)
    result = verify(scope_copy)
    assert result["status"] == "FAIL"
    assert any(failure in item for item in result["failures"])


def test_workspace_guard_rejects_new_unreviewed_admin_source(scope_copy):
    (scope_copy / "apps/web/src/research/unreviewed.ts").write_text("export const changed=true;")
    result = verify(scope_copy)
    assert any("Unreviewed public/admin/auth source added" in item for item in result["failures"])


@pytest.mark.parametrize("selector", [
    ":not(.sb-pc)", ":is(.sb-pc,body)", '[data-value=".sb-pc"]',
    ".sb-pc + body", ".sb-pc:not(.empty)~.outside", ".outside:has(.sb-pc)", ".sb-pc-outside",
])
def test_css_scope_must_be_positive_and_cannot_target_a_scope_sibling(selector):
    assert not positively_scoped(selector, r"\.sb-pc\b")


@pytest.mark.parametrize("selector", [
    ".sb-pc", ".sb-pc .card", ".sb-pc>.card+.other",
    'html[data-theme="dark"] .sb-pc .card:not(.empty)',
])
def test_css_scope_accepts_positive_subjects_and_ancestors(selector):
    assert positively_scoped(selector, r"\.sb-pc\b")
