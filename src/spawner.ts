/**
 * Event spawner daemon.
 *
 * Watches the bus. When a sibling delivers new messages to a role's inbox, it
 * WAKES that role so it acts on them — enabling automatic backend<->frontend
 * ping-pong. Two drivers:
 *
 *  - "tmux" (default): drive the role's LIVE interactive session via
 *    `tmux send-keys`. Orchestrates already-open sessions and does NOT use
 *    `claude -p`. The session's recv hook injects the new messages on that turn.
 *  - "spawn": launch a fresh headless `claude -p` per event.
 *
 * Safety:
 *  - loop guard: a per-project chain counter caps consecutive auto-wakes
 *    (config.maxHops), resetting after config.idleResetSeconds of quiet. Works
 *    for both drivers (the live session can't carry the hop counter).
 *  - rate limit: at most config.rateLimitPerMinute wakes per (project, role).
 *  - sensitive roles (infra/qa) never auto-wake unless explicitly enabled.
 *  - no auto-commit: spawn driver passes config.denyTools as --disallowed-tools;
 *    for the tmux driver install the block-git PreToolUse hook (see README).
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  watch,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  busRoot,
  getCursor,
  getSessionPane,
  inboxMessages,
  setCursor,
} from "./bus.js";
import { loadConfig, resolveRole, type SpawnerConfig } from "./config.js";

const distDir = dirname(fileURLToPath(import.meta.url));
const serverPath = join(distDir, "server.js");
const recvHookPath = join(distDir, "hooks", "recv.js");

function log(msg: string): void {
  process.stdout.write(`[spawner] ${msg}\n`);
}

/** --mcp-config and --settings files for the spawn driver's `claude -p`. */
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
  active: Set<string>; // spawn driver: role currently running
  pending: Set<string>; // grew while active; re-check on completion
  rate: Map<string, number[]>; // key -> recent wake timestamps (ms)
  chain: Map<string, { depth: number; last: number }>; // per-project loop counter
  lastNudge: Map<string, number>; // tmux: key -> last nudge ts (cooldown)
}

function rateOk(state: State, key: string, cfg: SpawnerConfig): boolean {
  const now = Date.now();
  const win = (state.rate.get(key) || []).filter((t) => now - t < 60_000);
  state.rate.set(key, win);
  return win.length < cfg.rateLimitPerMinute;
}

function recordWake(state: State, key: string, project: string): void {
  const now = Date.now();
  const arr = state.rate.get(key) || [];
  arr.push(now);
  state.rate.set(key, arr);
  const c = state.chain.get(project) || { depth: 0, last: 0 };
  c.depth += 1;
  c.last = now;
  state.chain.set(project, c);
}

/** Per-project loop guard. Returns false if the chain cap is hit. */
function chainOk(state: State, project: string, cfg: SpawnerConfig): boolean {
  const now = Date.now();
  const c = state.chain.get(project) || { depth: 0, last: 0 };
  if (now - c.last > cfg.idleResetSeconds * 1000) c.depth = 0;
  state.chain.set(project, c);
  return c.depth < cfg.maxHops;
}

function launchSpawn(
  cfg: SpawnerConfig,
  project: string,
  role: string,
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
  args.push("--disallowed-tools", ...cfg.denyTools); // variadic last; prompt via stdin

  const child = spawn(cfg.command[0], args, {
    cwd,
    env: { ...process.env, BRIDGE_PROJECT: project, BRIDGE_ROLE: role, BRIDGE_HOP: "0" },
    stdio: ["pipe", "ignore", "inherit"],
  });
  child.stdin.write(cfg.prompt);
  child.stdin.end();
  child.on("exit", (code) => {
    log(`session ${project}/${role} exited (code ${code ?? "?"})`);
    onExit();
  });
  child.on("error", (err) => {
    log(`session ${project}/${role} failed to launch: ${err.message}`);
    onExit();
  });
}

