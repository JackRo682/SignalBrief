# Independent source replacement on GitHub

This normal history-preserving main commit replaces the tracked tree with the verified independent source. Existing Git history and open PR records are preserved; no old implementation is imported.

Source: Library ZIP version 5, SHA-256 0958f634b5089f862690cbe7bc93b16f6f7bdecf5d7dbad34ce9085b4cfef943. Actual logs remain included.

The user explicitly authorized replacing GitHub main and the existing Vercel automatic deployment. Publication adds a frontend authentication gate: public/production builds reject demo auth/admin; missing API or Supabase configuration exposes a setup-required state and no login controls. Local development demos remain loopback-only. Eight new policy regression cases cover missing/insecure setup, public demo rejection and live/private-development positive cases. No credentials or hosting settings were changed.

The production Render blueprint is an explicit example at docs/render.production.example.yaml; no root blueprint is auto-discovered. The commit message includes the official [skip render] token, with no GitHub CI skip token. No Render deployment or paid resource provisioning is authorized.

No .env, venv, node_modules, build output, private DB/raw storage or real credentials are committed. Fixture keys/test credentials are synthetic and forbidden in production.

Pre-publication baseline: 238 backend tests including disposable PostgreSQL, 86 targeted evidence tests, 19 frontend tests, browser desktop/mobile 3+3, 120 synthetic evaluation cases, npm audit zero. Public-auth changes are checked additionally; exact remote CI/deployment results are reported separately. External configuration and human financial gold validation remain unfinished.
