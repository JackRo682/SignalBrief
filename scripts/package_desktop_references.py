"""Export the ten PC reference screens from an explicit committed Git revision.

Read-only source export: every included file comes from that commit, never mutable
worktree contents, credentials, private blobs, uploaded images or production rows.
"""

import argparse
import hashlib
import posixpath
import re
import subprocess
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
SCREENS = [
    ('01', 'Dashboard', 'ChatGPT Image Oct 7, 2026, 09_44_53 AM-1(1).png', ['today'], ['today.tsx'], ['desktop-today.test.tsx']),
    ('02', 'Explore', 'ChatGPT Image Oct 7, 2026, 09_44_56 AM-2(1).png', ['explore'], ['search.tsx'], ['desktop-discovery.test.tsx']),
    ('03', 'Search_Results', 'ChatGPT Image Oct 7, 2026, 09_44_58 AM-3(1).png', ['search?q=엔비디아'], ['search.tsx'], ['desktop-discovery.test.tsx']),
    ('04', 'Company_Overview', 'ChatGPT Image Oct 7, 2026, 09_44_59 AM-4(1).png', ['companies/[id]'], ['research.tsx'], ['desktop-research.test.tsx']),
    ('05', 'Company_Timeline', 'ChatGPT Image Oct 7, 2026, 09_45_01 AM-5(1).png', ['companies/[id]/timeline', 'timeline'], ['research.tsx'], ['desktop-research.test.tsx']),
    ('06', 'Event_Detail', 'ChatGPT Image Oct 7, 2026, 09_45_02 AM-6(1).png', ['events/[id]'], ['research.tsx'], ['desktop-research.test.tsx']),
    ('07', 'Evidence_Sources', 'ChatGPT Image Oct 7, 2026, 09_45_03 AM-7(1).png', ['events/[id]?panel=evidence'], ['research.tsx'], ['desktop-research.test.tsx']),
    ('08', 'AI_Questions', 'ChatGPT Image Oct 7, 2026, 09_45_04 AM-8(1).png', ['questions?event=[event-id]'], ['questions.tsx'], ['desktop-questions.test.tsx']),
    ('09', 'Document_Detail', 'ChatGPT Image Oct 7, 2026, 09_45_06 AM-9(1).png', ['documents/[id]?kind=document'], ['research.tsx'], ['desktop-research.test.tsx']),
    ('10', 'Watchlist', 'ChatGPT Image Oct 7, 2026, 09_45_07 AM-10(1).png', ['watchlist'], ['watchlist.tsx'], ['desktop-discovery.test.tsx']),
]
FRONTEND_SUFFIXES = ('.ts', '.tsx', '.css', '.json', '.js', '.mjs')


