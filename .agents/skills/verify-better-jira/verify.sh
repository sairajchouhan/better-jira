#!/bin/zsh
# better-jira on the personal sandbox Jira (`instances/personal`), writing for real. See SKILL.md.
#   verify.sh doctor         read-only: is the instance ours, current, on the sandbox Jira and writable? (:3002 in main checkout)
#   verify.sh jira <path>    read-only GET on the sandbox Jira's REST API, prints JSON (e.g. /rest/api/3/issue/SAM1-2)
#   verify.sh evidence <id>  makes and prints a run's evidence folder
#   verify.sh up [port]      worktree only: build this checkout and start it in a Rex window on port 3031, wait until usable
#   verify.sh down           worktree only: stop the instance `up` started and remove its build and cache
set -u
SELF=${0:A}
cd "${SELF:h}/../../.." || exit 1
PERSONAL_HOME=${REAL_JIRA_HOME:-instances/personal}
SITE=${REAL_JIRA_SITE:-$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("site",""))' "$PERSONAL_HOME/settings.json" 2>/dev/null)}
REX_SESSION=${REX_SESSION:-}
STATE=.raj/tmp/verify/instance
EVIDENCE=.raj/tmp/verify/runs
BUILD=dist/personal/index.js

fail() { print -u2 "verify: $*"; exit 1; }
field() { [ -f $STATE ] && sed -n "s/^$1=//p" $STATE; }
client() { curl -s --max-time 5 "localhost:$1/api/client"; }
worktree_only() { [ -f .git ] || fail "this is the main checkout: drive :3002 (bun start personal) directly, and restart it there for new code. $1 is for worktrees."; }

case "${1:-}" in
up)
  worktree_only up
  port=${2:-3031}
  [ -f $STATE ] && fail "an instance is already recorded on port $(field port). Run doctor, or down first."
  [[ $port == 3000 || $port == 3002 || $port == 3003 || $port == 6000 ]] && fail "port $port is reserved."
  lsof -iTCP:$port -sTCP:LISTEN >/dev/null && fail "port $port is taken by a process this script didn't start. Pick another: verify.sh up <port>"
  build=$(git rev-parse --short HEAD)$(git status --porcelain | grep -q . && print '+changes')
  mkdir -p ${STATE:h}
  # Its own port and cache, writes to the sandbox site only, built to dist/personal (scripts/personal-jira.ts serve).
  [ -n "$REX_SESSION" ] || fail "set REX_SESSION to a session from: rex session list"
  window=$(rex window new -s $REX_SESSION verify-$port -c $PWD --keep-open --focus=false --json -- \
    bun scripts/personal-jira.ts serve $port dist/verify-cache.db dist/personal | python3 -c 'import sys,json;print(json.load(sys.stdin)["window_id"])') ||
    fail "rex couldn't open a window in $REX_SESSION. Set REX_SESSION to a session from: rex session list"
  for i in {1..180}; do
    pid=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null | head -1)
    [ -n "$pid" ] && [ "$(curl -s --max-time 5 localhost:$port/api/issues | head -c 2)" = '[{' ] && break
    /bin/sleep 1
  done
  [ -z "${pid:-}" ] && { rex window close -s $REX_SESSION $window >/dev/null 2>&1; fail "no server on $port after 180 s (build or start failed). Its output: rex window read -s $REX_SESSION verify-$port"; }
  print "port=$port\npid=$pid\nwindow=$window\nbuild=$build" > $STATE
  print "up: http://localhost:$port (pid $pid, build $build, Rex window verify-$port)"
  exec $SELF doctor
  ;;
doctor)
  if [ -f .git ]; then
    port=$(field port); pid=$(field pid)
    [ -n "$port" ] || fail "no instance recorded in this worktree. Start one: verify.sh up"
    listener=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null | head -1)
    [ "$listener" = "$pid" ] || fail "port $port is held by pid '${listener:-none}', not our pid $pid. Run verify.sh down, then up."
    redo="verify.sh down && verify.sh up"
  else
    port=3002
    lsof -iTCP:$port -sTCP:LISTEN >/dev/null || fail "nothing listens on :3002. Ask the main session to start bun start personal."
    redo="a restart of :3002 (bun start personal)"
  fi
  c=$(client $port)
  site=$(print -r -- "$c" | python3 -c 'import sys,json;print(json.load(sys.stdin)["site"])' 2>/dev/null)
  writable=$(print -r -- "$c" | python3 -c 'import sys,json;print(json.load(sys.stdin)["writable"])' 2>/dev/null)
  [ "$site" = "$SITE" ] || fail ":$port is on '$site', not $SITE. Stop and do not drive it."
  [ "$writable" = "True" ] || fail ":$port can't write to Jira (writable=$writable)."
  issues=$(curl -s --max-time 10 localhost:$port/api/issues | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))' 2>/dev/null)
  [ "${issues:-0}" -gt 0 ] || fail ":$port answers but holds no issues yet: still syncing, or no boards are chosen."
  stale=$( [ -f $BUILD ] && find src -newer $BUILD -type f | head -1)
  [ -f $BUILD ] || stale="(no $BUILD)"
  [ -n "$stale" ] && print "doctor: WARNING the build is older than $stale. Proofs of new code need $redo"
  print "doctor: ok http://localhost:$port site=$site writable issues=$issues${pid:+ pid=$pid build=$(field build)}"
  ;;
jira)
  [ -n "${2:-}" ] || fail "usage: verify.sh jira /rest/api/3/issue/<KEY>"
  bun scripts/personal-jira.ts get "$2"
  ;;
evidence)
  [ -n "${2:-}" ] || fail "usage: verify.sh evidence <run-id>"
  mkdir -p $EVIDENCE/$2 && print ${PWD}/$EVIDENCE/$2
  ;;
down)
  worktree_only down
  port=$(field port); pid=$(field pid); window=$(field window)
  [ -n "$port" ] || { print "down: nothing recorded"; exit 0; }
  [ "$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null | head -1)" = "$pid" ] && kill $pid
  [ -n "$window" ] && rex window close -s $REX_SESSION $window >/dev/null 2>&1
  rm -rf dist/personal dist/verify-cache.db dist/verify-cache.db-wal dist/verify-cache.db-shm $STATE
  print "down: stopped port $port; evidence kept in $PWD/$EVIDENCE"
  ;;
*) sed -n "2,7p" $SELF; exit 2 ;;
esac
