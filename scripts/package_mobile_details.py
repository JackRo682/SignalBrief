"""Export the second ten-screen source set from an exact committed Git revision.

Bundles contain full textual source, API/database implementation, and tests with
repository paths and SHA-256 hashes. No worktree secrets or production rows are read.
"""
import argparse
import hashlib
import re
import subprocess
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
SCREENS = [
    ('01', 'AI_Questions', '01-1000000213.png', ['questions'], ['questions.tsx'], ['mobile-research.test.tsx', 'mobile-flow.test.tsx']),
    ('02', 'Appearance', '02-1000000212.png', ['settings/appearance'], ['appearance.tsx'], ['mobile-appearance.test.tsx']),
    ('03', 'Help_Support', '03-1000000211.png', ['help'], ['help.tsx'], ['mobile-help.test.tsx']),
    ('04', 'Document', '04-1000000210.png', ['documents/[id]'], ['document.tsx'], ['mobile-research.test.tsx']),
    ('05', 'Security', '05-1000000209.png', ['settings/security'], ['security.tsx'], ['mobile-account-security.test.tsx']),
    ('06', 'Account', '06-1000000208.png', ['settings/account'], ['account.tsx'], ['mobile-account-security.test.tsx']),
    ('07', 'Calendar', '07-1000000217.png', ['calendar'], ['calendar.tsx'], ['mobile-notification-calendar.test.tsx']),
    ('08', 'Company_Timeline', '08-1000000216.png', ['timeline', 'companies/[id]/timeline'], ['timeline.tsx'], ['mobile-research.test.tsx', 'mobile-flow.test.tsx']),
    ('09', 'Notification_Settings', '09-1000000215.png', ['settings/notifications'], ['notifications.tsx'], ['mobile-notification-calendar.test.tsx']),
    ('10', 'Alert_Center', '10-1000000214.png', ['alerts'], ['alerts.tsx'], ['mobile-notification-calendar.test.tsx']),
]


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--deployment', required=True)
    parser.add_argument('--ci', required=True, action='append')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    commit = git('rev-parse', '--verify', f'{args.commit}^{{commit}}').decode().strip()
    files = set(git('ls-tree', '-r', '--name-only', commit).decode().splitlines())
    args.output.mkdir(parents=True, exist_ok=True)
    cache = {}

    def read(path):
        if path not in cache:
            cache[path] = git('show', f'{commit}:{path}').decode('utf-8')
        return cache[path]

    def dependency_paths(initial):
        ordered, seen = [], set()

        def visit(path):
            if path in seen:
                return
            if path not in files:
                raise ValueError(f'Required committed source missing: {path}')
            seen.add(path)
            ordered.append(path)
            for target in re.findall(r'(?:from\s*|import\s*(?:\(\s*)?)[\'"]([^\'"]+)[\'"]', read(path)):
                if target.startswith('@/'):
                    base = PurePosixPath('apps/web/src') / target[2:]
                elif target.startswith('.'):
                    base = PurePosixPath(path).parent / target
                else:
                    continue
                # Resolve paths without reading mutable worktree bytes.
                normalized = str((ROOT / str(base)).resolve().relative_to(ROOT))
                candidates = [normalized, *[normalized + suffix for suffix in ('.ts', '.tsx', '.css', '.json')],
                              normalized + '/index.ts', normalized + '/index.tsx']
                for candidate in candidates:
                    if candidate in files and Path(candidate).suffix in ('.ts', '.tsx', '.css', '.json'):
                        visit(candidate)
                        break

        for path in initial:
            visit(path)
        return ordered

    shared_frontend = ['apps/web/src/app/layout.tsx', 'apps/web/src/app/(workspace)/layout.tsx',
                      'apps/web/src/mobile/shell.tsx', 'apps/web/src/workspace/preferences.tsx']
    api = sorted(path for path in files if path.startswith('apps/web/src/app/api/') and path.endswith('.ts'))
    backend = sorted(path for path in files if (
        path.startswith('supabase/') and Path(path).suffix in ('.sql', '.ts', '.py', '.json')
        or path.startswith('apps/api/signalbrief/') and Path(path).suffix in ('.py', '.json', '.txt')
    ))
    tests = ['apps/web/tests/workspace.test.ts', 'apps/web/tests/auth-runtime.test.ts',
             'apps/web/tests/auth-policy.test.ts', 'apps/web/tests/api.test.ts',
             'apps/web/e2e/mobile-details.spec.ts', 'apps/web/e2e/mobile-fixture.ts',
             'apps/web/e2e/mobile-authenticated.spec.ts', 'apps/web/e2e/workspace-pages.spec.ts',
             'tests/workspace/test_workspace_schema.py', 'tests/conftest.py', 'tests/test_api.py',
             'tests/test_hosted_schema.py', 'tests/test_web_route_contracts.py',
             'scripts/verify.py', 'scripts/hosted_baseline.py', 'scripts/export_openapi.py']
    tests += sorted(path for path in files if path.startswith('tests/') and Path(path).suffix in ('.py', '.json', '.js', '.mjs', '.md'))
    configuration = ['apps/web/package.json', 'apps/web/package-lock.json', 'apps/web/tsconfig.json',
                     'apps/web/next.config.ts', 'apps/web/playwright.config.ts', 'apps/web/vitest.config.ts',
                     'apps/web/eslint.config.mjs', 'pyproject.toml',
                     '.github/workflows/ci.yml', '.github/workflows/workspace-schema.yml',
                     'docs/MOBILE_DETAILS_RELEASE_20261006.md', 'docs/MOBILE_BRAND_ASSETS.md',
                     'docs/HOSTED_RELEASE_SCOPE.md', 'docs/US_PROVIDER_RELEASE.md']
    results = []
    for number, title, reference, routes, modules, test_modules in SCREENS:
        primary = [f'apps/web/src/app/(workspace)/{route}/page.tsx' for route in routes]
        primary += [f'apps/web/src/mobile/{module}' for module in modules]
        specific_tests = [f'apps/web/tests/{module}' for module in test_modules]
        frontend = dependency_paths(primary + shared_frontend)
        paths = list(dict.fromkeys(frontend + dependency_paths(api) + backend + specific_tests + tests + configuration))
        header = f'''SIGNALBRIEF — SECOND MOBILE SET — {number} {title.replace('_', ' ')}
REFERENCE PNG: {reference} (864 x 1536)
ROUTES: {', '.join('/' + route for route in routes)}
REPOSITORY: https://github.com/JackRo682/SignalBrief
COMMIT: {commit}
PRODUCTION: https://signalbrief.online
DEPLOYMENT: {args.deployment}
VERIFICATION: {', '.join(args.ci)}

CONTENTS
Full screen and imported shared frontend source appears first. The exact deployed
BFF/Edge APIs, SQL migrations, supporting Python backend, and corresponding unit,
browser and real PostgreSQL replay tests follow. Every file section is labelled
with its actual repository path and SHA-256 of its UTF-8 contents.

USE
Check out the commit above and use the labelled paths. These files are an indexed
source-code export, not a separate unauthenticated demo or independent deployment.
The repository retains its package locks, fonts, raster brand assets and runtime
dependencies. Non-text assets are referenced by their committed paths; no production
data, private key, auth token, private blob or locally injected environment is exported.
Apply only missing reviewed migrations in dependency order. Never replay SQL tests
against production. Run the release commands and browser/database gates described
in docs/MOBILE_DETAILS_RELEASE_20261006.md.

SERVICE AVAILABILITY
Use the current deployment status and the release document's configuration table.
Missing financial data stays unavailable. SEC filings are separate from published
legacy events. FMP display rights, generative AI budget, scheduled ingestion, SMTP,
email/digest delivery, background push and Korea coverage are separate capabilities.
This release does not create subscriptions, purchase licenses, or enable paid usage.

FILE INDEX ({len(paths)} files)
'''
        parts = [header, '\n'.join(paths), '\n']
        for path in paths:
            contents = read(path)
            digest = hashlib.sha256(contents.encode('utf-8')).hexdigest()
            parts.extend([f'\n{"=" * 80}\nFILE: {path}\nSHA256: {digest}\n{"=" * 80}\n', contents,
                          f'\nEND FILE: {path}\n'])
        target = args.output / f'SignalBrief_Detail_{number}_{title}.txt'
        target.write_text(''.join(parts), encoding='utf-8')
        results.append(target)
    archive = args.output / 'SignalBrief_Mobile_Detail_10_Screens.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as package:
        for target in results:
            package.write(target, target.name)
    for target in [*results, archive]:
        print(f'{target.resolve()}\t{target.stat().st_size}')


if __name__ == '__main__':
    main()
