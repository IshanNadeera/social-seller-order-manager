#!/usr/bin/env bash
# Checks that the repository layout from docs/DEVELOPMENT.md §10.3 is in place.
# Run from the repo root: bash scripts/check-structure.sh
set -u
cd "$(dirname "$0")/.." || exit 1

missing=0
required_dirs=(apps/web apps/api packages/shared supabase tests/e2e docs docs/adr)
required_files=(README.md .gitignore docs/DEVELOPMENT.md)

for d in "${required_dirs[@]}"; do
  if [ ! -d "$d" ]; then echo "Missing folder: $d"; missing=1; fi
done
for f in "${required_files[@]}"; do
  if [ ! -s "$f" ]; then echo "Missing or empty file: $f"; missing=1; fi
done

if [ -f docs/DEVELOPMENT.md ] && ! head -n 1 docs/DEVELOPMENT.md | grep -q "^# Social Seller Order Manager"; then
  echo "docs/DEVELOPMENT.md does not look like the blueprint"; missing=1
fi
for cmd in "npm install" "npm run dev -w apps/api" "npm run dev -w apps/web" "prisma migrate dev" "npm test --workspaces"; do
  if ! grep -qF "$cmd" README.md 2>/dev/null; then echo "README.md is missing the command: $cmd"; missing=1; fi
done
if git rev-parse --is-inside-work-tree >/dev/null 2>&1 && [ -n "$(git ls-files -- '*.env' '.env*' | grep -v '.env.example' || true)" ]; then
  echo "An .env file is tracked by git"; missing=1
fi

if [ "$missing" -eq 0 ]; then echo "Structure check passed"; else exit 1; fi
