/**
 * Spawner configuration: which (project, role) sessions may be auto-spawned,
 * where they run, and the safety limits. Stored at <BRIDGE_ROOT>/spawner.config.json.
 *
 * Safe by default: a role is only spawnable once it has a resolved working
 * directory (role.cwd or defaults.cwd). Out of the box the spawner does nothing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { busRoot } from "./bus.js";

export interface RoleConfig {
  enabled?: boolean;
  cwd?: string;
  model?: string;
  permissionMode?: string;
  /** tmux driver: pane id/target override (else auto-discovered from $TMUX_PANE). */
  tmuxTarget?: string;
}

export interface ProjectConfig {
  enabled?: boolean;
  roles?: Record<string, RoleConfig>;
}

export interface SpawnerConfig {
  enabled: boolean;
  /**
   * How a role is woken on a new message:
   *  - "tmux"  (default): drive the role's LIVE session via `tmux send-keys`.
   *            Orchestrates already-open sessions; does not use `claude -p`.
   *  - "spawn": launch a fresh headless `claude -p` per event.
   */
  driver: "tmux" | "spawn";
  /** argv prefix for tmux (override for tests). */
  tmuxCommand: string[];
  /** A new auto-wake resets the per-project loop counter if the project has
   *  been quiet at least this long (seconds). */
  idleResetSeconds: number;
  /** tmux driver: don't re-nudge the same role within this many seconds. */
  cooldownSeconds: number;
  /** tmux driver: the line typed into the live session to make it take a turn.
   *  The recv hook injects the actual messages; this is just the trigger. */
  nudgePrompt: string;
  maxHops: number;
  rateLimitPerMinute: number;
  /**
   * Sensitive roles that are OFF unless EXPLICITLY enabled (require opt-in
   * with `spawner on <project> <role>`). For roles that can take outward-facing
   * or hard-to-undo actions — deploys, releases — so a misrouted message can
   * never auto-trigger them. Defaults to infra/qa.
   */
  defaultOffRoles: string[];
  /** argv prefix used to launch a session. ["claude"] in production. */
  command: string[];
  defaults: { permissionMode: string; model?: string; cwd?: string };
  /** Always passed via --disallowed-tools. Blocks commits/pushes by default. */
  denyTools: string[];
  /** Prompt handed to each spawned session (messages arrive via the recv hook). */
  prompt: string;
  projects: Record<string, ProjectConfig>;
}

export const DEFAULT_CONFIG: SpawnerConfig = {
  enabled: true,
  driver: "tmux",
  tmuxCommand: ["tmux"],
  idleResetSeconds: 45,
  cooldownSeconds: 8,
  nudgePrompt:
    "A sibling session sent you new messages via the session bridge (injected " +
    "above). Act on them in your part of the codebase, and share results with " +
    "bridge_send. Do NOT git commit or push.",
  maxHops: 6,
  rateLimitPerMinute: 12,
  defaultOffRoles: ["infra", "qa"],
  command: ["claude"],
  defaults: { permissionMode: "acceptEdits" },
  denyTools: ["Bash(git commit:*)", "Bash(git push:*)", "Bash(git reset:*)"],
  prompt:
    "You were woken by the session bridge because a sibling session sent you " +
    "new messages (injected above as context). Act on them: do the work they " +
    "imply in your part of the codebase. When you produce a result another " +
    "session needs, share it by calling the bridge_send tool. Do NOT git " +
    "commit or push — the user commits manually after their own testing.",
  projects: {},
};

export function configPath(): string {
  return join(busRoot(), "spawner.config.json");
}

export function loadConfig(): SpawnerConfig {
  const p = configPath();
  if (!existsSync(p)) return structuredClone(DEFAULT_CONFIG);
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return { ...structuredClone(DEFAULT_CONFIG), ...parsed };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(cfg: SpawnerConfig): void {
  const root = busRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + "\n");
}

export interface ResolvedRole {
  cwd?: string;
  model?: string;
  permissionMode: string;
  tmuxTarget?: string;
}