function nudgeTmux(
  cfg: SpawnerConfig,
  project: string,
  role: string,
  target: string,
): void {
  // Type the prompt as literal text first, then send Enter SEPARATELY a moment
  // later. Interactive TUIs (like Claude Code) drop a submit key that arrives in
  // the same burst as a long paste — the text lands in the box but isn't sent.
  const run = (extra: string[]) => {
    const c = spawn(
      cfg.tmuxCommand[0],
      [...cfg.tmuxCommand.slice(1), "send-keys", "-t", target, ...extra],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    c.on("error", (err) => log(`tmux send-keys to ${target} failed: ${err.message}`));
  };
  run(["-l", cfg.nudgePrompt]); // literal text (no key-name interpretation)
  setTimeout(() => run(["Enter"]), 700); // submit once the TUI has rendered it
}

function handle(
  state: State,
  cfg: SpawnerConfig,
  files: { mcp: string; settings: string },
  project: string,
  role: string,
): void {
  const key = `${project}/${role}`;
  const cursorName = spawnerCursorName(role);

  // spawn driver single-flight
  if (cfg.driver === "spawn" && state.active.has(key)) {
    state.pending.add(key);
    return;
  }

  const all = inboxMessages(project, role);
  const fresh = all.slice(getCursor(project, cursorName));
  if (fresh.length === 0) return;

  const resolved = resolveRole(cfg, project, role);
  if (!resolved.ok) {
    log(`skip ${key}: ${resolved.reason}`);
    setCursor(project, cursorName, all.length);
    return;
  }

  if (!chainOk(state, project, cfg)) {
    const c = state.chain.get(project)!;
    log(`loop guard: '${project}' chain depth ${c.depth} >= ${cfg.maxHops}, not waking ${role}`);
    setCursor(project, cursorName, all.length);
    return;
  }

  if (!rateOk(state, key, cfg)) {
    log(`rate limit: ${key} exceeded ${cfg.rateLimitPerMinute}/min, deferring`);
    return; // leave cursor; recv hook still delivers on the session's next turn
  }

  if (cfg.driver === "tmux") {
    const now = Date.now();
    const last = state.lastNudge.get(key) ?? 0;
    if (now - last < cfg.cooldownSeconds * 1000) return; // within cooldown; leave cursor

    const target = resolved.role.tmuxTarget || getSessionPane(project, role);
    if (!target) {
      log(`skip ${key}: no live tmux session registered (open it inside tmux, or set tmuxTarget)`);
      setCursor(project, cursorName, all.length);
      return;
    }
    setCursor(project, cursorName, all.length);
    state.lastNudge.set(key, now);
    recordWake(state, key, project);
    log(`nudge ${key} -> tmux ${target} for ${fresh.length} msg(s)`);
    nudgeTmux(cfg, project, role, target);
    return;
  }

  // spawn driver
  setCursor(project, cursorName, all.length);
  state.active.add(key);
  recordWake(state, key, project);
  log(`spawn ${key} for ${fresh.length} msg(s) (chain ${state.chain.get(project)?.depth}/${cfg.maxHops})`);
  launchSpawn(
    cfg,
    project,
    role,
    files,
    resolved.role.cwd!,
    resolved.role.model,
    resolved.role.permissionMode,
    () => {
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

export function run(opts: { replay?: boolean } = {}): void {
  const cfg = loadConfig();
  const root = busRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  const files = ensureLaunchFiles();

  const state: State = {
    active: new Set(),
    pending: new Set(),
    rate: new Map(),
    chain: new Map(),
    lastNudge: new Map(),
  };

  // React to NEW messages only (unless replay).
  for (const projDir of safeReaddir(root)) {
    if (projDir.startsWith(".")) continue;
    for (const role of rolesIn(root, projDir)) {
      if (!opts.replay) {
        setCursor(projDir, spawnerCursorName(role), inboxMessages(projDir, role).length);
      }
    }
  }

  log(`driver=${cfg.driver} | watching ${root} (enabled=${cfg.enabled}, ` +
    `maxHops=${cfg.maxHops}, rate=${cfg.rateLimitPerMinute}/min, replay=${!!opts.replay})`);
  if (cfg.driver === "spawn") log(`deny tools: ${cfg.denyTools.join(", ")}`);

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
        handle(state, loadConfig(), files, parsed.project, parsed.role); // reload config for live toggles
      }, 120),
    );
  });

  if (opts.replay) {
    for (const projDir of safeReaddir(root)) {
      if (projDir.startsWith(".")) continue;
      for (const role of rolesIn(root, projDir)) handle(state, cfg, files, projDir, role);
    }
  }
}
