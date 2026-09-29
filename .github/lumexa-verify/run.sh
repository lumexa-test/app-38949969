#!/usr/bin/env bash
# Lumexa background PRD verification (platform-managed — do not edit).
#
#   1. Fetch the run context (live URL, admin login, PRD) from the platform.
#   2. Claude Code writes Playwright tests from the PRD and runs them.
#   3. All green → report "passed" and stop.
#   4. Otherwise, up to MAX_ROUNDS times: Claude fixes the app → the build is
#      verified here → the fix is pushed to a side branch → the platform
#      fast-forwards main and redeploys → the tests run again. A fix that
#      breaks a previously passing test is rolled back and the run stops.
#
# Every exit path reports an outcome to the platform. Nothing here touches a
# database directly; the app's data is only used through its own UI, and tests
# only modify records they created (tagged with RUN_TAG).
set -uo pipefail

HARNESS_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(git -C "$HARNESS_SRC" rev-parse --show-toplevel)"
WORK="${RUNNER_TEMP:-/tmp}/lumexa-verify"
FINISHED_MARK="$WORK/.finished"
mkdir -p "$WORK"

TEST_MODEL="${TEST_MODEL:-sonnet}"
FIX_MODEL="${FIX_MODEL:-opus}"
# Budgets — the workflow's timeout-minutes (150) is the hard ceiling; a run
# that overruns it is reported as a crash and any unconfirmed fix withdrawn.
CLAUDE_TESTS_TIMEOUT="${CLAUDE_TESTS_TIMEOUT:-40m}"
CLAUDE_FIX_TIMEOUT="${CLAUDE_FIX_TIMEOUT:-30m}"
TESTS_TIMEOUT="${TESTS_TIMEOUT:-30m}"
DEPLOY_WAIT_SECS="${DEPLOY_WAIT_SECS:-1200}"
HEALTH_WAIT_SECS="${HEALTH_WAIT_SECS:-600}"
# A fix may touch at most this many source files — the platform refuses more
# (src/services/e2eVerify/fix.ts MAX_SOURCE_FILES).
export MAX_FIX_FILES="${MAX_FIX_FILES:-10}"

log() { echo "[lumexa-verify] $*"; }

# ---------------------------------------------------------------- platform API
# api METHOD PATH [JSON]  → body in $WORK/resp.json, status in $HTTP_STATUS.
# Retries (for ~10 min) transport errors, 5xx, and 404s that did not come from
# the platform — our API always answers JSON, so a non-JSON 404 is a proxy or
# tunnel in between (e.g. an offline ngrok endpoint). Every endpoint is safe to
# repeat (/fix is idempotent per round + sha).
api() {
  local method=$1 path=$2 data=${3:-} attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if [ -n "$data" ]; then
      HTTP_STATUS=$(curl -sS -o "$WORK/resp.json" -w '%{http_code}' -X "$method" \
        -H "Authorization: Bearer $RUN_TOKEN" -H 'Content-Type: application/json' \
        --data "$data" --max-time 180 "$API_BASE$path" 2>/dev/null) || HTTP_STATUS=000
    else
      HTTP_STATUS=$(curl -sS -o "$WORK/resp.json" -w '%{http_code}' -X "$method" \
        -H "Authorization: Bearer $RUN_TOKEN" --max-time 180 "$API_BASE$path" 2>/dev/null) || HTTP_STATUS=000
    fi
    case "$HTTP_STATUS" in
      000|5??) ;;
      404) jq -e 'type == "object"' "$WORK/resp.json" >/dev/null 2>&1 && return 0 ;;
      *) return 0 ;;
    esac
    log "platform unreachable (HTTP $HTTP_STATUS) — retry $attempt/10"
    sleep $((attempt * 12))
  done
  return 0
}

