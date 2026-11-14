#!/bin/bash
# Runs the whole test suite:  tests/run.sh [browser-test-name-filter]
#   1. static checks  (tests/static_checks.py -- also what CI runs)
#   2. browser tests  (tests/cases.js in headless WebKit; macOS only)
# Nothing here talks to the real Supabase project.
set -u
cd "$(dirname "$0")/.."
python3 build.py >/dev/null || exit 1
status=0
if [ -f tests/static_checks.py ] && [ -z "${1:-}" ]; then python3 tests/static_checks.py || status=1; fi
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
python3 tests/server.py "$PORT" 2>/dev/null & SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for i in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/__test/log" && break; sleep 0.1; done
export TESTS_DIR="$PWD/tests"
pass=0; fail=0
while IFS=$'\t' read -r idx name; do
  [ "${1:-}" = "sw" ] && continue   # "sw" = only the service-worker run below
  case "$name" in *"${1:-}"*) ;; *) continue ;; esac
  out=$(osascript -l JavaScript tests/runner.js "$PORT" "$idx" 2>&1)
  # the scripting bridge occasionally dies on its own (not a test failure): one retry
  if ! echo "$out" | grep -q -E '^(ok|FAIL)  '; then out=$(osascript -l JavaScript tests/runner.js "$PORT" "$idx" 2>&1); fi
  if ! echo "$out" | grep -q -E '^(ok|FAIL)  '; then out="FAIL  $name
        runner crashed: $(echo "$out" | tail -1 | cut -c1-200)"; fi
  echo "$out"
  pass=$((pass + $(echo "$out" | grep -c '^ok  ')))
  fail=$((fail + $(echo "$out" | grep -c '^FAIL  ')))
done < <(osascript -l JavaScript tests/runner.js "$PORT" list)
echo
echo "browser tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || status=1
[ "$pass" -gt 0 ] || [ "${1:-}" = "sw" ] || status=1

# 3. service worker, in headless Chrome (needs Google Chrome; skipped with a note if absent)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ -z "${1:-}" ] || [ "${1:-}" = "sw" ]; then
  if [ -x "$CHROME" ]; then
    PROFILE=$(mktemp -d)
    "$CHROME" --headless=new --user-data-dir="$PROFILE" --no-first-run --disable-gpu --disable-extensions \
      --host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1" \
      "http://127.0.0.1:$PORT/__test/sw_harness.html" >/dev/null 2>&1 & CHROME_PID=$!
    report=""
    for i in $(seq 240); do
      report=$(curl -s "http://127.0.0.1:$PORT/__test/report"); [ -n "$report" ] && break; sleep 0.5
    done
    kill $CHROME_PID 2>/dev/null; wait $CHROME_PID 2>/dev/null; rm -rf "$PROFILE"
    echo
    if [ -z "$report" ]; then echo "FAIL  service worker run produced no report"; status=1
    else
      echo "$report" | python3 -c 'import json,sys; [print(x) for x in json.load(sys.stdin)]'
      n_fail=$(echo "$report" | python3 -c 'import json,sys; print(sum(x.startswith("FAIL") for x in json.load(sys.stdin)))')
      n_ok=$(echo "$report" | python3 -c 'import json,sys; print(sum(x.startswith("ok") for x in json.load(sys.stdin)))')
      echo; echo "service worker: $n_ok passed, $n_fail failed"
      [ "$n_fail" -eq 0 ] || status=1
    fi
  else
    echo; echo "service worker: SKIPPED (Google Chrome not installed)"
  fi
fi
exit $status
