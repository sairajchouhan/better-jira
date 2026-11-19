#!/bin/zsh
# Verification instance of better-jira that writes only to the personal Jira (cloudsairaj). See SKILL.md.
#   verify.sh up [port]      build to dist/verify, start it in a Rex window, wait until it is usable
#   verify.sh doctor         read-only: is the running instance ours, current, on cloudsairaj and writable?
#   verify.sh jira <path>    read-only GET on cloudsairaj's REST API, prints JSON (e.g. /rest/api/3/issue/SAM1-2)
#   verify.sh evidence <id>  makes and prints a run's evidence folder (kept by `down`)
#   verify.sh down           stops the instance this script started and removes its build and cache
set -u
SELF=${0:A}
cd "${SELF:h}/../../.." || exit 1
SITE=https://cloudsairaj.atlassian.net
REX_SESSION=${REX_SESSION:-session:01a1e801-0f1c-7df2-846a-a068595cbad8}
STATE=.raj/tmp/verify/instance
EVIDENCE=.raj/tmp/verify/runs

fail() { print -u2 "verify: $*"; exit 1; }
field() { [ -f $STATE ] && sed -n "s/^$1=//p" $STATE; }
client() { curl -s --max-time 5 "localhost:$1/api/client"; }

case "${1:-}" in
up)
  port=${2:-3031}
  [ -f $STATE ] && fail "an instance is already recorded on port $(field port). Run doctor, or down first."
  lsof -iTCP:$port -sTCP:LISTEN >/dev/null && fail "port $port is taken by a process this script didn't start. Pick another: verify.sh up <port>"
  [[ $port == 3000 || $port == 3002 || $port == 6000 ]] && fail "port $port is reserved."
  bun scripts/build-server.ts src/server/index.ts dist/verify >/dev/null || fail "build failed: run bun scripts/build-server.ts src/server/index.ts dist/verify to see why."
  build=$(git rev-parse --short HEAD)$(jj diff --stat 2>/dev/null | grep -q 'file' && print '+changes')
  mkdir -p ${STATE:h}
  # Shell env beats --env-file: the instance is production, on its own port and cache, and may write to cloudsairaj only.
  window=$(rex window new -s $REX_SESSION verify-$port -c $PWD --keep-open --focus=false --json -- \
    env NODE_ENV=production PORT=$port JIRA_WRITES=$SITE JIRA_CACHE=dist/verify/cache.db \
    bun --env-file=.env.personal dist/verify/index.js | python3 -c 'import sys,json;print(json.load(sys.stdin)["window_id"])') ||
    fail "rex couldn't open a window in $REX_SESSION. Set REX_SESSION to a session from: rex session list"
  for i in {1..90}; do
    pid=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null | head -1)
    [ -n "$pid" ] && [ "$(curl -s --max-time 5 localhost:$port/api/issues | head -c 2)" = '[{' ] && break
    /bin/sleep 1
  done
  [ -z "${pid:-}" ] && { rex window close -s $REX_SESSION $window >/dev/null 2>&1; fail "no server on $port after 90 s. Its output: rex window read -s $REX_SESSION verify-$port"; }
  print "port=$port\npid=$pid\nwindow=$window\nbuild=$build\nbuilt=$(date +%s)" > $STATE
  print "up: http://localhost:$port (pid $pid, build $build, Rex window verify-$port)"
  exec $SELF doctor
  ;;
doctor)
  port=$(field port); pid=$(field pid)
  [ -n "$port" ] || fail "no instance recorded. Start one: verify.sh up"
  listener=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null | head -1)
  [ "$listener" = "$pid" ] || fail "port $port is held by pid '${listener:-none}', not our pid $pid. Run verify.sh down, then up."
  c=$(client $port)
  site=$(print -r -- "$c" | python3 -c 'import sys,json;print(json.load(sys.stdin)["site"])' 2>/dev/null)
  writable=$(print -r -- "$c" | python3 -c 'import sys,json;print(json.load(sys.stdin)["writable"])' 2>/dev/null)
  [ "$site" = "$SITE" ] || fail "instance is on '$site', not $SITE. Stop and do not drive it: verify.sh down"
  [ "$writable" = "True" ] || fail "instance can't write to Jira (writable=$writable)."
  issues=$(curl -s --max-time 10 localhost:$port/api/issues | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))' 2>/dev/null)
  [ "${issues:-0}" -gt 0 ] || fail "instance answers but holds no issues yet: still syncing, or JIRA_BOARDS is empty."
  stale=$(find src -newer $STATE -type f | head -1)
  [ -n "$stale" ] && print "doctor: WARNING build is older than $stale. Proofs of new code need: verify.sh down && verify.sh up"
  print "doctor: ok http://localhost:$port site=$site writable issues=$issues build=$(field build)"
  ;;
jira)
  [ -n "${2:-}" ] || fail "usage: verify.sh jira /rest/api/3/issue/<KEY>"
  bun --env-file=.env.personal -e '
    const site = process.env.JIRA_URL ?? "", path = process.argv.at(-1);
    if (new URL(site).hostname !== "cloudsairaj.atlassian.net") { console.error(`verify: refusing ${new URL(site).hostname}`); process.exit(2); }
    const auth = btoa(`${process.env.JIRA_EMAIL}:${process.env.JIRA_TOKEN}`);
    const r = await fetch(site.replace(/\/$/, "") + path, { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } });
    console.log(JSON.stringify(await r.json().catch(() => ({ status: r.status })), null, 1));
    if (!r.ok) process.exit(1);' "$2"
  ;;
evidence)
  [ -n "${2:-}" ] || fail "usage: verify.sh evidence <run-id>"
  mkdir -p $EVIDENCE/$2 && print ${PWD}/$EVIDENCE/$2
  ;;
down)
  port=$(field port); pid=$(field pid); window=$(field window)
  [ -n "$port" ] || { print "down: nothing recorded"; exit 0; }
  [ -n "$window" ] && rex window close -s $REX_SESSION $window >/dev/null 2>&1
  [ "$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null | head -1)" = "$pid" ] && kill $pid
  rm -rf dist/verify $STATE
  print "down: stopped port $port; evidence kept in $PWD/$EVIDENCE"
  ;;
*) sed -n "2,8p" $SELF; exit 2 ;;
esac
