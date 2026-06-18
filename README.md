# claude-session-bridge-mcp

A tiny **MCP message bus** that lets multiple Claude Code sessions in the same
project talk to each other. Finish work in your **backend** session, push the
result, and your **frontend** session picks it up automatically on its next
turn — no more copy-pasting API shapes and schema changes between terminals.

- **Addressing:** every session is a `(project, role)`. Messages route by role
  and are isolated by project — project `A` can never read project `B`.
- **Send = deliberate:** the model calls `bridge_send` to share a *result*
  worth reusing (an API shape, a generated type, a decision), not a transcript.
- **Receive = automatic:** a `UserPromptSubmit` hook injects unread messages
  into the receiving session at the start of its next turn.

Two modes:

- **Bus only (default):** a session sees new messages on its *next* turn (the
  recv hook injects them). You stay in the loop.
- **Event spawner (opt-in daemon):** new messages *wake* the target role —
  the spawner launches a `claude -p` session to act on them automatically,
  enabling hands-off backend↔frontend ping-pong. See
  [Event spawner](#event-spawner-auto-wake--ping-pong).

---

## How it works

```
~/.claude/bridge/
  <project>/
    <role>.inbox.jsonl     append-only log of messages for that role
    .cursors/<role>.cursor how many lines that role has already consumed
```

- `bridge_send(to, body)` appends an envelope to the recipient role's inbox
  (`to: "*"` broadcasts to every other role in the project).
- The recv hook reads your own inbox from your cursor forward, injects the new
  messages, and advances the cursor — so you never see a message twice.

Envelope:

```json
{ "id": "uuid", "project": "myapp", "from": "backend",
  "to": "frontend", "ts": 1700000000000, "body": "GET /users returns {...}" }
```

---

## Install

```bash
git clone <this-repo> claude-session-bridge-mcp
cd claude-session-bridge-mcp
npm install
npm run build
```

This produces `dist/server.js` (MCP server), `dist/cli.js` (CLI), and
`dist/hooks/recv.js` (auto-receive hook).

### 1. Register the MCP server

Add to `~/.claude/settings.json` (or a project `.claude/settings.json`). Use an
**absolute path** to the built server:

```json
{
  "mcpServers": {
    "session-bridge": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/claude-session-bridge-mcp/dist/server.js"]
    }
  }
}
```

The server reads its identity from the environment of the launching session, so
no per-project config is needed here.

### 2. Install the auto-receive hook

Add to the same `settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /ABSOLUTE/PATH/claude-session-bridge-mcp/dist/hooks/recv.js"
          }
        ]
      }
    ]
  }
}
```

The hook **no-ops silently** in any session that isn't bridged, so it's safe to
install globally.

---

## Use it

Launch each terminal with a `(project, role)` identity:

```bash
# terminal 1 — backend of project "myapp"
BRIDGE_PROJECT=myapp BRIDGE_ROLE=backend claude

# terminal 2 — frontend of project "myapp"
BRIDGE_PROJECT=myapp BRIDGE_ROLE=frontend claude
```

Now, in the **backend** session, when you have a result worth sharing:

> "Send the new /users response shape to the frontend session."

Claude calls `bridge_send(to: "frontend", body: "...")`. The next time you type
anything in the **frontend** session, the message is injected automatically.

Run a second project at the same time — it's fully isolated:

```bash
BRIDGE_PROJECT=otherapp BRIDGE_ROLE=frontend claude   # never sees myapp traffic
```

### Tools exposed to the model

| Tool | What it does |
|------|--------------|
| `bridge_send(to, body)` | Send a message to a role, or `"*"` to broadcast |
| `bridge_recv()` | Pull + consume unread messages |
| `bridge_peek()` | Preview unread without consuming |
| `bridge_tail(limit?)` | Inspect recent inbox messages |
| `bridge_roles()` | List roles registered in the project |
| `bridge_whoami()` | Show this session's identity |

---

## Optional: auto-send on every turn

Off by default (deliberate `bridge_send` is recommended). To broadcast each
session's last message automatically, set `BRIDGE_AUTOSEND=1` and install the
Stop hook:

```bash
BRIDGE_PROJECT=myapp BRIDGE_ROLE=backend BRIDGE_AUTOSEND=1 claude
```

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command",
        "command": "node /ABSOLUTE/PATH/claude-session-bridge-mcp/dist/hooks/send.js" } ] }
    ]
  }
}
```

Destination is `"*"` by default; override with `BRIDGE_SEND_TO=frontend`.
Note this shares the full last message every turn — noisier and more tokens
than deliberate sends.

---

## Event spawner (auto-wake / ping-pong)

The bus alone is request/response — an idle session won't act on a new message
until its next turn. The **event spawner** is a daemon that watches the bus and,
when a role gets new messages, launches a `claude -p` session for that role to
process them. The spawned session receives the messages via the recv hook, does
the work, and may reply with `bridge_send` — so backend and frontend can
ping-pong with no human in the loop.

### Configure (safe by default)

A role is **only spawnable once it has a working directory**, so out of the box
the spawner does nothing until you opt each role in:

```bash
# tell the spawner where each role's code lives
session-bridge spawner set myapp backend  cwd=/path/to/backend
session-bridge spawner set myapp frontend cwd=/path/to/frontend model=sonnet

