/**
 * Event spawner daemon.
 *
 * Watches the bus. When a sibling session delivers new messages to a role's
 * inbox, it wakes that role by launching a `claude -p` session (configurable),
 * which receives the messages via the recv hook, acts on them, and may reply
 * via bridge_send — enabling automatic backend<->frontend ping-pong.
 *
 * Safety:
 *  - loop guard: messages carry a `hop` counter; stops at config.maxHops
 *  - rate limit: at most config.rateLimitPerMinute spawns per (project, role)
 *  - no auto-commit: config.denyTools is always passed as --disallowed-tools
 *  - single-flight: one live spawn per (project, role); re-checks on completion
 *  - safe default: only roles with a configured cwd are ever spawned
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, watch, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { busRoot, getCursor, inboxMessages, setCursor } from "./bus.js";
import {
  loadConfig,
  resolveRole,
  type SpawnerConfig,
} from "./config.js";

const distDir = dirname(fileURLToPath(import.meta.url));
const serverPath = join(distDir, "server.js");
const recvHookPath = join(distDir, "hooks", "recv.js");

function log(msg: string): void {
  process.stdout.write(`[spawner] ${msg}\n`);
}

/** Generate the per-spawn --mcp-config and --settings files (hook wiring). */
function ensureLaunchFiles(): { mcp: string; settings: string } {
  const dir = join(busRoot(), ".spawner");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const mcp = join(dir, "mcp.json");
  const settings = join(dir, "settings.json");
  writeFileSync(
    mcp,
    JSON.stringify(
      { mcpServers: { "session-bridge": { command: "node", args: [serverPath] } } },
      null,
      2,
    ),
  );
  writeFileSync(
    settings,
    JSON.stringify(
      {
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: `node ${recvHookPath}` }] },
          ],
        },
      },
      null,
      2,
    ),
  );
  return { mcp, settings };
}

const spawnerCursorName = (role: string) => `__spawner__${role}`;

interface State {
  active: Set<string>; // "project/role" currently spawning
  pending: Set<string>; // grew while active; re-check on completion
  rate: Map<string, number[]>; // key -> recent spawn timestamps (ms)
}

function rateOk(state: State, key: string, cfg: SpawnerConfig): boolean {
  const now = Date.now();
  const win = (state.rate.get(key) || []).filter((t) => now - t < 60_000);
  state.rate.set(key, win);
  return win.length < cfg.rateLimitPerMinute;
}

function recordSpawn(state: State, key: string): void {
  const arr = state.rate.get(key) || [];
  arr.push(Date.now());
  state.rate.set(key, arr);
}

function launch(
  cfg: SpawnerConfig,
  project: string,
  role: string,
  hop: number,
  files: { mcp: string; settings: string },
  cwd: string,
  model: string | undefined,
  permissionMode: string,
  onExit: () => void,
): void {
  const args = [
    ...cfg.command.slice(1),
    "--print",
    "--mcp-config",
    files.mcp,
    "--settings",
    files.settings,
    "--strict-mcp-config",
    "--add-dir",
    cwd,
    "--permission-mode",
    permissionMode,
  ];
  if (model) args.push("--model", model);
  // deny rules last (variadic) — prompt is fed via stdin, so nothing follows.
  args.push("--disallowed-tools", ...cfg.denyTools);

  const child = spawn(cfg.command[0], args, {
    cwd,
    env: {
      ...process.env,
      BRIDGE_PROJECT: project,
      BRIDGE_ROLE: role,
      BRIDGE_HOP: String(hop),
    },
    stdio: ["pipe", "ignore", "inherit"],
  });
  child.stdin.write(cfg.prompt);
  child.stdin.end();
  child.on("exit", (code) => {
    log(`session ${project}/${role} exited (code ${code ?? "?"})`);
    onExit();
  });
  child.on("error", (err) => {
    log(`failed to launch ${project}/${role}: ${err.message}`);
    onExit();
  });
}

