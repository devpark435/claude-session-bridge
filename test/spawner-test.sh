#!/usr/bin/env bash
# Deterministic spawner test: drives the daemon with a stub session (no Claude),
# verifies auto ping-pong happens AND that the loop guard bounds it.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="/tmp/bridge_spawn_$$"
export BRIDGE_ROOT="$WORK/bus"
mkdir -p "$BRIDGE_ROOT"
LOG="$WORK/spawner.log"

CLI="node $DIR/dist/cli.js"
STUB="$DIR/test/_stub-session.mjs"

# Pre-create both inboxes so the project dir is watched and cursors init to 0.
BRIDGE_PROJECT=demo BRIDGE_ROLE=frontend $CLI recv >/dev/null
BRIDGE_PROJECT=demo BRIDGE_ROLE=backend  $CLI recv >/dev/null

# Write spawner config: stub launcher, maxHops=4, both roles spawnable.
cat > "$BRIDGE_ROOT/spawner.config.json" <<EOF
{
  "enabled": true,
  "maxHops": 4,
  "rateLimitPerMinute": 60,
  "command": ["node", "$STUB"],
  "defaults": { "permissionMode": "acceptEdits" },
  "denyTools": ["Bash(git commit:*)"],
  "prompt": "test",
  "projects": { "demo": { "enabled": true, "roles": {
    "frontend": { "enabled": true, "cwd": "$WORK" },
    "backend":  { "enabled": true, "cwd": "$WORK" }
  } } }
}
EOF

# Start the daemon.
node "$DIR/dist/cli.js" spawner run >"$LOG" 2>&1 &
SPAWN_PID=$!
trap 'kill $SPAWN_PID 2>/dev/null; rm -rf "$WORK"' EXIT

# Wait for it to be watching.
for _ in $(seq 1 50); do grep -q "watching" "$LOG" && break; sleep 0.1; done

# Kick off: backend sends to frontend (hop 1).
BRIDGE_PROJECT=demo BRIDGE_ROLE=backend $CLI send frontend "kickoff: build the thing" >/dev/null

# Wait for the loop guard to fire (or time out).
for _ in $(seq 1 80); do grep -q "loop guard" "$LOG" && break; sleep 0.1; done
sleep 0.5  # let any final exit settle

kill $SPAWN_PID 2>/dev/null
wait $SPAWN_PID 2>/dev/null

echo "===== spawner log ====="
cat "$LOG"

echo
echo "===== bus messages (project demo) ====="
FRONT=$(BRIDGE_PROJECT=demo BRIDGE_ROLE=inspector $CLI tail 100 2>/dev/null)
for role in frontend backend; do
  echo "--- $role inbox ---"
  cat "$BRIDGE_ROOT/demo/$role.inbox.jsonl" 2>/dev/null
done

echo
echo "===== VERDICT ====="
SPAWNS=$(grep -c "^\[spawner\] spawn " "$LOG")
GUARD=$(grep -c "loop guard" "$LOG")
MAXHOP=$(cat "$BRIDGE_ROOT"/demo/*.inbox.jsonl 2>/dev/null | node -e 'let m=0,d="";process.stdin.on("data",c=>d+=c).on("end",()=>{d.split("\n").filter(Boolean).forEach(l=>{try{m=Math.max(m,JSON.parse(l).hop||0)}catch{}});console.log(m)})')

echo "spawns=$SPAWNS  loop_guard_hits=$GUARD  max_hop=$MAXHOP"
RC=0
[ "$GUARD" -ge 1 ] || { echo "FAIL: loop guard never fired"; RC=1; }
[ "$MAXHOP" -le 4 ] || { echo "FAIL: hop exceeded maxHops"; RC=1; }
[ "$SPAWNS" -ge 2 ] || { echo "FAIL: ping-pong did not occur (expected >=2 spawns)"; RC=1; }
[ "$SPAWNS" -le 6 ] || { echo "FAIL: runaway spawning"; RC=1; }
[ $RC -eq 0 ] && echo "RESULT: PASS — auto ping-pong ran and the loop guard bounded it."
exit $RC
