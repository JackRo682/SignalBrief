"""Export the application contract; no server launch, provider fetch, or secret printing."""

import importlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

if __name__ == "__main__":
    create_app = importlib.import_module("signalbrief.app").create_app
    Settings = importlib.import_module("signalbrief.settings").Settings
    settings = Settings(
        _env_file=None,
        environment="test",
        demo_mode=True,
        demo_seed_on_start=False,
        database_url="sqlite:///:memory:",
    )
    path = ROOT / "packages/shared/openapi.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    data = create_app(settings).openapi()
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"file": str(path.relative_to(ROOT)), "paths": len(data["paths"])}))