session-bridge spawner on            # enable globally
session-bridge spawner off myapp     # ...or per project
session-bridge spawner off myapp backend   # ...or per role
session-bridge spawner status        # inspect current config
```

### Run the daemon

```bash
session-bridge spawner run           # foreground; Ctrl-C to stop
# background it yourself if you like:
nohup session-bridge spawner run > ~/.claude/bridge/spawner.log 2>&1 &
```

Config (`<BRIDGE_ROOT>/spawner.config.json`) is re-read on every event, so
toggles take effect live — no restart needed.

### Safety rails

| Rail | Default | Purpose |
|------|---------|---------|
| `maxHops` | 6 | Loop guard. Each bridge step increments a message `hop`; spawning stops once it reaches the cap. Bounds runaway ping-pong. |
| `rateLimitPerMinute` | 12 | Max spawns per `(project, role)` per minute. |
| `denyTools` | `git commit`, `git push`, `git reset` | Always passed as `--disallowed-tools`. Spawned sessions **cannot commit or push.** |
| single-flight | — | At most one live spawn per `(project, role)`; re-checks on completion. |
| cwd required | — | A role with no configured cwd is never spawned. |

### Preventing auto-commits

You asked specifically that auto-driven sessions never commit. There are two
layers — use both:

1. **Hard block (enforced):** the spawner always launches sessions with
   `--disallowed-tools "Bash(git commit:*)" "Bash(git push:*)" ...`. Deny rules
   beat allow/bypass in Claude Code, so the model **physically cannot** commit
   or push, even in `bypassPermissions` mode. This is the reliable guarantee.
2. **Soft reminder (good practice):** still add a line to each project's
   `CLAUDE.md`, e.g. *"Do not git commit or push — the user commits manually
   after their own testing."* This keeps the intent visible to any session,
   bridged or not.

> Relying on `CLAUDE.md` alone is **not** enough for autonomous loops — a model
> can drift. The deny rules are what actually stop it.

### Permissions vs. autonomy

For a spawned session to do real work unattended it needs tool permissions.
`permissionMode` defaults to `acceptEdits` (auto-approve file edits). For fuller
autonomy set it to `bypassPermissions` per role — the `denyTools` block still
holds:

```bash
session-bridge spawner set myapp backend permissionMode=bypassPermissions
```

Only do this for sandboxes/workspaces you trust.

## CLI (debugging)

```bash
BRIDGE_PROJECT=myapp BRIDGE_ROLE=cli session-bridge roles
BRIDGE_PROJECT=myapp BRIDGE_ROLE=cli session-bridge send frontend "hello"
BRIDGE_PROJECT=myapp BRIDGE_ROLE=cli session-bridge tail 20
session-bridge root      # print bus directory
```

## Environment variables

| Var | Required | Default | Meaning |
|-----|----------|---------|---------|
| `BRIDGE_PROJECT` | yes | — | Project namespace (isolation boundary) |
| `BRIDGE_ROLE` | yes | — | This session's role |
| `BRIDGE_ROOT` | no | `~/.claude/bridge` | Bus storage directory |
| `BRIDGE_AUTOSEND` | no | off | `1` enables the Stop auto-send hook |
| `BRIDGE_SEND_TO` | no | `*` | Default recipient for auto-send |
| `BRIDGE_HOP` | no | `0` | Loop-guard hop of the message this session is handling (set by the spawner; replies are stamped `hop+1`) |

## License

MIT
