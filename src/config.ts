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
}

export interface ProjectConfig {
  enabled?: boolean;
  roles?: Record<string, RoleConfig>;
}

export interface SpawnerConfig {
  enabled: boolean;
  maxHops: number;
  rateLimitPerMinute: number;
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
  maxHops: 6,
  rateLimitPerMinute: 12,
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
  cwd: string;
  model?: string;
  permissionMode: string;
}

/**
 * Resolve whether (project, role) may be spawned right now, returning the
 * launch settings, or null with a reason if it must be skipped.
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

  const cwd = rc?.cwd || cfg.defaults.cwd;
  if (!cwd)
    return {
      ok: false,
      reason: `no cwd configured for '${project}/${role}' (set one to enable)`,
    };

  return {
    ok: true,
    role: {
      cwd,
      model: rc?.model || cfg.defaults.model,
      permissionMode: rc?.permissionMode || cfg.defaults.permissionMode,
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