# Secrets never leave the runner: the GitHub log masks them, but the uploaded
# artifact (Claude's raw logs, test output) would not — blank them on exit.
scrub_secrets() {
  local secret
  for secret in "${ADMIN_PASSWORD:-}" "${RUN_TOKEN:-}" "${CLAUDE_CODE_OAUTH_TOKEN:-}" "${GH_PUSH_TOKEN:-}"; do
    [ ${#secret} -ge 4 ] || continue
    grep -rlF -- "$secret" "$WORK" --exclude-dir=node_modules 2>/dev/null | while IFS= read -r f; do
      SECRET="$secret" perl -0pi -e 's/\Q$ENV{SECRET}\E/***/g' "$f" 2>/dev/null || true
    done
  done
  rm -f "$WORK/resp.json" "$WORK/prompt.txt"
}
on_exit() { unlock_repo 2>/dev/null || chmod 755 "$REPO_DIR" 2>/dev/null; scrub_secrets; }
trap on_exit EXIT

# finish STATUS REASON [retry] — report the outcome once, then exit 0 (the
# outcome is the result; a red workflow would only add noise). `retry` marks a
# skip as temporary so the platform re-queues the run later.
finish() {
  local status=$1 reason=$2 retry=${3:-false} summary='null'
  [ -f "$FINISHED_MARK" ] && exit 0
  [ -f "$WORK/final-summary.json" ] && summary=$(cat "$WORK/final-summary.json")
  api POST /v1/e2e-verify/finish "$(jq -cn --arg s "$status" --arg r "$reason" --argjson sum "$summary" --argjson retry "$retry" \
    '{status: $s, reason: $r, summary: $sum, retry: $retry}')"
  touch "$FINISHED_MARK"
  log "finished: $status — $reason (platform answered $HTTP_STATUS)"
  write_step_summary "$status" "$reason"
  # Red tick when the app is left with known broken functions; green otherwise
  # (passed / fixed, or nothing to do: superseded / skipped).
  case "$status" in failed|partially_fixed|error) exit 1 ;; *) exit 0 ;; esac
}

# Result on the GitHub run page.
write_step_summary() {
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] || return 0
  {
    echo "## Lumexa verification: \`$1\`"
    echo
    echo "$2"
    if [ -f "$WORK/final-summary.json" ]; then
      echo
      jq -r '"| Tests | Passed | Failed |\n|---|---|---|\n| \(.total) | \(.passed) | \(.failed) |"' "$WORK/final-summary.json" 2>/dev/null
      jq -r 'if (.failedIds|length) > 0 then "\n**Still failing**\n" + ([.failedIds[] | "- " + .] | join("\n")) else empty end' "$WORK/final-summary.json" 2>/dev/null
    fi
    [ -n "${ROUNDS_LOG:-}" ] && printf '\n**Fix rounds**\n%b\n' "$ROUNDS_LOG"
    echo
    echo "Full tests, results, screenshots and Claude logs: the **lumexa-verify** artifact below."
  } >> "$GITHUB_STEP_SUMMARY"
}

if [ "${1:-}" = "--report-crash" ]; then
  # Already reported (a red tick from a failed outcome lands here too) → done.
  [ -f "$FINISHED_MARK" ] && exit 0
  [ -n "${RUN_TOKEN:-}" ] && [ -n "${API_BASE:-}" ] && finish error "workflow crashed or timed out"
  exit 0
fi

for v in RUN_ID RUN_TOKEN API_BASE; do
  if [ -z "${!v:-}" ]; then log "missing $v — not a platform dispatch, nothing to do"; exit 0; fi
done
RUN_TAG="lmxv-${RUN_ID:0:8}"
ROUNDS_LOG=""

# -------------------------------------------------------------------- context
api GET /v1/e2e-verify/context
if [ "$HTTP_STATUS" != 200 ]; then
  log "run not active (HTTP $HTTP_STATUS) — exiting"
  exit 0