def validate_screens():
    """The image order and exported names must be unique and complete."""
    if [screen[0] for screen in SCREENS] != [f'{number:02d}' for number in range(1, 11)]:
        raise ValueError('PC references must contain exactly 01 through 10 in order')
    for position, label in [(1, 'export titles'), (2, 'reference PNG filenames')]:
        if len({screen[position] for screen in SCREENS}) != 10:
            raise ValueError(f'PC {label} must be unique')
    if len({tuple(screen[3]) for screen in SCREENS}) != 10:
        raise ValueError('Each PC reference needs a distinct route/context mapping')


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def main():
    validate_screens()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--deployment', required=True)
    parser.add_argument('--ci', required=True, action='append')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    commit = git('rev-parse', '--verify', '--end-of-options', f'{args.commit}^{{commit}}').decode().strip()
    files = set(git('ls-tree', '-r', '--name-only', commit).decode().splitlines())
    cache = {}

    def read(path):
        if path not in files:
            raise ValueError(f'Required committed source missing: {path}')
        if path not in cache:
            cache[path] = git('show', f'{commit}:{path}').decode('utf-8')
        return cache[path]

    def dependency_paths(initial):
        ordered, seen = [], set()

        def visit(path):
            if path in seen:
                return
            contents = read(path)
            seen.add(path)
            ordered.append(path)
            for target in re.findall(r'(?:from\s*|import\s*(?:\(\s*)?)[\'"]([^\'"]+)[\'"]', contents):
                if target.startswith('@/'):
                    base = PurePosixPath('apps/web/src') / target[2:]
                elif target.startswith('.'):
                    base = PurePosixPath(path).parent / target
                else:
                    continue
                # Normalize repository paths without resolving worktree symlinks.
                normalized = posixpath.normpath(str(base))
                if normalized.startswith('../') or normalized.startswith('/'):
                    raise ValueError(f'Import leaves the committed repository: {path}: {target}')
                candidates = [normalized, *[normalized + suffix for suffix in FRONTEND_SUFFIXES],
                              normalized + '/index.ts', normalized + '/index.tsx']
                for candidate in candidates:
                    if candidate in files and PurePosixPath(candidate).suffix in FRONTEND_SUFFIXES:
                        visit(candidate)
                        break

        for path in initial:
            visit(path)
        return ordered

    shared_frontend = ['apps/web/src/app/layout.tsx', 'apps/web/src/app/(workspace)/layout.tsx',
                       'apps/web/src/desktop/shell.tsx', 'apps/web/src/desktop/ui.tsx',
                       'apps/web/src/desktop/data.ts', 'apps/web/src/workspace/preferences.tsx']
    api = sorted(path for path in files if path.startswith('apps/web/src/app/api/') and path.endswith('.ts'))
    backend = sorted(path for path in files if (
        path.startswith('supabase/') and PurePosixPath(path).suffix in ('.sql', '.ts', '.py', '.json', '.toml', '.mako')
        or path.startswith('apps/api/signalbrief/') and PurePosixPath(path).suffix in ('.py', '.json', '.txt')
        or path.startswith('alembic/') and PurePosixPath(path).suffix in ('.py', '.mako')
    ))
    tests = ['apps/web/tests/workspace.test.ts', 'apps/web/tests/auth-runtime.test.ts',
             'apps/web/tests/auth-policy.test.ts', 'apps/web/tests/api.test.ts',
             'apps/web/tests/desktop-data.test.tsx',
             'apps/web/e2e/desktop-references.spec.ts', 'apps/web/e2e/desktop-fixture.ts',
             'apps/web/e2e/mobile-fixture.ts', 'apps/web/e2e/mobile-authenticated.spec.ts',
             'apps/web/e2e/mobile-details.spec.ts', 'apps/web/e2e/workspace-pages.spec.ts',
             'apps/web/e2e/performance.spec.ts', 'apps/web/e2e/auth-navigation.spec.ts',
             'scripts/verify.py', 'scripts/verify_desktop_isolation.py',
             'scripts/package_desktop_references.py', 'scripts/hosted_baseline.py',
             'scripts/export_openapi.py']
    tests += sorted(path for path in files if path.startswith('tests/') and PurePosixPath(path).suffix in ('.py', '.json', '.js', '.mjs', '.md'))
    configuration = ['apps/web/package.json', 'apps/web/package-lock.json', 'apps/web/tsconfig.json',
                     'apps/web/next.config.ts', 'apps/web/playwright.config.ts', 'apps/web/vitest.config.ts',
                     'apps/web/eslint.config.mjs', 'pyproject.toml', 'alembic.ini',
                     '.github/workflows/ci.yml', '.github/workflows/workspace-schema.yml',
                     'docs/desktop-mobile-baseline.json', 'docs/DESKTOP_REFERENCES_RELEASE_20261007.md',
                     'docs/MOBILE_DETAILS_RELEASE_20261006.md', 'docs/MOBILE_BRAND_ASSETS.md',
                     'docs/HOSTED_RELEASE_SCOPE.md', 'docs/US_PROVIDER_RELEASE.md']
    configuration += [path for path in ['Dockerfile', 'apps/web/Dockerfile', 'docker-compose.yml', 'docs/render.production.example.yaml', 'uv.lock'] if path in files]
    results = []
    # Assemble everything before writing. A missing release doc or source fails
    # without leaving an apparently complete export for an unreleased revision.
    exports = []
    for number, title, reference, routes, modules, test_modules in SCREENS:
        primary = [f'apps/web/src/app/(workspace)/{route.split("?", 1)[0]}/page.tsx' for route in routes]
        primary += [f'apps/web/src/desktop/{module}' for module in modules]
        specific_tests = [f'apps/web/tests/{module}' for module in test_modules]
        frontend = dependency_paths(primary + shared_frontend)
        paths = list(dict.fromkeys(frontend + dependency_paths(api) + backend
                                  + dependency_paths(specific_tests + tests) + configuration))
        header = f'''SIGNALBRIEF — PC REFERENCES — {number} {title.replace('_', ' ')}
REFERENCE PNG: {reference} (1448 x 1086)
ROUTES: {', '.join('/' + route for route in routes)}
REPOSITORY: https://github.com/JackRo682/SignalBrief
COMMIT: {commit}
PRODUCTION: https://signalbrief.online
DEPLOYMENT: {args.deployment}
VERIFICATION: {', '.join(args.ci)}

CONTENTS
Full screen and imported shared frontend source appears first. The committed
BFF/Edge APIs, SQL migrations, supporting Python backend, and corresponding unit,
browser and real PostgreSQL replay tests follow. Every file section identifies its
repository path and the SHA-256 of its complete UTF-8 contents.

PC / MOBILE BOUNDARY
These ten references apply to the desktop branch, verified at 1448 x 1086 and
1280 x 900. The existing mobile screens, behavior and shared dependencies remain
unchanged; their committed source hashes and route expressions are recorded in
docs/desktop-mobile-baseline.json and checked by scripts/verify_desktop_isolation.py.
The existing mobile suites and the new 432 / 390 route-isolation captures verify
the mobile branch. Imported mobile source may appear as a shared dependency; its
inclusion in this indexed export does not represent a mobile redesign.

USE
Check out the commit above and use the labelled paths. This is a source-code export,
not an independent application or an unauthenticated demo. Package locks, fonts,
raster brand assets and runtime dependencies remain in the repository. Non-text
assets are referenced by their committed paths; image/font bytes, production data,
private keys, auth tokens, private blobs and local environment files are excluded.
Apply only missing reviewed migrations in dependency order. Never replay SQL tests
against production. Follow docs/DESKTOP_REFERENCES_RELEASE_20261007.md and the exact
deployment/check records above; this package does not itself verify deployment.

SERVICE AVAILABILITY
Missing financial data stays unavailable. Question answers and citations use the
existing server contract; this release adds no source upload or answer-rating API.
SEC filings are separate from published events. Licensed market data, generative AI
budget, scheduled ingestion, SMTP, email/digest delivery, background push and Korea
coverage remain separate capabilities. The export does not purchase licenses,
create subscriptions, fabricate service health or enable paid usage.

FILE INDEX ({len(paths)} files)
'''
        parts = [header, '\n'.join(paths), '\n']
        for path in paths:
            contents = read(path)
            digest = hashlib.sha256(contents.encode('utf-8')).hexdigest()
            parts.extend([f'\n{"=" * 80}\nFILE: {path}\nSHA256: {digest}\n{"=" * 80}\n', contents,
                          f'\nEND FILE: {path}\n'])
        exports.append((f'SignalBrief_PC_{number}_{title}.txt', ''.join(parts)))
    args.output.mkdir(parents=True, exist_ok=True)
    for name, contents in exports:
        target = args.output / name
        target.write_text(contents, encoding='utf-8')
        results.append(target)
    archive = args.output / 'SignalBrief_PC_10_Screens.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as package:
        for target in results:
            package.write(target, target.name)
    for target in [*results, archive]:
        print(f'{target.resolve()}\t{target.stat().st_size}')


if __name__ == '__main__':
    main()
