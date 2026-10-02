# Local foundation (T01)

The web is a development scaffold. API and idle worker expose process health only. No auth, database, ingestion, AI, telemetry or financial data exists. No account or .env file is required.

## Install

Prerequisites: Node 24.19.0, npm 11.6.2, Python 3.12.x (verified 3.12.14) and Git. Official references: [Next installation and linter choices](https://nextjs.org/docs/app/getting-started/installation), [Biome framework rules](https://biomejs.dev/linter/domains/), [FastAPI server](https://fastapi.tiangolo.com/deployment/manually/). Direct dependencies are pinned in manifests; npm lock includes integrity; Python runtime/dev locks include versions and hashes. Biome enables recommended Next/React/test lint rules; Prettier owns formatting.

From the repository root:

```sh
npm ci --ignore-scripts
python -m venv .venv
```

Activate with `.venv\Scripts\Activate.ps1` (PowerShell) or `source .venv/bin/activate` (POSIX). Alternatively invoke `.venv\Scripts\python.exe` / `.venv/bin/python` directly. Do not change execution policy. Then:

```sh
python -m pip install --require-hashes -r requirements-dev.lock
python -m pip check
```

Runtime-only Python installations use requirements.lock. Imports run from the root; no editable/global install is needed. npm must be on the session PATH for nested workspace scripts.

The verified Codex workstation has separate tools outside the repository. Session-local setup:

```powershell
$env:PATH = (Resolve-Path '..\.tools\bin').Path + ';' + $env:PATH
npm.cmd --version
& '..\.tools\python-venv\Scripts\python.exe' -m venv .venv
& '.venv\Scripts\python.exe' -m pip install --require-hashes -r requirements-dev.lock
```

These ../.tools paths are workstation-specific, not normal repository prerequisites. Use npm.cmd if PowerShell blocks npm.ps1; do not weaken security policy. Environments, caches and builds are ignored.

## Run

Three terminals from root, Python environment active:

```sh
npm run dev
python -m uvicorn services.api.main:app --host 127.0.0.1 --port 8000
python -m services.worker.main
```

Web: http://127.0.0.1:3000. API: http://127.0.0.1:8000/health/live. Worker: http://127.0.0.1:8001/health/live. Ctrl+C stops processes. Production web: `npm run build`, then `npm run start --workspace @signalbrief/web`.

Both services return no-store health JSON. Liveness reports process/worker heartbeat. `/health/ready` always returns 503 foundation_only; DB/config/queue verification belongs to later tasks. Servers default to loopback. Future deployments must keep readiness internal/authenticated. Product routes and API docs are absent.

## Environment

.env.example is dummy only. WORKER_HEALTH_PORT is read from the process environment (default 8001, valid 1..65535). Python does not auto-load .env. ENVIRONMENT, APP_ORIGIN and API_INTERNAL_URL are reserved and not consumed. All integration/model/telemetry/DB variables are future examples and not read by T01. PUBLICATION_ENABLED=false documents a safe intended default; no publication code exists. No NEXT_PUBLIC variable exposes server settings.

## Check

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
python -m ruff format --check services scripts tests
python -m ruff check services scripts tests
python -m mypy
python -m pytest
python -m scripts.health_smoke
python scripts/check_secrets.py
python -m pip_audit -r requirements.lock --disable-pip
```

Smoke starts real API/worker subprocesses on ephemeral loopback ports, checks live 200 and ready 503, requests graceful server/lifespan shutdown and verifies closed listeners. Unit tests cover stale/stopped heartbeat, invalid port, unknown routes and rejected POST health. No outside network is used by smoke.

Secret patterns cover tracked/unignored source and generated .next/static assets, without printing matches, plus env ignore rules. This is not an exhaustive security certification. Audits require registry/advisory network access, no application credentials. CI matches web checks and tests Python 3.12.15 on Linux and 3.12.10 on Windows, with fail-fast disabled. The official Actions distribution manifest lacks Windows installers for security-only 3.12.14; 3.12.10 is the available Windows compatibility-test binary, not a production patch recommendation. Local verification used 3.12.14. Use a current security patch for the eventual server deployment. See [official release policy](https://www.python.org/downloads/release/python-31214/) and [Actions distribution manifest](https://raw.githubusercontent.com/actions/python-versions/main/versions-manifest.json). Actions are SHA-pinned current Node24 releases, contents-read-only, with no persisted checkout credentials. Remote results require separate verification after integration.

## Locks and later gates

Update pinned manifests only with review and regenerate npm lock. Python locks:

```sh
python -m piptools compile --extra dev --generate-hashes --allow-unsafe --strip-extras --index-url https://pypi.org/simple --output-file requirements-dev.lock pyproject.toml
python -m piptools compile --generate-hashes --strip-extras --index-url https://pypi.org/simple --output-file requirements.lock pyproject.toml
```

Verify clean install and affected checks. No migrations exist. T02 owns authoritative domain/stage schemas and generated types; T03 SQL; T07 queue. Product/browser/accessibility journeys, live auth/providers, source rights, gold evaluation and staging/deployment are later gates. Full AC-20 release acceptance is not claimed. Rollback reverts only scaffold changes and retains specs; no persistent data changes exist.

## T02 contract checks

After the locked installs, run `python -m scripts.export_contracts --check`, `npm run contracts:check` and `npm run contracts:typecheck` in addition to the baseline commands. Update artifacts with `python -m scripts.export_contracts` then `npm run contracts:generate`; never hand-edit generated files. Python pytest includes synthetic domain/API and all thirteen stage compatibility cases. JSON Schema/TypeScript shape checks require Python runtime relational validation at use boundaries. See [contracts boundary](../packages/contracts/README.md). No live route, DB, model or source validation is implied.
