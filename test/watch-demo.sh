#!/usr/bin/env bash
# WATCH THE BRIDGE LIVE. Run this in YOUR terminal:
#     bash test/watch-demo.sh
#
# Opens a tmux window with three panes you can watch in real time:
#   left        = frontend  (real Claude session)
#   top-right   = backend   (real Claude session)
#   bottom-right= the spawner daemon (shows each tmux send-keys nudge)
# After ~14s it auto-sends a kickoff message; watch the two sessions ping-pong.
#
# Costs a little: real Claude turns (uses the Haiku model to keep it cheap).
# Safe: only the bridge tools are allowed, git commit/push is blocked, and the
# loop guard stops it after maxHops. Detach with Ctrl-b then d; the session and
# daemon are torn down on exit.
set -uo pipefail

command -v tmux  >/dev/null || { echo "Need tmux.";  exit 1; }
CLAUDE=$(command -v claude) || { echo "Need claude."; exit 1; }
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Building..."; (cd "$DIR" && npm run build >/dev/null 2>&1) || { echo "build failed"; exit 1; }

export BRIDGE_ROOT="/tmp/bridge-watch-demo"
rm -rf "$BRIDGE_ROOT"; mkdir -p "$BRIDGE_ROOT"

cat > "$BRIDGE_ROOT/mcp.json" <<EOF
{ "mcpServers": { "session-bridge": { "command": "node", "args": ["$DIR/dist/server.js"] } } }
EOF
cat > "$BRIDGE_ROOT/settings.json" <<EOF
{ "hooks": {
  "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "node $DIR/dist/hooks/recv.js" } ] } ],
  "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "node $DIR/dist/hooks/block-git.js" } ] } ]
} }
EOF
cat > "$BRIDGE_ROOT/spawner.config.json" <<EOF
{ "enabled": true, "driver": "tmux", "tmuxCommand": ["tmux"],
  "idleResetSeconds": 999, "cooldownSeconds": 6, "maxHops": 6, "rateLimitPerMinute": 100,
  "nudgePrompt": "You received a session-bridge message (shown above). Reply to its sender using ONLY the bridge_send tool, one short sentence. Do not edit files or run shell commands.",
  "projects": { "demo": { "enabled": true, "roles": {
    "frontend": { "enabled": true }, "backend": { "enabled": true } } } } }
EOF

CL="$CLAUDE --model haiku --mcp-config $BRIDGE_ROOT/mcp.json --settings $BRIDGE_ROOT/settings.json --strict-mcp-config --allowed-tools mcp__session-bridge__bridge_send mcp__session-bridge__bridge_recv"
SES="bridge-watch"

tmux kill-session -t "$SES" 2>/dev/null
tmux new-session  -d -s "$SES" -x 240 -y 60 -c "$DIR" \
  "BRIDGE_ROOT=$BRIDGE_ROOT BRIDGE_PROJECT=demo BRIDGE_ROLE=frontend $CL"
tmux split-window -h -t "$SES" -c "$DIR" \
  "BRIDGE_ROOT=$BRIDGE_ROOT BRIDGE_PROJECT=demo BRIDGE_ROLE=backend $CL"
tmux split-window -v -t "$SES:0.1" \
  "BRIDGE_ROOT=$BRIDGE_ROOT node $DIR/dist/cli.js spawner run"
tmux select-pane -t "$SES:0.0"

# Auto-send the kickoff once the sessions have booted.
( sleep 14
  BRIDGE_ROOT=$BRIDGE_ROOT BRIDGE_PROJECT=demo BRIDGE_ROLE=backend \
    node "$DIR/dist/cli.js" send frontend \
    "Hi frontend, the /users API now returns {id,name,email}. Acknowledge and say you'll integrate." >/dev/null 2>&1
) &

echo "Attaching — watch the panes. (kickoff fires in ~14s)  Detach: Ctrl-b then d"
sleep 1
tmux attach -t "$SES"
# on exit, tear everything down
tmux kill-session -t "$SES" 2>/dev/null
rm -rf "$BRIDGE_ROOT"
echo "demo cleaned up."