/**
 * Resolve whether (project, role) may be woken right now, returning the launch
 * settings, or a reason if it must be skipped. Driver-aware: the "spawn" driver
 * needs a cwd; the "tmux" driver needs a live pane (resolved by the spawner from
 * tmuxTarget or the auto-registered pane).
 */
export function resolveRole(
  cfg: SpawnerConfig,
  project: string,
  role: string,
): { ok: true; role: ResolvedRole } | { ok: false; reason: string } {
  if (!cfg.enabled) return { ok: false, reason: "spawner globally off" };

  const proj = cfg.projects[project];
  if (proj?.enabled === false)
    return { ok: false, reason: `project '${project}' off` };

  const rc = proj?.roles?.[role];
  if (rc?.enabled === false)
    return { ok: false, reason: `role '${project}/${role}' off` };

  // Sensitive roles must be explicitly opted in (both drivers).
  if (cfg.defaultOffRoles?.includes(role) && rc?.enabled !== true)
    return {
      ok: false,
      reason: `role '${role}' is off by default (sensitive); enable with: session-bridge spawner on ${project} ${role}`,
    };

  const cwd = rc?.cwd || cfg.defaults.cwd;
  // The spawn driver launches a fresh process, so it must know where to run.
  if (cfg.driver === "spawn" && !cwd)
    return {
      ok: false,
      reason: `no cwd configured for '${project}/${role}' (required by the spawn driver)`,
    };

  return {
    ok: true,
    role: {
      cwd,
      model: rc?.model || cfg.defaults.model,
      permissionMode: rc?.permissionMode || cfg.defaults.permissionMode,
      tmuxTarget: rc?.tmuxTarget,
    },
  };
}

/** Toggle helpers used by the CLI. Scope widens from role -> project -> global. */
export function setEnabled(
  cfg: SpawnerConfig,
  on: boolean,
  project?: string,
  role?: string,
): SpawnerConfig {
  if (!project) {
    cfg.enabled = on;
    return cfg;
  }
  cfg.projects[project] ??= {};
  if (!role) {
    cfg.projects[project]!.enabled = on;
    return cfg;
  }
  cfg.projects[project]!.roles ??= {};
  cfg.projects[project]!.roles![role] ??= {};
  cfg.projects[project]!.roles![role]!.enabled = on;
  return cfg;
}

/** High-level per-role mode: "auto" wakes the session; "manual" leaves messages
 *  to be picked up on its next human turn. */
export function setMode(
  cfg: SpawnerConfig,
  project: string,
  role: string,
  mode: "auto" | "manual",
): SpawnerConfig {
  return setEnabled(cfg, mode === "auto", project, role);
}

const GLOBAL_KEYS = [
  "enabled",
  "driver",
  "maxHops",
  "rateLimitPerMinute",
  "idleResetSeconds",
  "cooldownSeconds",
  "nudgePrompt",
  "denyTools",
  "defaultOffRoles",
] as const;

/** Merge allowed top-level automation settings; reports rejected keys. */
export function setGlobals(
  cfg: SpawnerConfig,
  partial: Record<string, unknown>,
): { cfg: SpawnerConfig; applied: Record<string, unknown>; rejected: string[] } {
  const applied: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(partial)) {
    if (!(GLOBAL_KEYS as readonly string[]).includes(k)) {
      rejected.push(k);
      continue;
    }
    if (k === "driver" && v !== "tmux" && v !== "spawn") {
      rejected.push(`driver(must be tmux|spawn)`);
      continue;
    }
    (cfg as unknown as Record<string, unknown>)[k] = v;
    applied[k] = v;
  }
  return { cfg, applied, rejected };
}

export function setRoleField(
  cfg: SpawnerConfig,
  project: string,
  role: string,
  key: keyof RoleConfig,
  value: string,
): SpawnerConfig {
  cfg.projects[project] ??= {};
  cfg.projects[project]!.roles ??= {};
  const rc = (cfg.projects[project]!.roles![role] ??= {});
  if (key === "enabled") rc.enabled = value === "true";
  else (rc as Record<string, string>)[key] = value;
  return cfg;
}
