#!/usr/bin/env bash
# One command for every quality gate, run on your own machine (no GitHub Actions needed):
#   pnpm check                  everything below
#   pnpm check --quick          format, lint, typecheck, build and unit/API tests only
#   pnpm check --no-docker      skip the Docker image build (e.g. no Docker installed)
#   pnpm check --no-e2e         skip the browser end-to-end tests
#
# Needs: Node 22, pnpm 10, a PostgreSQL database reachable at DATABASE_URL (from .env), and for the
# last step Docker. The same steps run in .github/workflows/ci.yml when GitHub Actions is available.
set -euo pipefail
cd "$(dirname "$0")/.."

quick=0; docker=1; e2e=1
for arg in "$@"; do
  case "$arg" in
    --quick) quick=1 ;;
    --no-docker) docker=0 ;;
    --no-e2e) e2e=0 ;;
    *) echo "Unknown option: $arg"; exit 2 ;;
  esac
done

if [ ! -f .env ]; then echo "No .env file. Run: cp .env.example .env"; exit 1; fi
set -a; . ./.env; set +a

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
passed=()

step "Install dependencies (frozen lockfile)"; pnpm install --frozen-lockfile; passed+=("install")
step "Formatting";                    pnpm format:check;  passed+=("format")
step "Lint";                          pnpm lint;          passed+=("lint")
step "Build";                         pnpm build;         passed+=("build")
step "Type check";                    pnpm typecheck;     passed+=("typecheck")
step "Database migrations"
pnpm db:migrate || { echo "Could not migrate the database at DATABASE_URL. Is PostgreSQL running? (docker compose up -d postgres)"; exit 1; }
passed+=("migrations")
step "Unit and API tests";            pnpm test;          passed+=("tests")

if [ "$quick" = 0 ]; then
  step "Dependency audit (high and critical)"; pnpm audit --prod --audit-level high; passed+=("audit")
  if [ "$e2e" = 1 ]; then
    step "End-to-end tests (starts API, studio, runtime and CAPI app)"; pnpm e2e; passed+=("e2e")
  fi
  if [ "$docker" = 1 ]; then
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
      step "Docker images"; docker compose build; passed+=("docker")
    else
      echo "Docker is not running: skipped the image build (use --no-docker to silence this)."
    fi
  fi
fi

printf '\n\033[1;32mAll checks passed:\033[0m %s\n' "${passed[*]}"
