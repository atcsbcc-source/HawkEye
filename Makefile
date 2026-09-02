# HawkEye — single entry point for both packages.
#   make install   npm ci + pip install -e pipeline[dev]
#   make dev       Next.js dev server (mock mode unless dashboard/.env.local exists)
#   make check     lint + typecheck + test for dashboard and pipeline (run before finishing)

DASH := dashboard
PIPE := pipeline
NPM  := npm --prefix $(DASH)
PY   ?= python

.PHONY: install dev build lint fmt typecheck test check clean

install:
	cd $(DASH) && npm ci
	$(PY) -m pip install -e './$(PIPE)[dev]'

dev:
	$(NPM) run dev

build:
	NEXT_TELEMETRY_DISABLED=1 $(NPM) run build

lint:
	$(NPM) run lint
	ruff check $(PIPE)
	ruff format --check $(PIPE)

fmt:
	$(NPM) run format
	ruff format $(PIPE)
	ruff check --fix $(PIPE)

typecheck:
	$(NPM) run typecheck
	mypy --config-file $(PIPE)/pyproject.toml $(PIPE)

test:
	$(NPM) test
	$(PY) -m pytest -q $(PIPE)/tests

check: lint typecheck test

clean:
	rm -rf $(DASH)/.next $(DASH)/coverage $(DASH)/*.tsbuildinfo
	rm -rf $(PIPE)/.pytest_cache $(PIPE)/.ruff_cache $(PIPE)/.mypy_cache $(PIPE)/*.egg-info
	find $(PIPE) -name __pycache__ -type d -prune -exec rm -rf {} +
