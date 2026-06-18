#!/usr/bin/env bash
set -uo pipefail

PROJ_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="/tmp/bridge_real_$$"
export BRIDGE_ROOT="$WORK/bus"
mkdir -p "$WORK" "$BRIDGE_ROOT"
cd "$WORK"

TOKEN="PING-${RANDOM}${RANDOM}"

# MCP server config
cat > "$WORK/mcp.json" <<EOF
{ "mcpServers": { "session-bridge": {
  "command": "node", "args": ["$PROJ_DIR/dist/server.js"] } } }
EOF

# settings with the auto-receive hook
cat > "$WORK/settings.json" <<EOF
{ "hooks": { "UserPromptSubmit": [ { "hooks": [ {
  "type": "command",
  "command": "node $PROJ_DIR/dist/hooks/recv.js" } ] } ] } }
EOF

COMMON=(--print --strict-mcp-config
  --mcp-config "$WORK/mcp.json"
  --settings "$WORK/settings.json"
  --allowed-tools "mcp__session-bridge__bridge_send" "mcp__session-bridge__bridge_recv")

echo "TOKEN=$TOKEN"
echo "=== [1] BACKEND session sends via bridge_send ==="
printf '%s' "Call the bridge_send tool exactly once with to='frontend' and body='${TOKEN}: GET /health returns {status, uptime}'. Then reply only with the word DONE." \
  | BRIDGE_PROJECT=demo BRIDGE_ROLE=backend \
    claude "${COMMON[@]}" \
    2>"$WORK/backend.err" | tee "$WORK/backend.out"

echo
echo "=== bus state after backend ==="
find "$BRIDGE_ROOT" -name '*.inbox.jsonl' -exec echo {} \; -exec cat {} \;

echo
echo "=== [2] FRONTEND session — recv hook should auto-inject the message ==="
printf '%s' "What messages, if any, did the session bridge deliver to you? Quote each verbatim. If none, say NONE." \
  | BRIDGE_PROJECT=demo BRIDGE_ROLE=frontend \
    claude "${COMMON[@]}" \
    2>"$WORK/frontend.err" | tee "$WORK/frontend.out"

echo
echo "=== VERDICT ==="
if grep -q "$TOKEN" "$WORK/frontend.out"; then
  echo "RESULT: PASS — frontend received the token sent by backend (auto-injected via hook)."
  RC=0
else
  echo "RESULT: FAIL — token not found in frontend output."
  echo "--- backend.err ---"; tail -5 "$WORK/backend.err"
  echo "--- frontend.err ---"; tail -5 "$WORK/frontend.err"
  RC=1
fi

rm -rf "$WORK"
exit $RC
