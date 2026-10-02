.PHONY: install dev api worker test lint typecheck build eval migrate verify openapi
install:
	python -m pip install -e '.[dev]'
	cd apps/web && npm install

dev:
	python scripts/dev.py

api:
	python -m uvicorn signalbrief.app:app --host 127.0.0.1 --port 8000 --reload

worker:
	python -m signalbrief.cli worker

test:
	python -m pytest -q
	cd apps/web && npm test

lint:
	python -m ruff check apps/api tests scripts
	cd apps/web && npm run lint

typecheck:
	cd apps/web && npm run typecheck

build:
	cd apps/web && npm run build

eval:
	python -m signalbrief.cli eval

migrate:
	python -m alembic upgrade head

verify:
	python scripts/verify.py --full

openapi:
	python scripts/export_openapi.py
