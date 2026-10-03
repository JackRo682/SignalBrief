"""Emit the frozen PostgreSQL baseline; never connect to or mutate a database."""

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def literal(path: Path, name: str):
    """Read literal DDL from an immutable historical migration, not mutable models."""
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Assign):
            if any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
                return ast.literal_eval(node.value)
    raise ValueError(f"Missing frozen {name} in {path.name}")


def baseline() -> str:
    versions = ROOT / "supabase/migrations/versions"
    initial = literal(versions / "001_initial.py", "DDL")["postgresql"]
    security = literal(versions / "002_rls.py", "DDL")
    statements = ["SET search_path = public"] + initial + security + [
        "CREATE TABLE public.alembic_version(version_num VARCHAR(32) PRIMARY KEY)",
        "INSERT INTO public.alembic_version VALUES ('002_rls')",
        "ALTER TABLE public.alembic_version ENABLE ROW LEVEL SECURITY",
        "REVOKE ALL ON public.alembic_version FROM PUBLIC,anon,authenticated",
        "INSERT INTO storage.buckets(id,name,public) VALUES ('signalbrief-raw','signalbrief-raw',false) ON CONFLICT(id) DO NOTHING",
    ]
    return "-- Frozen baseline for a fresh Supabase project only.\n" + "\n".join(
        statement.strip().rstrip(";") + ";" for statement in statements
    ) + "\n"


if __name__ == "__main__":
    print(baseline(), end="")
