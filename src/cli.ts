#!/usr/bin/env node
/**
 * Session Bridge CLI — manual inspection and control of the bus.
 *
 * Identity comes from BRIDGE_PROJECT / BRIDGE_ROLE in the environment, e.g.
 *   BRIDGE_PROJECT=myapp BRIDGE_ROLE=cli session-bridge recv
 */
import { busRoot, identity, listRoles, recv, register, send, tail } from "./bus.js";
import {
  configPath,
  loadConfig,
  saveConfig,
  setEnabled,
  setRoleField,
  type RoleConfig,
} from "./config.js";
import { run as runSpawner } from "./spawner.js";
import { activeConfigDir, doctor, install } from "./install.js";

function usage(): never {
  process.stderr.write(
    `session-bridge — Claude Code session message bus

Usage (set BRIDGE_PROJECT and BRIDGE_ROLE first):
  session-bridge whoami                 Show identity + roles in project
  session-bridge roles                  List roles registered in the project
  session-bridge send <to> <body...>    Send a message ("*" = broadcast)
  session-bridge recv                   Read + consume unread messages
  session-bridge peek                   Read unread messages without consuming
  session-bridge tail [limit]           Show recent inbox messages (default 50)
  session-bridge root                   Print the bus root directory

Setup (targets the ACTIVE config dir — $CLAUDE_CONFIG_DIR or ~/.claude):
  session-bridge install [--no-block-git] [--config-dir <dir>]
                                        Register MCP server + hooks (idempotent)
  session-bridge doctor                 Show which config dir is active + what's set up

Event spawner (auto-wake sessions on new messages):
  session-bridge spawner run [--replay]        Run the daemon (foreground)
  session-bridge spawner status                Show config + spawnable roles
  session-bridge spawner on  [project] [role]  Enable (global/project/role)
  session-bridge spawner off [project] [role]  Disable (global/project/role)
  session-bridge spawner set <project> <role> <key=value>...
                                               e.g. cwd=/path model=sonnet

Env:
  BRIDGE_PROJECT   project namespace (required)
  BRIDGE_ROLE      this client's role (required)
  BRIDGE_ROOT      bus root dir (default ~/.claude/bridge)
`,
  );
  process.exit(1);
}

function out(value: unknown): void {
  process.stdout.write(
    (typeof value === "string" ? value : JSON.stringify(value, null, 2)) + "\n",
  );
}

const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
  case "root": {
    out(busRoot());
    break;
  }
  case "whoami": {
    const me = identity();
    out({ ...me, roles: listRoles(me.project) });
    break;
  }
  case "roles": {
    const me = identity();
    out({ project: me.project, roles: listRoles(me.project) });
    break;
  }
  case "send": {
    const me = identity();
    register(me);
    const to = rest[0];
    const body = rest.slice(1).join(" ");
    if (!to || !body) usage();
    const { envelope, delivered } = send(me, to, body);
    out({ ok: true, id: envelope.id, to, delivered });
    break;
  }
  case "recv": {
    const me = identity();
    register(me);
    out({ messages: recv(me) });
    break;
  }
  case "peek": {
    const me = identity();
    register(me);
    out({ messages: recv(me, { peek: true }) });
    break;
  }
  case "tail": {
    const me = identity();
    register(me);
    const limit = rest[0] ? parseInt(rest[0], 10) : 50;
    out({ messages: tail(me.project, me.role, limit) });
    break;
  }
  case "install": {
    const configDir = rest.includes("--config-dir")
      ? rest[rest.indexOf("--config-dir") + 1]
      : undefined;
    const r = install({ configDir, noBlockGit: rest.includes("--no-block-git") });
    out({
      ok: true,
      ...r,
      note:
        r.added.length > 0
          ? "Restart your Claude session for the changes to take effect."
          : "Already installed — nothing to do.",
    });
    break;
  }
  case "doctor": {
    const h = doctor();
    const mark = (b: boolean) => (b ? "✓" : "✗");
    out(
      `Session Bridge — health check\n` +
        `  config dir : ${h.configDir}  (${h.configDirSource})\n` +
        `  settings   : ${h.settings}\n` +
        `  ${mark(h.distBuilt)} dist built (run \`npm run build\` if ✗)\n` +
        `  ${mark(h.mcpRegistered)} MCP server registered\n` +
        `  ${mark(h.recvHook)} receive hook (UserPromptSubmit)\n` +
        `  ${mark(h.blockGitHook)} block-git hook (PreToolUse)\n` +
        (h.mcpRegistered && h.recvHook
          ? "  → ready."
          : `  → run \`session-bridge install\` (in THIS session, so it targets ${activeConfigDir()}).`),
    );
    break;
  }
  case "spawner": {
    const [sub, ...sargs] = rest;
    switch (sub) {
      case "run": {
        runSpawner({ replay: sargs.includes("--replay") });
        break; // run() installs a watcher and keeps the process alive
      }
      case "status": {
        const cfg = loadConfig();
        out({ configPath: configPath(), ...cfg });
        break;
      }
      case "on":
      case "off": {
        const cfg = loadConfig();
        const [project, role] = sargs;
        saveConfig(setEnabled(cfg, sub === "on", project, role));
        out({
          ok: true,
          scope: role
            ? `${project}/${role}`
            : project
              ? project
              : "global",
          enabled: sub === "on",
        });
        break;
      }
      case "set": {
        const [project, role, ...pairs] = sargs;
        if (!project || !role || pairs.length === 0) usage();
        let cfg = loadConfig();
        for (const pair of pairs) {
          const idx = pair.indexOf("=");
          if (idx === -1) usage();
          const key = pair.slice(0, idx) as keyof RoleConfig;
          const value = pair.slice(idx + 1);
          cfg = setRoleField(cfg, project, role, key, value);
        }
        saveConfig(cfg);
        out({ ok: true, project, role, set: pairs });
        break;
      }
      default:
        usage();
    }
    break;
  }
  default:
    usage();
}
