# API contract

`openapi.json` is exported from the actual FastAPI application by `python scripts/export_openapi.py`.
The web application validates responses with Zod in `apps/web/src/lib/contracts.ts`.
Changes to either side must update the other and pass contract/E2E checks. No private provider key belongs here.
