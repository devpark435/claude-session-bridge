#!/usr/bin/env bash
# Real-tmux integration test (no Claude auth/quota): REAL tmux + REAL daemon +
# REAL `tmux send-keys`. Only the in-pane "session" is a stub. Validates the
# tmux-driver plumbing the unit test stubs out. Requires tmux.
set -uo pipefail

command -v tmux >/dev/null || { echo "SKIP: tmux not installed"; exit 0; }

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STUB="$DIR/test/_live-stub.mjs"
export BRIDGE_ROOT="/tmp/rtmux_$$/bus"
mkdir -p "$BRIDGE_ROOT"
SES="bridgedemo_$$"; LOG="/tmp/rtmux_$$/daemon.log"

cat > "$BRIDGE_ROOT/spawner.config.json" <<EOF
{ "enabled": true, "driver": "tmux", "tmuxCommand": ["tmux"],
  "idleResetSeconds": 999, "cooldownSeconds": 0, "maxHops": 4, "rateLimitPerMinute": 100,
  "projects": { "demo": { "enabled": true, "roles": {
    "frontend": { "enabled": true }, "backend": { "enabled": true } } } } }
EOF

tmux kill-session -t "$SES" 2>/dev/null
tmux new-session -d -s "$SES" -x 200 -y 50 \
  "BRIDGE_ROOT=$BRIDGE_ROOT BRIDGE_PROJECT=demo BRIDGE_ROLE=frontend node $STUB"
tmux split-window -t "$SES" \
  "BRIDGE_ROOT=$BRIDGE_ROOT BRIDGE_PROJECT=demo BRIDGE_ROLE=backend node $STUB"

for _ in $(seq 1 30); do
  [ -f "$BRIDGE_ROOT/demo/.sessions/frontend.pane" ] && [ -f "$BRIDGE_ROOT/demo/.sessions/backend.pane" ] && break
  sleep 0.1
done

node "$DIR/dist/cli.js" spawner run >"$LOG" 2>&1 &
PID=$!
for _ in $(seq 1 40); do grep -q watching "$LOG" && break; sleep 0.1; done

BRIDGE_PROJECT=demo BRIDGE_ROLE=backend node "$DIR/dist/cli.js" send frontend "kickoff" >/dev/null
for _ in $(seq 1 80); do grep -q "loop guard" "$LOG" && break; sleep 0.1; done
sleep 0.6
kill $PID 2>/dev/null; wait $PID 2>/dev/null
tmux kill-session -t "$SES" 2>/dev/null

NUDGES=$(grep -c "nudge " "$LOG")
ACKS=$(grep -rh "live-ack" "$BRIDGE_ROOT"/demo/*.inbox.jsonl 2>/dev/null | wc -l | tr -d ' ')
echo "real-tmux nudges=$NUDGES  live-acks=$ACKS"
RC=0
grep -q "loop guard" "$LOG" || { echo "FAIL: loop guard never fired"; RC=1; }
[ "$NUDGES" -ge 2 ] || { echo "FAIL: no ping-pong via real tmux"; RC=1; }
[ "$ACKS" -ge 2 ] || { echo "FAIL: panes did not act on real send-keys"; RC=1; }
rm -rf "/tmp/rtmux_$$"
[ $RC -eq 0 ] && echo "RESULT: PASS — real tmux send-keys drove real panes; chain guard bounded it."
exit $RC
