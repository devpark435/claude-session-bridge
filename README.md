<div align="center">

[![English](https://img.shields.io/badge/English-2ea44f?style=for-the-badge)](README.md)
[![한국어](https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-555?style=for-the-badge)](README.ko.md)
[![中文](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-555?style=for-the-badge)](README.zh.md)
[![日本語](https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-555?style=for-the-badge)](README.ja.md)

[![npm version](https://img.shields.io/npm/v/claude-session-bridge?color=cb3837&logo=npm)](https://www.npmjs.com/package/claude-session-bridge)
[![license](https://img.shields.io/npm/l/claude-session-bridge)](https://github.com/devpark435/claude-session-bridge)

</div>

# claude-session-bridge-mcp

**Let two (or more) Claude Code sessions talk to each other — and optionally
orchestrate themselves.**

You open one Claude Code session for your **backend** and another for your
**frontend**. Normally they know nothing about each other — when the backend
changes an API, you copy-paste the result into the frontend session by hand.

This tool removes the copy-paste. A session **sends** its result; sibling
sessions **receive** it automatically. Turn on the optional auto mode and a
finished backend can **wake** the frontend to react — hands-off ping-pong —
while you keep full control of the safety rails (no auto-commits, deploy gates,
loop guards) and change every setting from inside Claude.

> New here? Read top to bottom — every command is included. You don't need to
> understand the internals to use it.

---

## Table of contents

- [How to picture it](#how-to-picture-it)
- [Requirements](#requirements)
- [Install (one time)](#install-one-time)
- [Connect two sessions](#connect-two-sessions)
  - [Two ways to set the variables](#two-ways-to-set-the-variables)
  - [Using tmux](#using-tmux)
- [Send and receive messages](#send-and-receive-messages)
- [Roles are just labels](#roles-are-just-labels)
- [Run several projects at once](#run-several-projects-at-once)
- [Auto mode: the event spawner](#auto-mode-the-event-spawner)
  - [Two drivers: tmux vs spawn](#two-drivers-tmux-vs-spawn)
  - [Configure and run](#configure-and-run)
  - [Safety rails](#safety-rails)
  - [Sensitive roles are off by default](#sensitive-roles-are-off-by-default)
  - [Never auto-commit (and how to allow it)](#never-auto-commit-and-how-to-allow-it)
  - [Be careful with auto-deploy](#be-careful-with-auto-deploy)
- [Change settings from inside Claude](#change-settings-from-inside-claude)
- [Reference](#reference)

---

## How to picture it

Two simple ideas:

- **Project = a chat room.** Sessions launched with the same project name are in
  the same room and can talk. Different project name = different room, isolated.
- **Role = your nickname in that room.** `backend`, `frontend`, `infra` — any
  label you like. You address messages to a role.

```
Session 1   project "shop"  role "backend"  ┐
                                            ├─ room "shop" (they talk)
Session 2   project "shop"  role "frontend" ┘

Session 3   project "blog"  role "backend"  ─── room "blog" (separate, isolated)
```

There is **no "connect" button.** Launching two sessions with the same project
name *is* connecting them.

---

## Requirements

- **Node.js 18+** — check with `node --version`
- **Claude Code** (the `claude` command) — check with `claude --version`
- **tmux** — recommended; the default auto-mode driver drives your live sessions
  through it. (Not needed if you only use the bus, or the `spawn` driver.)

---

## Install (one time)

You do this **once.** Afterward you never edit these files again — the only
thing that changes per session is two environment variables (explained next).

**1. Get the code and build it.**

```bash
git clone <this-repo-url> claude-session-bridge-mcp
cd claude-session-bridge-mcp
npm install
npm run build
```

**2. Register the bridge.** Run this **inside a Claude Code session** (so it
targets that session's config dir — see the note):

```bash
npm link                  # optional: puts `session-bridge` on PATH
session-bridge install    # registers the MCP server + hooks
session-bridge doctor     # verify what's set up, and where
```

`install` merges the MCP server, the **receive** hook, and the **block-git**
hook (blocks `git commit`/`push`/`reset`) into your active settings.json —
idempotently, without touching your other settings. Add `--no-block-git` if you
*want* sessions to commit on their own. (If `session-bridge` isn't on your
`PATH`, run `node /ABSOLUTE/PATH/dist/cli.js install`.)

> **Work accounts / multiple profiles.** Claude Code reads
> `$CLAUDE_CONFIG_DIR/settings.json` when that env var is set (common for a
> separate work login), otherwise `~/.claude/settings.json`. This is the #1
> reason "I edited settings and nothing changed" — you edited the wrong file.
> Running `session-bridge install` **inside a session of a given profile**
> targets the correct file automatically. Run it once per profile. Check with
> `session-bridge doctor`, which prints the active config dir.

<details>
<summary>Manual settings.json (if you'd rather edit by hand)</summary>

Add to the right settings.json (replace `/ABSOLUTE/PATH`):

```json
{
  "mcpServers": {
    "session-bridge": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/claude-session-bridge-mcp/dist/server.js"]
    }
  },
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command",
        "command": "node /ABSOLUTE/PATH/claude-session-bridge-mcp/dist/hooks/recv.js" } ] }
    ],
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command",
        "command": "node /ABSOLUTE/PATH/claude-session-bridge-mcp/dist/hooks/block-git.js" } ] }
    ]
  }
}
```
</details>

All hooks no-op safely in non-bridged sessions, so they're fine installed
globally. That's the whole setup.

---

## Connect two sessions

To put a session in a room, give it two values **when you launch it**:

| Variable | Meaning | Example |
|----------|---------|---------|
| `BRIDGE_PROJECT` | the room name | `shop` |
| `BRIDGE_ROLE` | this session's nickname | `backend` |

```bash
# Terminal 1 — the backend of project "shop"
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend claude

# Terminal 2 — the frontend of project "shop"
BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude
```

Both used project `shop`, so they're in the same room and can talk.

### Two ways to set the variables

Pick one — **but don't mix them up; this is the #1 beginner mistake.**

**Way A — on the same line (simplest, recommended):**

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude
```

The variables apply only to that one `claude`. Nothing to clean up.

**Way B — set first, then launch.** On separate lines you **must** use `export`:

```bash
export BRIDGE_PROJECT=shop
export BRIDGE_ROLE=frontend
claude
```

> ⚠️ **The trap:** `BRIDGE_PROJECT=shop` on its own line **without** `export`
> sets a shell variable `claude` will **not** see — the bridge silently won't
> connect. Use `export` (Way B), or put everything on one line (Way A).

**Tip — make aliases** so you don't retype this. In `~/.zshrc` (or `~/.bashrc`):

```bash
alias shop-back='BRIDGE_PROJECT=shop BRIDGE_ROLE=backend claude'
alias shop-front='BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude'
```

### Using tmux

tmux changes nothing about launching — each pane is its own shell, like a
separate terminal. Set the variables in each pane and run `claude`:

```
tmux
 ├ pane 1:  BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude
 ├ pane 2:  BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude   ← same room as pane 1
 └ pane 3:  BRIDGE_PROJECT=blog BRIDGE_ROLE=backend  claude   ← different room
```

tmux matters most for **auto mode**: the default driver wakes these live panes
automatically (see [the spawner](#auto-mode-the-event-spawner)). A session
launched inside tmux registers its pane on its own — no manual setup.

> If you use `export` (Way B) in a pane and later launch a *different* project's
> `claude` in that **same** pane, the old `export` lingers. Prefer Way A inside
> tmux to avoid surprises.

---

## Send and receive messages

Once two sessions share a room, this just works:

1. In the **backend** session, when you have something worth sharing:
   > "Send the new `/users` response shape to the frontend session."

   It calls the `bridge_send` tool to deliver the message.

2. In the **frontend** session, the next time you type anything, the message is
   **automatically added** to its context — no copy-paste.

That's the default ("bus") mode: **sending is deliberate** (the model shares a
real result, not a wall of text), and **receiving is automatic** on the next
turn. You're still driving.

You can also be explicit in either session: *"Check the bridge for new
messages"* (`bridge_recv`) or *"Send this to infra: staging is ready"*
(`bridge_send`).

> If a session finishes and has nothing worth sharing, it simply doesn't send —
> nothing hits the bus and any ping-pong ends naturally. Idle sessions don't
> spam the room.

---

## Roles are just labels

A role is **any string you want** — not only `backend`/`frontend`. Add as many
sessions to a room as you like:

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=web      claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=infra    claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=qa       claude
```

When sending, address a specific role (`to: "infra"`) or broadcast to everyone
else (`to: "*"`). A message addressed to `frontend` is delivered **only** to
`frontend` — `infra`/`qa` never even see it, so they can't act on it by mistake.
(Only `to: "*"` reaches everyone.) So a multi-step flow is natural:

> backend finishes an API → tells **web** → web updates the UI → tells **infra**
> → infra redeploys.

Whether that chain runs **automatically** is up to the spawner below — and for
deploys, read [Be careful with auto-deploy](#be-careful-with-auto-deploy) first.

---

## Run several projects at once

Use different project names; they never see each other's messages:

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude   # room "shop"
BRIDGE_PROJECT=blog BRIDGE_ROLE=frontend claude   # room "blog" — isolated
```

Isolation is structural (messages live under a per-project folder), so `shop`
and `blog` can't cross over.

---

## Auto mode: the event spawner

Everything above keeps **you** in the loop — a session acts only when you give
it a turn. The **event spawner** is an optional background program (a daemon)
that removes that step: when a role receives a message, the spawner **wakes that
role automatically** to act on it, so the sides can ping-pong with no human in
between. You run it in its own terminal; it's opt-in and easy to turn off.

### Two drivers: tmux vs spawn

The **driver** decides *how* a role is woken:

| | **tmux** (default) | **spawn** |
|---|---|---|
| What it does | Types into your **already-open live session** (`tmux send-keys`) | Launches a **fresh `claude -p`** process per event |
| Session | The same one continues (keeps context) | A new session each time |
| Visible? | Yes — you watch it in the pane | Background (logs only) |
| Uses `claude -p`? | **No** | Yes |
| Needs tmux? | Yes | No |

Analogy: **tmux** taps an employee already at their desk; **spawn** hires a new
temp for each task.

Why tmux is the default: it orchestrates the *open* sessions you're already
working in, keeps their context, lets you watch and interrupt, and **doesn't use
`claude -p`** (so it's unaffected by changes to headless/SDK billing). Use
`spawn` when you can't run tmux or want isolated one-shot runs.

### Configure and run

A role is only auto-woken once it's set up — out of the box the spawner does
nothing, so you opt in role by role:

```bash
# tmux driver: just open the role's session inside tmux — its pane auto-registers.
# spawn driver: tell it where the role's code lives:
session-bridge spawner set shop backend cwd=/path/to/backend

session-bridge spawner on              # enable globally
session-bridge spawner off shop        # ...or per project
session-bridge spawner off shop web    # ...or one role
session-bridge spawner status          # inspect current config
```

(`session-bridge` is the CLI installed with this package. If it's not on your
`PATH`, run `node /ABSOLUTE/PATH/dist/cli.js spawner ...`.)

Run the daemon in its own terminal:

```bash
session-bridge spawner run             # foreground; Ctrl-C to stop
# or background it:
nohup session-bridge spawner run > ~/.claude/bridge/spawner.log 2>&1 &
```

Config is re-read on every event, so `on`/`off` and other changes take effect
**live** — no restart needed.

### Safety rails

| Rail | Default | What it does |
|------|---------|--------------|
| `maxHops` (loop guard) | 6 | A per-project chain counter caps consecutive auto-wakes, resetting after a quiet gap. Bounds runaway ping-pong (works for both drivers). |
| `rateLimitPerMinute` | 12 | Max auto-wakes per role per minute. |
| sensitive roles | `infra`, `qa` | Never auto-woken unless explicitly enabled — a misrouted message can't trigger a deploy. |
| no auto-commit | on | `git commit`/`push`/`reset` blocked (see below). |
| single-flight / cooldown | — | One live run per role at a time (spawn); a re-nudge cooldown (tmux). |
| target required | — | A role with no live pane (tmux) or no cwd (spawn) is never woken. |

### Sensitive roles are off by default

`infra` and `qa` ship in `defaultOffRoles` — the spawner **will not auto-wake
them even when configured.** You must opt them in by name.

**Why?** The sender chooses *who* a message goes to, and the sender is a language
model. If it ever broadcasts (`to: "*"`) or mis-addresses, `infra`/`qa` could
receive a request not meant for them — and those roles do the riskiest things
(deploys, releases, destructive tests). Keeping them off is a guarantee that
does **not** depend on the model addressing correctly: a misrouted message just
sits in the inbox until a human opens that session.

**Turn them on (if you want full automation):**

```bash
session-bridge spawner on shop infra      # explicit opt-in (required)
```

Read [Be careful with auto-deploy](#be-careful-with-auto-deploy) first. To
change the list, edit `defaultOffRoles` in `<BRIDGE_ROOT>/spawner.config.json`.

### Never auto-commit (and how to allow it)

By default, auto-driven sessions can't commit. **Two layers** enforce it:

1. **spawn driver:** sessions launch with
   `--disallowed-tools "Bash(git commit:*)" "Bash(git push:*)" ...`. Deny rules
   beat allow/bypass, so the model physically can't commit.
2. **tmux driver (live sessions):** those flags don't apply, so install the
   **`block-git` PreToolUse hook** (in [Install](#install-one-time)). It denies
   `git commit`/`push`/`reset` in any session, however its turn was triggered.

> A `CLAUDE.md` reminder ("don't commit") is a nice-to-have but **not enough**
> for autonomous loops — a model can drift. The hook/deny rules are the real
> guarantee.

**If you WANT commit/push automation** (some people do), opt out:

- Don't install the `block-git` hook, **and**
- Remove git entries from `denyTools` (`session-bridge spawner` config) for the
  spawn driver.
- Or narrow what's blocked with `BRIDGE_BLOCK_GIT` (a regex; e.g. allow commit
  but still block push).

> ⚠️ Auto-`push` is outward-facing and hard to undo. If you allow it, push to a
> **feature branch** and protect `main` (branch protection). Don't auto-push to
> `main`.

### Be careful with auto-deploy

⚠️ Commits/pushes are blocked — but **deploying is not git.** `kubectl apply`,
`vercel deploy`, `terraform apply`, an SSH deploy script — none are blocked by
default, so an autonomous `infra` session could run them. Deploying is
outward-facing and hard to undo; doing it with no human present is risky.

If you want `infra` in the loop, pick one:

1. **Keep infra manual** (default — it's off). Messages queue; you open the
   session and deploy yourself.
2. **Block deploy commands** (add them to `denyTools` or the block-git regex).
3. **Automate only safe steps** — staging/dry-run automatic, production manual.

---

## Change settings from inside Claude

You don't have to edit JSON or remember CLI flags. The MCP server lets you read
and change every automation setting **from inside a Claude session** — a
dashboard, conversational or via `/mcp`.

**Safety: admin-gated.** Settings can only be *changed* from a session launched
with `BRIDGE_ADMIN=1` (your "control" session). Auto-driven sessions don't have
it, so a runaway loop can't flip its own safety settings. Reading config is
always allowed.

```bash
# your control / dashboard session
BRIDGE_PROJECT=shop BRIDGE_ROLE=control BRIDGE_ADMIN=1 claude
```

**Two ways to drive it:**

**A. Just talk to it** (the model calls the tools):

> "Show the bridge config." · "Set frontend to auto." · "maxHops 3, driver
> tmux." · "Turn automation off."

**B. `/mcp` prompts** (slash commands that apply the change on the spot):

```
/mcp__session-bridge__show-config       show current settings
/mcp__session-bridge__set-mode          project, role, auto|manual
/mcp__session-bridge__configure-role    cwd / model / tmuxTarget
/mcp__session-bridge__set-driver        tmux | spawn
/mcp__session-bridge__automation        on | off  (master switch)
/mcp__session-bridge__set-limits        maxHops / rateLimitPerMinute
```

Pick one, fill the arguments, and it writes the change immediately (admin
session only). The daemon picks it up live.

---

## Reference

### Tools (callable by a session)

| Tool | Admin? | Purpose |
|------|--------|---------|
| `bridge_send(to, body)` | no | Send to a role, or `"*"` to broadcast |
| `bridge_recv()` | no | Pull + consume unread messages |
| `bridge_peek()` | no | Preview unread without consuming |
| `bridge_tail(limit?)` | no | Inspect recent messages |
| `bridge_roles()` | no | List roles in the project |
| `bridge_whoami()` | no | Show this session's project + role |
| `bridge_config()` | no | Show automation settings |
| `bridge_mode(project, role, auto\|manual)` | **yes** | Set a role's mode |
| `bridge_set(project, role, {...})` | **yes** | Configure a role (cwd/model/tmuxTarget/permissionMode) |
| `bridge_settings({...})` | **yes** | Global knobs (driver/maxHops/rate/…) |

### CLI

```bash
# setup (targets the active config dir: $CLAUDE_CONFIG_DIR or ~/.claude)
session-bridge install [--no-block-git] [--config-dir <dir>]
session-bridge doctor

# inspect the bus (use any role as your identity)
BRIDGE_PROJECT=shop BRIDGE_ROLE=cli session-bridge roles
BRIDGE_PROJECT=shop BRIDGE_ROLE=cli session-bridge send frontend "hello"
BRIDGE_PROJECT=shop BRIDGE_ROLE=cli session-bridge tail 20
session-bridge root            # bus storage directory

# the spawner
session-bridge spawner set <project> <role> cwd=<path> [model=<m>] [tmuxTarget=<t>]
session-bridge spawner on  [project] [role]
session-bridge spawner off [project] [role]
session-bridge spawner status
session-bridge spawner run [--replay]
```

### Environment variables

| Var | Required | Default | Meaning |
|-----|----------|---------|---------|
| `BRIDGE_PROJECT` | yes | — | Project (room) name — the isolation boundary |
| `BRIDGE_ROLE` | yes | — | This session's role (nickname) |
| `BRIDGE_ADMIN` | no | off | `1` lets this session change automation settings |
| `BRIDGE_ROOT` | no | `~/.claude/bridge` | Where messages/config are stored |
| `BRIDGE_BLOCK_GIT` | no | `commit\|push\|reset` | Regex of git ops the block-git hook denies |
| `BRIDGE_AUTOSEND` | no | off | `1` enables the Stop auto-send hook |
| `BRIDGE_SEND_TO` | no | `*` | Default recipient for auto-send |
| `BRIDGE_HOP` | no | `0` | Loop-guard hop (set by the spawn driver) |

### Optional: auto-send every turn

Off by default — deliberate `bridge_send` is preferred. To broadcast a session's
last message automatically each turn, set `BRIDGE_AUTOSEND=1` and add the Stop
hook to `settings.json` (`dist/hooks/send.js`). Override the target with
`BRIDGE_SEND_TO`. Noisier and more tokens than deliberate sends.

### How it works (for the curious)

Messages and config are plain files under `BRIDGE_ROOT`:

```
~/.claude/bridge/
  spawner.config.json          automation settings (edited live)
  <project>/
    <role>.inbox.jsonl         append-only log of messages for that role
    .cursors/<role>.cursor     how many messages that role has read
    .sessions/<role>.pane      tmux pane id, for the tmux driver to find it
```

`bridge_send` appends to the recipient's inbox. The receive hook reads your
inbox from your cursor forward, injects the new lines, and advances the cursor —
so you never see a message twice. Isolation is just the per-project folder.

### Tests

```bash
npm test             # MCP bus end-to-end
npm run test:config  # config dashboard + admin gate
npm run test:prompts # /mcp prompts apply changes (admin-gated)
npm run test:spawner # spawn-driver ping-pong + loop guard
npm run test:tmux    # tmux-driver ping-pong + loop guard
npm run test:real    # real two-session test using `claude -p`
```

### License

MIT
