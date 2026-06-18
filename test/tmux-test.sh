#!/usr/bin/env bash
# Deterministic test of the tmux DRIVER: a stub `tmux` simulates live sessions,
# so we verify auto ping-pong runs AND the per-project chain loop guard bounds it
# (the live-session driver can't carry the hop counter — the daemon must guard).
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="/tmp/bridge_tmux_$$"
export BRIDGE_ROOT="$WORK/bus"
mkdir -p "$BRIDGE_ROOT"
LOG="$WORK/spawner.log"
CLI="node $DIR/dist/cli.js"
STUB="$DIR/test/_tmux-stub.mjs"

# Pre-create both inboxes so the project dir is watched and cursors init to 0.
BRIDGE_PROJECT=demo BRIDGE_ROLE=frontend $CLI recv >/dev/null
BRIDGE_PROJECT=demo BRIDGE_ROLE=backend  $CLI recv >/dev/null

cat > "$BRIDGE_ROOT/spawner.config.json" <<EOF
{
  "enabled": true,
  "driver": "tmux",
  "tmuxCommand": ["node", "$STUB"],
  "idleResetSeconds": 999,
  "cooldownSeconds": 0,
  "maxHops": 4,
  "rateLimitPerMinute": 100,
  "projects": { "demo": { "enabled": true, "roles": {
    "frontend": { "enabled": true, "tmuxTarget": "demo:frontend" },
    "backend":  { "enabled": true, "tmuxTarget": "demo:backend" }
  } } }
}
EOF

node "$DIR/dist/cli.js" spawner run >"$LOG" 2>&1 &
SPAWN_PID=$!
trap 'kill $SPAWN_PID 2>/dev/null; rm -rf "$WORK"' EXIT

for _ in $(seq 1 50); do grep -q "watching" "$LOG" && break; sleep 0.1; done
grep -q "driver=tmux" "$LOG" || { echo "FAIL: driver not tmux"; cat "$LOG"; exit 1; }

# Kick off: backend -> frontend.
BRIDGE_PROJECT=demo BRIDGE_ROLE=backend $CLI send frontend "kickoff" >/dev/null

for _ in $(seq 1 80); do grep -q "loop guard" "$LOG" && break; sleep 0.1; done
sleep 0.4
kill $SPAWN_PID 2>/dev/null; wait $SPAWN_PID 2>/dev/null

echo "===== spawner log ====="
cat "$LOG"

echo
echo "===== VERDICT ====="
NUDGES=$(grep -c "^\[spawner\] nudge " "$LOG")
GUARD=$(grep -c "loop guard" "$LOG")
echo "tmux_nudges=$NUDGES  loop_guard_hits=$GUARD"
RC=0
[ "$GUARD" -ge 1 ] || { echo "FAIL: chain loop guard never fired"; RC=1; }
[ "$NUDGES" -ge 2 ] || { echo "FAIL: ping-pong did not occur via tmux driver"; RC=1; }
[ "$NUDGES" -le 5 ] || { echo "FAIL: runaway nudging (chain guard ineffective)"; RC=1; }
[ $RC -eq 0 ] && echo "RESULT: PASS — tmux driver drove auto ping-pong; chain guard bounded it."
exit $RC
