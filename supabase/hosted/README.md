# Supabase-hosted schema

These migrations target Supabase-managed PostgreSQL with auth and storage already installed. They are separate from local Alembic migrations.

For a new empty project ONLY, generate the baseline using `python scripts/hosted_baseline.py > BASELINE.sql`, review it, and apply it before these SQL files in filename order. The generator uses literal frozen DDL from 001_initial.py and 002_rls.py, not the mutable ORM models. It also adds the private storage bucket and Alembic marker. Never replay the initial CREATE TABLE statements on the existing hosted project.

The existing project already has eight recorded migrations (base plus seven extensions). The last regex reconciliation is recorded remotely as 20261003035521; its local filename 20261003035500 retains the same ordering and SQL. Do not use the Supabase CLI to automatically reconcile these filenames without reviewing remote migration versions.

The first hosted baseline is reproducible from the original immutable migration DDL rather than a byte-identical dump of its applied SQL. RLS and RPC replay are tested in an isolated PostgreSQL service using Auth/Storage namespace stubs, not a second hosted Supabase account. Google OAuth, SMTP and Storage transport require separate live checks.

There is no first-signup admin. Operator membership requires the owner's explicit Auth user UUID in app_private.sb_admin_users. All included CI identities and companies are synthetic disposable fixtures, never production disclosures.

Keep application data backed up before future schema changes. Do not run downgrade, destructive fixture tests or this replay test against production.