fi
APP_URL=$(jq -r .app_url "$WORK/resp.json")
ADMIN_EMAIL=$(jq -r .admin_email "$WORK/resp.json")
ADMIN_PASSWORD=$(jq -r .admin_password "$WORK/resp.json")
BASE_SHA=$(jq -r .base_sha "$WORK/resp.json")
MAX_ROUNDS=$(jq -r .max_rounds "$WORK/resp.json")
jq -r .prd "$WORK/resp.json" > "$WORK/PRD.md"
# Build-time frontend settings the platform bakes into the live bundle (not in
# the repo — .env.local is excluded from the mirror). Missing = refuse to build.
jq -e '.frontend_env | type == "object"' "$WORK/resp.json" >/dev/null 2>&1 \
  || { log "platform sent no frontend_env — update the platform"; FRONTEND_ENV_MISSING=1; }
jq -r '(.frontend_env // {}) | to_entries[] | "\(.key)=\(.value)"' "$WORK/resp.json" > "$WORK/frontend.env.local"
echo "::add-mask::$ADMIN_PASSWORD"
export APP_URL ADMIN_EMAIL ADMIN_PASSWORD RUN_TAG WORK REPO_DIR

if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  finish skipped "CLAUDE_CODE_OAUTH_TOKEN org secret is not set"
fi

# Git auth is passed per command and never written to .git/config (the
# checkout ran with persist-credentials: false), so Claude's shell cannot push.
[ -n "${GH_PUSH_TOKEN:-}" ] || finish error "GH_PUSH_TOKEN is not set"
GH_AUTH_HEADER="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_PUSH_TOKEN" | base64 -w0)"
git_auth() { git -C "$REPO_DIR" -c "http.extraheader=$GH_AUTH_HEADER" "$@"; }

git_auth fetch -q origin main || finish error "git fetch failed"
if [ "$(git -C "$REPO_DIR" rev-parse origin/main)" != "$BASE_SHA" ]; then
  finish superseded "main moved past the deployed commit before the run started"
fi
git -C "$REPO_DIR" checkout -q --detach "$BASE_SHA" || finish error "checkout of $BASE_SHA failed"
git -C "$REPO_DIR" config user.name "Lumexa"
git -C "$REPO_DIR" config user.email "gennie@lumexaai.com"

# Run the harness from a copy outside the repo, so the checkout can be locked
# while tests are written (see lock_repo).
rm -rf "$WORK/harness-src" && cp -r "$HARNESS_SRC" "$WORK/harness-src" && HARNESS_SRC="$WORK/harness-src"

# Black-box testing: no read access to the app's source while tests are written
# and reviewed — the PRD and the live app are the only sources of truth. Only
# the fixer, after all testing, gets the code.
lock_repo() { chmod 000 "$REPO_DIR"; }
unlock_repo() { chmod 755 "$REPO_DIR" 2>/dev/null || true; }

# ---------------------------------------------------------------------- tools
log "installing Claude Code + Playwright"
npm install -g @anthropic-ai/claude-code >/dev/null 2>&1 || finish error "installing Claude Code failed"
mkdir -p "$WORK/harness/tests"
cp "$HARNESS_SRC/package.json" "$HARNESS_SRC/playwright.config.ts" "$WORK/harness/"
(cd "$WORK/harness" && npm install --no-audit --no-fund >/dev/null 2>&1 && npx playwright install --with-deps chromium >/dev/null 2>&1) \
  || finish error "installing Playwright failed"
touch "$WORK/invalid-tests.txt"
# Browser-tool snapshots go to $WORK, never into the app repo.
mkdir -p "$WORK/mcp-output"
jq --arg out "$WORK/mcp-output" '.mcpServers.playwright.args += ["--output-dir", $out]' \
  "$HARNESS_SRC/mcp.json" > "$WORK/mcp.json"

