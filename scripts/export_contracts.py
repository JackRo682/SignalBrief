"""Deterministic schema artifacts from the sole Python authority."""

import argparse
import inspect
import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel, TypeAdapter
from pydantic.json_schema import models_json_schema

from services.contracts import api, domain, exchange, scalars, stages

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "packages" / "contracts"


def artifacts() -> dict[str, Any]:
    models: list[type[BaseModel]] = []
    for module in (api, domain, exchange, scalars, stages):
        for name, value in vars(module).items():
            if (
                inspect.isclass(value)
                and issubclass(value, BaseModel)
                and value.__module__ == module.__name__
                and name
                not in ("Contract", "Success", "ListSuccess", "InputEnvelope", "ResultEnvelope")
            ):
                models.append(value)
    models.extend([api.Success[api.Profile], api.ListSuccess[api.FeedItem]])
    _, schema = models_json_schema([(model, "validation") for model in models])
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["title"] = "SignalBrief schema contract 1"
    schema["x-contract-version"] = "1"
    schemas = schema["$defs"]
    for name, adapter in (
        ("StageInput", stages.INPUT_ADAPTER),
        ("StageResult", stages.RESULT_ADAPTER),
    ):
        generated = adapter.json_schema()
        schemas[name] = {k: v for k, v in generated.items() if k != "$defs"}
    openapi = {
        "openapi": "3.1.0",
        "info": {"title": "SignalBrief components only", "version": "1"},
        "paths": {},
        "components": {
            "schemas": json.loads(json.dumps(schemas).replace("#/$defs/", "#/components/schemas/"))
        },
    }
    result = {"schema.json": schema, "openapi.json": openapi}
    for name, model in (
        ("extraction", stages.ExtractionOutput),
        ("generation", stages.GenerationOutput),
        ("citation", stages.CitationOutput),
    ):
        model_schema = TypeAdapter(model).json_schema()
        model_schema["$schema"] = schema["$schema"]
        result[f"model-output/{name}.json"] = model_schema
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    for name, data in artifacts().items():
        path = DEST / name
        content = json.dumps(data, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                raise SystemExit(f"contract drift: {path.relative_to(ROOT)}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8", newline="\n")
    print("contract artifacts match" if args.check else "contract artifacts generated")


if __name__ == "__main__":
    main()