function handle(
  state: State,
  cfg: SpawnerConfig,
  files: { mcp: string; settings: string },
  project: string,
  role: string,
): void {
  const key = `${project}/${role}`;

  if (state.active.has(key)) {
    state.pending.add(key); // re-check when the current spawn finishes
    return;
  }

  const all = inboxMessages(project, role);
  const cursor = getCursor(project, spawnerCursorName(role));
  const fresh = all.slice(cursor);
  if (fresh.length === 0) return;

  const resolved = resolveRole(cfg, project, role);
  if (!resolved.ok) {
    log(`skip ${key}: ${resolved.reason}`);
    setCursor(project, spawnerCursorName(role), all.length); // don't re-eval
    return;
  }

  const maxHop = Math.max(...fresh.map((m) => m.hop ?? 0));
  if (maxHop >= cfg.maxHops) {
    log(`loop guard: ${key} hop ${maxHop} >= ${cfg.maxHops}, not spawning`);
    setCursor(project, spawnerCursorName(role), all.length);
    return;
  }

  if (!rateOk(state, key, cfg)) {
    log(`rate limit: ${key} exceeded ${cfg.rateLimitPerMinute}/min, deferring`);
    return; // leave cursor; a later event re-checks
  }

  // Claim these messages so we don't double-spawn for them.
  setCursor(project, spawnerCursorName(role), all.length);
  state.active.add(key);
  recordSpawn(state, key);
  log(`spawn ${key} for ${fresh.length} msg(s), hop ${maxHop} -> ${maxHop + 1}`);

  launch(
    cfg,
    project,
    role,
    maxHop,
    files,
    resolved.role.cwd,
    resolved.role.model,
    resolved.role.permissionMode,
    () => {
      // Re-check on completion (with fresh config) to catch messages that
      // arrived mid-run or while single-flight was blocking.
      state.active.delete(key);
      state.pending.delete(key);
      handle(state, loadConfig(), files, project, role);
    },
  );
}

function parseInboxPath(rel: string): { project: string; role: string } | null {
  const parts = rel.split(/[\\/]/).filter(Boolean);
  if (parts.length < 2) return null;
  const file = parts[parts.length - 1];
  if (!file.endsWith(".inbox.jsonl")) return null;
  const project = parts[parts.length - 2];
  if (project.startsWith(".")) return null;
  const role = file.slice(0, -".inbox.jsonl".length);
  return { project, role };
}

export function run(opts: { replay?: boolean } = {}): void {
  const cfg = loadConfig();
  const root = busRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  const files = ensureLaunchFiles();

  const state: State = { active: new Set(), pending: new Set(), rate: new Map() };

  // Initialize spawner cursors so we react to NEW messages only (unless replay).
  for (const projDir of safeReaddir(root)) {
    if (projDir.startsWith(".")) continue;
    for (const role of rolesIn(root, projDir)) {
      if (!opts.replay) {
        setCursor(projDir, spawnerCursorName(role), inboxMessages(projDir, role).length);
      }
    }
  }

  log(`watching ${root} (enabled=${cfg.enabled}, maxHops=${cfg.maxHops}, ` +
    `rate=${cfg.rateLimitPerMinute}/min, replay=${!!opts.replay})`);
  log(`deny tools: ${cfg.denyTools.join(", ")}`);

  const debounce = new Map<string, NodeJS.Timeout>();
  watch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const parsed = parseInboxPath(filename.toString());
    if (!parsed) return;
    const k = `${parsed.project}/${parsed.role}`;
    clearTimeout(debounce.get(k));
    debounce.set(
      k,
      setTimeout(() => {
        // reload config each tick so toggles take effect live
        handle(state, loadConfig(), files, parsed.project, parsed.role);
      }, 120),
    );
  });

  if (opts.replay) {
    for (const projDir of safeReaddir(root)) {
      if (projDir.startsWith(".")) continue;
      for (const role of rolesIn(root, projDir)) {
        handle(state, cfg, files, projDir, role);
      }
    }
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}
function rolesIn(root: string, project: string): string[] {
  try {
    return readdirSync(join(root, project))
      .filter((f) => f.endsWith(".inbox.jsonl"))
      .map((f) => f.slice(0, -".inbox.jsonl".length));
  } catch {
    return [];
  }
}
