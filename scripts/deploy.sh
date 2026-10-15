#!/usr/bin/env bash
#
# Deploys Firestore rules/indexes (--rules) and syncs .env to Heroku config vars
# (--env: only changed keys, values never printed). The bot itself deploys from
# GitHub Actions on a merge to master (.github/workflows/deploy.yml), not --heroku.
#
# One-time prerequisites:
#   firebase login && firebase use --add <your-firebase-project-id>
#   heroku login && heroku git:remote -a <your-app>
#   a populated .env (BOT_TOKEN, DISCORD_CLIENT_ID, FIREBASE_SERVICE_ACCOUNT)
#   commit your changes — Heroku deploys committed code; its `release` phase
#   (see Procfile) auto-registers slash commands.
#
# Runs `npm run doctor` first as a gate (env/Firestore/Discord + Firebase/Heroku
# CLI setup) — a misconfigured setup aborts before anything is touched.
#
# Usage (no flag = everything):
#   npm run deploy                 # doctor + tests + Firestore rules + sync env + Heroku
#   npm run deploy -- --rules      # Firestore rules/indexes only
#   npm run deploy -- --env        # sync .env -> Heroku config only
#   npm run deploy -- --heroku     # Heroku push only
#   npm run deploy -- --rules --env
#   npm run deploy -- --skip-tests # skip the unit tests
#   npm run deploy -- --skip-doctor # skip the preflight gate (e.g. rules-only before Heroku setup)
#
set -euo pipefail
cd "$(dirname "$0")/.."

run_doctor=1
run_tests=1
want_rules=0
want_env=0
want_heroku=0
any_target=0

for arg in "$@"; do
  case "$arg" in
    --rules) want_rules=1; any_target=1 ;;
    --env) want_env=1; any_target=1 ;;
    --heroku) want_heroku=1; any_target=1 ;;
    --skip-tests) run_tests=0 ;;
    --skip-doctor) run_doctor=0 ;;
    -h | --help) sed -n '2,23p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done
if [ "$any_target" = 0 ]; then
  want_rules=1
  want_env=1
  want_heroku=1
fi

# Read a single key's raw value from .env (no sourcing; one layer of surrounding
# quotes stripped). Returns 1 if the key isn't present.
env_value() {
  local key="$1" line val
  line=$(grep -E "^[[:space:]]*${key}=" .env | head -n1) || return 1
  [ -z "$line" ] && return 1
  val="${line#*=}"
  case "$val" in
    \"*\") val="${val#\"}"; val="${val%\"}" ;;
    \'*\') val="${val#\'}"; val="${val%\'}" ;;
  esac
  printf '%s' "$val"
}

# Sync prod secrets from .env to Heroku config — only the keys that changed — and
# ensure the dev-only DEV_BOT_TOKEN, DEV_CLIENT_ID and DEV_GUILD_ID are unset there.
sync_env() {
  [ -f .env ] || { echo "✗ no .env file to sync from." >&2; exit 1; }
  local key local_val remote_val
  local to_set=() names=()
  for key in BOT_TOKEN DISCORD_CLIENT_ID FIREBASE_SERVICE_ACCOUNT; do
    if ! local_val=$(env_value "$key"); then
      echo "  ⚠ $key missing from .env — skipping" >&2
      continue
    fi
    remote_val=$(heroku config:get "$key" 2>/dev/null || true)
    if [ "$local_val" != "$remote_val" ]; then
      to_set+=("$key=$local_val")
      names+=("$key")
    fi
  done
  # Optional config (e.g. the braacket proxy): sync when present in .env, silent
  # when absent — unlike the required secrets above, a missing value is normal
  # (local dev has no proxy).
  for key in BRAACKET_PROXY_URL; do
    local_val=$(env_value "$key") || continue
    remote_val=$(heroku config:get "$key" 2>/dev/null || true)
    if [ "$local_val" != "$remote_val" ]; then
      to_set+=("$key=$local_val")
      names+=("$key")
    fi
  done
  if [ "${#to_set[@]}" -gt 0 ]; then
    echo "  Setting: ${names[*]}"
    # stdout hidden — `config:set` echoes the values back.
    heroku config:set "${to_set[@]}" >/dev/null
  else
    echo "  Heroku config already matches .env — nothing to set."
  fi
  # Dev-only vars must never be set in prod (would select the dev bot/guild).
  local dev_set=()
  local key
  for key in DEV_BOT_TOKEN DEV_CLIENT_ID DEV_GUILD_ID; do
    [ -n "$(heroku config:get "$key" 2>/dev/null || true)" ] && dev_set+=("$key")
  done
  if [ "${#dev_set[@]}" -gt 0 ]; then
    echo "  Unsetting dev-only vars: ${dev_set[*]}"
    heroku config:unset "${dev_set[@]}" >/dev/null
  fi
}

if [ "$run_doctor" = 1 ]; then
  echo "▶ Preflight gate (npm run doctor)…"
  npm run --silent doctor # set -e aborts the deploy if any check fails
fi

if [ "$run_tests" = 1 ]; then
  echo "▶ Running tests…"
  npm test
fi

if [ "$want_rules" = 1 ]; then
  echo "▶ Deploying Firestore rules + indexes…"
  firebase deploy --only firestore:rules,firestore:indexes
fi

if [ "$want_env" = 1 ]; then
  echo "▶ Syncing .env → Heroku config…"
  sync_env
fi

if [ "$want_heroku" = 1 ]; then
  echo "▶ Build check…"
  npm run build
  if [ -n "$(git status --porcelain)" ]; then
    echo "✗ Uncommitted changes — commit first (Heroku deploys committed code)." >&2
    exit 1
  fi
  echo "▶ Pushing current branch to Heroku (HEAD → master)…"
  git push heroku HEAD:master
fi

echo "✅ Deploy complete."
