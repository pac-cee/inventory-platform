#!/usr/bin/env bash
# Deploy the API to Railway from what git has COMMITTED, not from the working
# folder. Run from anywhere inside the repo:  bash supabase/api/scripts/deploy-from-git.sh
#
# Why: `railway up` uploads files read straight off the Windows disk (/mnt/c). A
# Railway build once received tsconfig.json and tests/helpers/app.ts with the right
# SIZE but unreadable contents, so tsc exited 2 on "Invalid character" at every
# column, while the same commit built cleanly everywhere else. Copying the
# committed tree to a normal Linux folder first avoids the Windows disk entirely,
# and means uncommitted experiments can never reach production.
#
# After the deploy, check the new routes are live (see Crucial_Docs/INVENTORY-RELEASE-AND-CI-PLAN.md, A2).
set -euo pipefail

railway_bin="${RAILWAY_BIN:-railway}"
service="${RAILWAY_SERVICE:-api}"

root="$(git rev-parse --show-toplevel)"
cd "$root"

if [ -z "${ALLOW_DIRTY:-}" ] && [ -n "$(git status --porcelain -- supabase/api)" ]; then
  echo "supabase/api has uncommitted changes. This script deploys what is COMMITTED, so commit them first:" >&2
  git status --short -- supabase/api >&2
  exit 1
fi

tmp="$(mktemp -d "$HOME/railway-deploy.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
git archive HEAD | tar -x -C "$tmp"
echo "Deploying commit $(git rev-parse --short HEAD) ($(git branch --show-current)) to service '$service' from $tmp"

# The project link comes from the current folder (the repo root); only the files
# come from $tmp.
"$railway_bin" up "$tmp" --path-as-root --service "$service" --ci