# claude_run MODEL TIMEOUT CWD PROMPT_FILE LOG [DIR...] — runs the CLI headless
# with the prompt on stdin; DIRs are the only extra directories it may use.
# Auth / usage-limit failures end the run as "skipped".
claude_run() {
  local model=$1 limit=$2 cwd=$3 prompt=$4 out=$5 rc
  shift 5
  local dirs=("$WORK" "$@")
  node -e 'const fs=require("fs");const t=fs.readFileSync(process.argv[1],"utf8");
    fs.writeFileSync(process.argv[2],t.replace(/\$\{(WORK|APP_URL|REPO_DIR|RUN_TAG|MAX_FIX_FILES)\}/g,(_,k)=>process.env[k]||""));' \
    "$prompt" "$WORK/prompt.txt"
  # Secrets Claude must never see: the platform run token and the push token.
  # stream-json → every step Claude takes is echoed live into the job log; the
  # raw stream is kept in $out for the artifact and the error checks below.
  (cd "$cwd" && env -u RUN_TOKEN -u GH_PUSH_TOKEN -u GH_AUTH_HEADER timeout "$limit" claude -p \
      --model "$model" \
      --output-format stream-json --verbose \
      --permission-mode dontAsk \
      --allowedTools Bash Read Write Edit Glob Grep mcp__playwright \
      --add-dir "${dirs[@]}" \
      --mcp-config "$WORK/mcp.json" \
      < "$WORK/prompt.txt") 2>&1 | tee "$out" | jq -R -r --unbuffered '
        fromjson? |
        if .type == "assistant" then
          (.message.content[]? |
            if .type == "text" then "  💬 " + (.text | gsub("\n"; " ") | .[0:400])
            elif .type == "tool_use" then "  🔧 " + .name + " " +
              ((.input.command // .input.file_path // .input.url // .input.pattern // "") | tostring | gsub("\n"; " ") | .[0:200])
            else empty end)
        elif .type == "result" then "  ✔ session ended (" + (.subtype // "") + ", " + ((.num_turns // 0) | tostring) + " turns)"
        else empty end'
  rc=${PIPESTATUS[0]}
  # 124 = our timeout, not a CLI error. Only the CLI's own final lines are
  # inspected — test output legitimately talks about "authentication".
  if [ $rc -ne 0 ] && [ $rc -ne 124 ]; then
    if tail -n 30 "$out" | grep -qiE 'invalid api key|authentication_error|oauth token|please run /login|not logged in|token (has |is )?expired|401 unauthorized'; then
      finish skipped "Claude login failed — renew CLAUDE_CODE_OAUTH_TOKEN (claude setup-token)" true
    fi
    if tail -n 30 "$out" | grep -qiE 'usage limit|rate.?limit|429|limit (reached|exceeded)|quota'; then
      finish skipped "Claude usage limit reached" true
    fi
  fi
  return $rc
}

# wait_healthy SECONDS — the deployed app answers /health and serves its SPA.
wait_healthy() {
  local deadline=$((SECONDS + $1))
  while [ $SECONDS -lt $deadline ]; do
    if curl -fsS --max-time 15 "$APP_URL/health" >/dev/null 2>&1 && curl -fsS --max-time 15 "$APP_URL/" >/dev/null 2>&1; then
      return 0
    fi
    sleep 15
  done
  return 1
}

# run_tests LABEL — writes $WORK/summary-LABEL.json and $WORK/failures.md.
run_tests() {
  local label=$1
  (cd "$WORK/harness" && RESULTS_FILE="$WORK/results-$label.json" timeout "$TESTS_TIMEOUT" npx playwright test >"$WORK/playwright-$label.log" 2>&1)
  node "$HARNESS_SRC/lib/summarize.mjs" "$WORK/results-$label.json" "$WORK/invalid-tests.txt" \
    "$WORK/summary-$label.json" "$WORK/failures.md"
  jq -c '{total, passed, failed, flaky, excludedAsInvalid, failedIds}' "$WORK/summary-$label.json" > "$WORK/final-summary.json"
}

wait_healthy "$HEALTH_WAIT_SECS" || finish skipped "deployed app not healthy yet at $APP_URL" true

# Manual test runs (--reuse-tests): take the suite from this repo's latest run
# artifact instead of writing one — skips ~40 min. Falls back to writing.
reuse_previous_tests() {
  local api="${GITHUB_API_URL:-https://api.github.com}/repos/${GITHUB_REPOSITORY:-}" id
  [ -n "${GITHUB_REPOSITORY:-}" ] || return 1
  curl -fsS -H "Authorization: Bearer $GH_PUSH_TOKEN" -H "Accept: application/vnd.github+json" \
    "$api/actions/artifacts?name=lumexa-verify&per_page=20" -o "$WORK/artifacts.json" 2>/dev/null || return 1
  for id in $(jq -r '.artifacts | map(select(.expired | not)) | sort_by(.created_at) | reverse | .[].id' "$WORK/artifacts.json"); do
    rm -rf "$WORK/prev" && mkdir -p "$WORK/prev"
    curl -fsSL -H "Authorization: Bearer $GH_PUSH_TOKEN" "$api/actions/artifacts/$id/zip" -o "$WORK/prev.zip" 2>/dev/null || continue
    (cd "$WORK/prev" && unzip -q ../prev.zip) 2>/dev/null || continue
    ls "$WORK/prev/tests.frozen/"*.spec.ts >/dev/null 2>&1 || continue
    rm -rf "$WORK/harness/tests" && cp -r "$WORK/prev/tests.frozen" "$WORK/harness/tests"
    [ -f "$WORK/prev/journeys.md" ] && cp "$WORK/prev/journeys.md" "$WORK/journeys.md"
    [ -f "$WORK/prev/invalid-tests.txt" ] && cp "$WORK/prev/invalid-tests.txt" "$WORK/invalid-tests.txt"
    log "reusing the test suite from artifact $id ($(ls "$WORK/harness/tests/"*.spec.ts | wc -l) spec files)"
    return 0
  done
  return 1
}

REUSED=""
if [ "${REUSE_TESTS:-false}" = true ]; then
  reuse_previous_tests && REUSED=1 || log "no previous test suite found — writing a new one"
fi

# ------------------------------------------------------------- write the tests
if [ -z "$REUSED" ]; then
log "writing tests from the PRD ($TEST_MODEL)"
# Black box: the test writer and reviewer get the PRD and the live app only —
# no app source (it would bias tests toward what the code already does).
lock_repo
claude_run "$TEST_MODEL" "$CLAUDE_TESTS_TIMEOUT" "$WORK/harness" "$HARNESS_SRC/prompts/write-tests.md" "$WORK/claude-tests.log" \
  || log "test-writing session ended non-zero — using the tests it wrote"
if ! ls "$WORK/harness/tests/"*.spec.ts >/dev/null 2>&1; then
  finish error "no tests were written"
fi
# Second opinion before anything in the app changes: every failure must be a
# real functional bug, not a wrong test.
run_tests draft
if [ "$(jq -r .failed "$WORK/summary-draft.json")" -gt 0 ]; then
  log "reviewing $(jq -r .failed "$WORK/summary-draft.json") failing test(s) — are they real bugs? ($TEST_MODEL)"
  claude_run "$TEST_MODEL" "$CLAUDE_TESTS_TIMEOUT" "$WORK/harness" "$HARNESS_SRC/prompts/review-tests.md" "$WORK/claude-review.log" \
    || log "review session ended non-zero — using the suite as it is"
fi
ls "$WORK/harness/tests/"*.spec.ts >/dev/null 2>&1 || finish error "no tests left after review"
fi
# Freeze the suite: the fixer may read but never change it.
cp -r "$WORK/harness/tests" "$WORK/tests.frozen"
unlock_repo
# The app repo was read-only for the test writer — discard anything it touched
# so it cannot be mistaken for round 1's fix.
git -C "$REPO_DIR" reset -q --hard "$BASE_SHA" && git -C "$REPO_DIR" clean -qfd

run_tests r0
[ "$(jq -r .reportOk "$WORK/summary-r0.json")" = true ] || finish error "test run produced no report"
[ "$(jq -r .total "$WORK/summary-r0.json")" -gt 0 ] || finish error "no tests ran"
INITIAL_FAILED=$(jq -r .failed "$WORK/summary-r0.json")
if [ "$INITIAL_FAILED" -eq 0 ]; then
  finish passed "all $(jq -r .total "$WORK/summary-r0.json") PRD tests passed"
fi
log "$INITIAL_FAILED failing test(s) — starting fix rounds"

# ------------------------------------------------------------------ fix rounds
install_deps() {
  (cd "$REPO_DIR/backend" && npm install --no-audit --no-fund --legacy-peer-deps && npx prisma generate) >"$WORK/install.log" 2>&1 \
    && (cd "$REPO_DIR/frontend" && npm install --no-audit --no-fund) >>"$WORK/install.log" 2>&1
}

build_app() {
  [ -z "${FRONTEND_ENV_MISSING:-}" ] || { echo "no frontend_env from the platform" >"$WORK/build.log"; return 1; }
  # Same frontend settings as the platform packager's build (see resp frontend_env).
  cp "$WORK/frontend.env.local" "$REPO_DIR/frontend/.env.local"
  (cd "$REPO_DIR/backend" && npm run build) >"$WORK/build.log" 2>&1 \
    && (cd "$REPO_DIR/frontend" && npx vite build --base /) >>"$WORK/build.log" 2>&1 \
    || return 1
  # Never ship a bundle that talks to a dev server instead of its own backend.
  if grep -rqE 'https?://(localhost|127\.0\.0\.1)(:[0-9]+)?' "$REPO_DIR/frontend/dist/assets" 2>/dev/null \
     && ! grep -rqE 'https?://(localhost|127\.0\.0\.1)(:[0-9]+)?' "$REPO_DIR/backend/public/assets" 2>/dev/null; then
    echo "built bundle points at localhost — frontend env is wrong" >>"$WORK/build.log"
    return 1
  fi
}

restore_tests() { rm -rf "$WORK/harness/tests" && cp -r "$WORK/tests.frozen" "$WORK/harness/tests"; }

# Undo npm's lockfile rewrites — dependencies are frozen for a fix.
reset_lockfiles() {
  git -C "$REPO_DIR" checkout -q -- $(git -C "$REPO_DIR" ls-files '*package-lock.json' 2>/dev/null) 2>/dev/null || true
}

install_deps || finish error "installing app dependencies failed"
reset_lockfiles

CUR_SHA="$BASE_SHA"
PREV_LABEL=r0
for ROUND in $(seq 1 "$MAX_ROUNDS"); do
  log "round $ROUND: fixing ($FIX_MODEL)"
  claude_run "$FIX_MODEL" "$CLAUDE_FIX_TIMEOUT" "$REPO_DIR" "$HARNESS_SRC/prompts/fix.md" "$WORK/claude-fix-$ROUND.log" "$REPO_DIR" \
    || log "fix session ended non-zero — checking what it changed"
  restore_tests
  reset_lockfiles
  GUARD=$(cd "$REPO_DIR" && node "$HARNESS_SRC/lib/guard-diff.mjs") || finish error "diff guard failed"
  log "guard: $GUARD"

  # No source change: the fixer either gave up or only marked tests invalid —
  # recount the last run without the invalid ones and stop.
  if [ "$(echo "$GUARD" | jq -r .sourceChanged)" -eq 0 ]; then
    node "$HARNESS_SRC/lib/summarize.mjs" "$WORK/results-$PREV_LABEL.json" "$WORK/invalid-tests.txt" \
      "$WORK/summary-$PREV_LABEL.json" "$WORK/failures.md"
    jq -c '{total, passed, failed, flaky, excludedAsInvalid, failedIds}' "$WORK/summary-$PREV_LABEL.json" > "$WORK/final-summary.json"
    if [ "$(jq -r .failed "$WORK/summary-$PREV_LABEL.json")" -eq 0 ]; then
      [ "$ROUND" -eq 1 ] && finish passed "remaining failures were test mistakes, not app bugs"
      finish fixed "all PRD tests pass"
    fi
    [ "$ROUND" -eq 1 ] && finish failed "no fix produced for $INITIAL_FAILED failing test(s)"
    finish partially_fixed "no further fix produced"
  fi

  CHANGED=$(echo "$GUARD" | jq -r .sourceChanged)
  if [ "$CHANGED" -gt "$MAX_FIX_FILES" ]; then
    git -C "$REPO_DIR" reset -q --hard "$CUR_SHA" && git -C "$REPO_DIR" clean -qfd -e node_modules
    ROUNDS_LOG="${ROUNDS_LOG}- round $ROUND: fix touched $CHANGED files (max $MAX_FIX_FILES) — discarded\n"
    [ "$ROUND" -eq 1 ] && finish failed "the fix was too broad ($CHANGED files, max $MAX_FIX_FILES) — discarded, nothing deployed"
    finish partially_fixed "round $ROUND fix too broad ($CHANGED files) — discarded"
  fi

  if ! build_app; then
    log "build failed — one repair attempt"
    claude_run "$FIX_MODEL" 15m "$REPO_DIR" "$HARNESS_SRC/prompts/fix-build.md" "$WORK/claude-build-$ROUND.log" "$REPO_DIR" || true
    restore_tests
    reset_lockfiles
    (cd "$REPO_DIR" && node "$HARNESS_SRC/lib/guard-diff.mjs") >/dev/null || true
    if ! build_app; then
      git -C "$REPO_DIR" reset -q --hard "$CUR_SHA" && git -C "$REPO_DIR" clean -qfd -e node_modules
      [ "$ROUND" -eq 1 ] && finish failed "the fix did not build"
      finish partially_fixed "round $ROUND fix did not build"
    fi
  fi

  # Render builds backend/ only, so the built SPA ships in backend/public —
  # same as the platform packager's copyFrontendDist.
  mkdir -p "$REPO_DIR/backend/public"
  cp -r "$REPO_DIR/frontend/dist/." "$REPO_DIR/backend/public/"
  reset_lockfiles

  git -C "$REPO_DIR" add -A
  if git -C "$REPO_DIR" diff --cached --quiet; then
    finish failed "fix produced no committable change"
  fi
  git -C "$REPO_DIR" commit -q -m "Improve app reliability" || finish error "commit failed"
  FIX_SHA=$(git -C "$REPO_DIR" rev-parse HEAD)
  BRANCH="lumexa-verify/${RUN_ID:0:8}-r$ROUND"
  git_auth push -q origin "HEAD:refs/heads/$BRANCH" || finish error "pushing $BRANCH failed"

  api POST /v1/e2e-verify/fix "$(jq -cn --argjson r "$ROUND" --arg b "$CUR_SHA" --arg f "$FIX_SHA" \
    '{round: $r, base_sha: $b, fix_sha: $f}')"
  # The side branch has done its job either way (main now carries the commit,
  # or the fix was refused) — don't leave it in the owner's repo.
  git_auth push -q origin --delete "$BRANCH" 2>/dev/null || true
  case "$HTTP_STATUS" in
    200) ;;
    409) finish superseded "owner changed the app: $(jq -r .reason "$WORK/resp.json")" ;;
    410) log "run no longer active"; exit 0 ;;
    422) finish failed "fix refused: $(jq -r .reason "$WORK/resp.json")" ;;
    *) finish error "apply-fix answered HTTP $HTTP_STATUS" ;;
  esac

  log "round $ROUND: waiting for the redeploy of ${FIX_SHA:0:7}"
  deadline=$((SECONDS + DEPLOY_WAIT_SECS))
  phase=deploying
  while [ $SECONDS -lt $deadline ]; do
    sleep 20
    api GET "/v1/e2e-verify/deploy?round=$ROUND"
    [ "$HTTP_STATUS" = 410 ] && { log "run no longer active"; exit 0; }
    [ "$HTTP_STATUS" = 200 ] || continue
    phase=$(jq -r .phase "$WORK/resp.json")
    [ "$phase" = deploying ] || break
  done
  case "$phase" in
    live) ;;
    failed) finish failed "round $ROUND redeploy failed on Render (rolled back)" ;;
    superseded|rolled_back) finish superseded "a newer deploy replaced the fix" ;;
    *)
      api POST /v1/e2e-verify/rollback "$(jq -cn --argjson r "$ROUND" '{round: $r, reason: "redeploy timed out"}')"
      finish failed "round $ROUND redeploy timed out (rolled back)"
      ;;
  esac

  if ! wait_healthy "$HEALTH_WAIT_SECS"; then
    api POST /v1/e2e-verify/rollback "$(jq -cn --argjson r "$ROUND" '{round: $r, reason: "app unhealthy after fix"}')"
    finish failed "app unhealthy after round $ROUND (rolled back)"
  fi

  run_tests "r$ROUND"
  NOW_FAILED=$(jq -r .failed "$WORK/summary-r$ROUND.json")
  PREV_FAILED=$(jq -r .failed "$WORK/summary-$PREV_LABEL.json")
  NEWLY_BROKEN=$(jq -n --slurpfile p "$WORK/summary-$PREV_LABEL.json" --slurpfile n "$WORK/summary-r$ROUND.json" \
    '[$n[0].failedIds[] | select(. as $id | $p[0].passedIds | index($id))] | length')
  if [ "$(jq -r .reportOk "$WORK/summary-r$ROUND.json")" != true ] || [ "$NEWLY_BROKEN" -gt 0 ] || [ "$NOW_FAILED" -gt "$PREV_FAILED" ]; then
    log "round $ROUND made things worse ($NEWLY_BROKEN newly broken) — rolling back"
    ROUNDS_LOG="${ROUNDS_LOG}- round $ROUND: ${FIX_SHA:0:7} broke $NEWLY_BROKEN passing test(s) — rolled back\n"
    api POST /v1/e2e-verify/rollback "$(jq -cn --argjson r "$ROUND" '{round: $r, reason: "regression"}')"
    cp "$WORK/summary-$PREV_LABEL.json" "$WORK/tmp.json" && jq -c '{total, passed, failed, flaky, excludedAsInvalid, failedIds}' "$WORK/tmp.json" > "$WORK/final-summary.json"
    [ "$ROUND" -eq 1 ] && finish failed "the fix broke passing tests (rolled back)"
    finish partially_fixed "round $ROUND broke passing tests (rolled back to round $((ROUND - 1)))"
  fi
  ROUNDS_LOG="${ROUNDS_LOG}- round $ROUND: ${FIX_SHA:0:7} deployed — $PREV_FAILED → $NOW_FAILED failing\n"
  if [ "$NOW_FAILED" -eq 0 ]; then
    finish fixed "all PRD tests pass after $ROUND round(s)"
  fi
  log "round $ROUND: $PREV_FAILED → $NOW_FAILED failing"
  CUR_SHA="$FIX_SHA"
  PREV_LABEL="r$ROUND"
done

FINAL_FAILED=$(jq -r .failed "$WORK/summary-$PREV_LABEL.json")
if [ "$FINAL_FAILED" -lt "$INITIAL_FAILED" ]; then
  finish partially_fixed "$FINAL_FAILED of $INITIAL_FAILED failures remain after $MAX_ROUNDS rounds"
fi
finish failed "$FINAL_FAILED failures remain after $MAX_ROUNDS rounds"
