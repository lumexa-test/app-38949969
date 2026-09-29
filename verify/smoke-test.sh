#!/usr/bin/env bash
# Smoke test for FaceGlow AI's domain API. Self-contained: curl + standard
# tools only, no arguments. Backend port defaults to 4100, overridable via
# PORT. Prints one "PASS:"/"FAIL:" line per assertion; exits non-zero on any
# failure.
#
# Cleanup uses ONLY the API (DELETE /api/auth/me, self-service account
# deletion) — never a direct DB connection, since the script's own execution
# environment cannot be assumed to carry DATABASE_URL. Fixture emails are
# FIXED (not timestamp-suffixed) so a prior aborted run's leftovers can be
# found again by logging in with the same credentials and deleted.
set -u
PORT="${PORT:-4100}"
BASE="http://localhost:${PORT}"

FAILED=0
PASS() { echo "PASS: $1"; }
FAIL() { echo "FAIL: $1"; FAILED=1; }
assert_code() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then PASS "$desc (got $actual)"; else FAIL "$desc (expected $expected, got $actual)"; fi
}

EMAIL_A="smoketest-user@example.com"
EMAIL_B="smoketest-other@example.com"
PASSWORD="Smoketest123!"

# Logs in with the given credentials; if it succeeds, deletes that account via
# the API. Safe to call whether or not the account currently exists.
delete_if_exists() {
  local email="$1"
  local login_json
  login_json=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$PASSWORD\"}")
  local token
  token=$(echo "$login_json" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
  if [ -n "$token" ]; then
    curl -s -o /dev/null -X DELETE "$BASE/api/auth/me" -H "Authorization: Bearer $token"
  fi
}

echo "--- Initial cleanup sweep ---"
delete_if_exists "$EMAIL_A"
delete_if_exists "$EMAIL_B"
PASS "initial cleanup sweep ran (removed any leftover smoketest- fixtures)"

# ── Auth ──────────────────────────────────────────────────────────────────
echo "--- Auth ---"
SIGNUP_A=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/auth/signup" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL_A\",\"password\":\"$PASSWORD\",\"displayName\":\"Smoketest User\"}")
CODE=$(echo "$SIGNUP_A" | tail -1); BODY=$(echo "$SIGNUP_A" | sed '$d')
assert_code "signup creates account" 200 "$CODE"
TOKEN_A=$(echo "$BODY" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
BALANCE_A=$(echo "$BODY" | python3 -c "import sys,json;print(json.load(sys.stdin)['user']['creditBalance'])" 2>/dev/null)
if [ "$BALANCE_A" = "3" ]; then PASS "signup grants 3 free credits"; else FAIL "signup grants 3 free credits (got $BALANCE_A)"; fi

DUP_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/signup" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL_A\",\"password\":\"$PASSWORD\",\"displayName\":\"Dup\"}")
assert_code "duplicate signup email rejected" 400 "$DUP_CODE"

BAD_LOGIN_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL_A\",\"password\":\"wrong-password\"}")
assert_code "wrong password rejected" 401 "$BAD_LOGIN_CODE"

SIGNUP_B=$(curl -s -X POST "$BASE/api/auth/signup" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL_B\",\"password\":\"$PASSWORD\",\"displayName\":\"Smoketest Other\"}")
TOKEN_B=$(echo "$SIGNUP_B" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)

UNAUTH_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/enhancement-jobs")
assert_code "unauthenticated request rejected" 401 "$UNAUTH_CODE"

# ── Enhancement job lifecycle ───────────────────────────────────────────────
echo "--- Enhancement jobs ---"
BAD_MIME_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/enhancement-jobs" \
  -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d '{"photoUrl":"/uploads/smoketest-x.gif","photoFileName":"smoketest-x.gif","photoMimeType":"image/gif","photoSizeBytes":1000}')
assert_code "disallowed mime type rejected" 400 "$BAD_MIME_CODE"

TOO_BIG_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/enhancement-jobs" \
  -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d '{"photoUrl":"/uploads/smoketest-x.jpg","photoFileName":"smoketest-x.jpg","photoMimeType":"image/jpeg","photoSizeBytes":99999999}')
assert_code "oversized photo rejected" 400 "$TOO_BIG_CODE"

JOB_JSON=$(curl -s -X POST "$BASE/api/enhancement-jobs" -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d '{"photoUrl":"/uploads/smoketest-photo.jpg","photoFileName":"smoketest-photo.jpg","photoMimeType":"image/jpeg","photoSizeBytes":50000}')
JOB_ID=$(echo "$JOB_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])" 2>/dev/null)
if [ -n "$JOB_ID" ]; then PASS "draft enhancement request created"; else FAIL "draft enhancement request created"; fi

ZERO_OPTS_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/enhancement-jobs/$JOB_ID/options" \
  -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' -d '{"selectedOptions":[]}')
assert_code "zero corrections selected rejected" 400 "$ZERO_OPTS_CODE"

SET_OPTS_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/enhancement-jobs/$JOB_ID/options" \
  -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d '{"selectedOptions":["darkSpotRemoval"],"optionStrengths":{}}')
assert_code "valid corrections saved" 200 "$SET_OPTS_CODE"

REVIEW_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/enhancement-jobs/$JOB_ID/review" -H "Authorization: Bearer $TOKEN_A")
assert_code "automatic review seam reports not-configured" 503 "$REVIEW_CODE"

OTHER_VIEW_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/enhancement-jobs/$JOB_ID" -H "Authorization: Bearer $TOKEN_B")
assert_code "cross-user request access rejected" 403 "$OTHER_VIEW_CODE"

MISSING_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/enhancement-jobs/9999999" -H "Authorization: Bearer $TOKEN_A")
assert_code "unknown request id → 404" 404 "$MISSING_CODE"

SUBMIT_JSON=$(curl -s -X POST "$BASE/api/enhancement-jobs/$JOB_ID/submit" -H "Authorization: Bearer $TOKEN_A")
NEW_BALANCE=$(echo "$SUBMIT_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin)['balance'])" 2>/dev/null)
if [ "$NEW_BALANCE" = "2" ]; then PASS "submit spends exactly 1 credit (balance now 2)"; else FAIL "submit spends exactly 1 credit (got $NEW_BALANCE)"; fi

DOUBLE_SUBMIT_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/enhancement-jobs/$JOB_ID/submit" -H "Authorization: Bearer $TOKEN_A")
assert_code "double-submit rejected as conflict" 409 "$DOUBLE_SUBMIT_CODE"

# Drain remaining credits, then confirm insufficient-credit submits are refused cleanly.
for i in 1 2; do
  J=$(curl -s -X POST "$BASE/api/enhancement-jobs" -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
    -d '{"photoUrl":"/uploads/smoketest-photo.jpg","photoFileName":"smoketest-photo.jpg","photoMimeType":"image/jpeg","photoSizeBytes":50000}')
  JID=$(echo "$J" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])" 2>/dev/null)
  curl -s -o /dev/null -X PUT "$BASE/api/enhancement-jobs/$JID/options" -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
    -d '{"selectedOptions":["darkSpotRemoval"],"optionStrengths":{}}'
  curl -s -o /dev/null -X POST "$BASE/api/enhancement-jobs/$JID/submit" -H "Authorization: Bearer $TOKEN_A"
done
J3=$(curl -s -X POST "$BASE/api/enhancement-jobs" -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d '{"photoUrl":"/uploads/smoketest-photo.jpg","photoFileName":"smoketest-photo.jpg","photoMimeType":"image/jpeg","photoSizeBytes":50000}')
J3ID=$(echo "$J3" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])" 2>/dev/null)
curl -s -o /dev/null -X PUT "$BASE/api/enhancement-jobs/$J3ID/options" -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d '{"selectedOptions":["darkSpotRemoval"],"optionStrengths":{}}'
INSUFFICIENT_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/enhancement-jobs/$J3ID/submit" -H "Authorization: Bearer $TOKEN_A")
assert_code "submit with zero balance rejected" 400 "$INSUFFICIENT_CODE"

LIST_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/enhancement-jobs" -H "Authorization: Bearer $TOKEN_A")
assert_code "list own requests" 200 "$LIST_CODE"

# ── Credits ──────────────────────────────────────────────────────────────
echo "--- Credits ---"
CREDITS_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/credits" -H "Authorization: Bearer $TOKEN_A")
assert_code "get credits summary" 200 "$CREDITS_CODE"

CHECKOUT_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/credits/checkout" -H "Authorization: Bearer $TOKEN_A" \
  -H 'Content-Type: application/json' -d '{"packId":"pack_10"}')
assert_code "credit pack checkout seam reports not-configured" 503 "$CHECKOUT_CODE"

BAD_PACK_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/credits/checkout" -H "Authorization: Bearer $TOKEN_A" \
  -H 'Content-Type: application/json' -d '{"packId":"not-a-pack"}')
assert_code "unknown credit pack rejected" 400 "$BAD_PACK_CODE"

# ── Admin gating ─────────────────────────────────────────────────────────
echo "--- Admin gating ---"
ADMIN_LIST_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/enhancement-jobs" -H "Authorization: Bearer $TOKEN_A")
assert_code "non-admin blocked from request monitor" 403 "$ADMIN_LIST_CODE"
ADMIN_OVERVIEW_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/enhancement-jobs/overview" -H "Authorization: Bearer $TOKEN_A")
assert_code "non-admin blocked from job tracker" 403 "$ADMIN_OVERVIEW_CODE"

# ── Final cleanup sweep + verification ──────────────────────────────────
echo "--- Final cleanup sweep ---"
curl -s -o /dev/null -X DELETE "$BASE/api/auth/me" -H "Authorization: Bearer $TOKEN_A"
curl -s -o /dev/null -X DELETE "$BASE/api/auth/me" -H "Authorization: Bearer $TOKEN_B"
PASS "final cleanup sweep ran (removed this run's smoketest- fixtures)"

# Proof the sweep worked: neither fixture account can log in anymore.
RELOGIN_A=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL_A\",\"password\":\"$PASSWORD\"}")
RELOGIN_B=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL_B\",\"password\":\"$PASSWORD\"}")
if [ "$RELOGIN_A" = "401" ] && [ "$RELOGIN_B" = "401" ]; then
  PASS "cleanup — no smoketest- fixtures visible anywhere"
else
  FAIL "cleanup — no smoketest- fixtures visible anywhere (relogin: $RELOGIN_A / $RELOGIN_B)"
fi

if [ "$FAILED" -eq 0 ]; then
  echo "ALL PASS"
  exit 0
else
  echo "SOME ASSERTIONS FAILED"
  exit 1
fi
