/**
 * Auto-install / health-check the bridge into the ACTIVE Claude config dir.
 *
 * Claude Code reads settings from `$CLAUDE_CONFIG_DIR/settings.json` when that
 * env var is set (e.g. a separate work account), otherwise `~/.claude`. Editing
 * the wrong one is a common footgun — so `install` and `doctor` always target
 * the config dir the CURRENT session is actually using.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = dirname(fileURLToPath(import.meta.url)); // this file lives in dist/
const serverPath = join(distDir, "server.js");
const recvHookPath = join(distDir, "hooks", "recv.js");
const blockGitPath = join(distDir, "hooks", "block-git.js");

export function activeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

function settingsFile(dir: string): string {
  return join(dir, "settings.json");
}

function readSettings(p: string): any {
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function hasHookCommand(groups: any[] | undefined, needle: string): boolean {
  return (groups || []).some((g) =>
    (g?.hooks || []).some((h: any) => String(h?.command || "").includes(needle)),
  );
}

export interface InstallResult {
  configDir: string;
  settings: string;
  added: string[];
  alreadyPresent: string[];
}

export function install(opts: { configDir?: string; noBlockGit?: boolean } = {}): InstallResult {
  const dir = opts.configDir || activeConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = settingsFile(dir);
  const s = readSettings(p);
  const added: string[] = [];
  const already: string[] = [];

  s.mcpServers ??= {};
  if (!s.mcpServers["session-bridge"]) {
    s.mcpServers["session-bridge"] = { command: "node", args: [serverPath] };
    added.push("mcpServers.session-bridge");
  } else already.push("mcpServers.session-bridge");

  s.hooks ??= {};
  s.hooks.UserPromptSubmit ??= [];
  if (!hasHookCommand(s.hooks.UserPromptSubmit, "recv.js")) {
    s.hooks.UserPromptSubmit.push({ hooks: [{ type: "command", command: `node ${recvHookPath}` }] });
    added.push("hooks.UserPromptSubmit (recv)");
  } else already.push("hooks.UserPromptSubmit (recv)");

  if (!opts.noBlockGit) {
    s.hooks.PreToolUse ??= [];
    if (!hasHookCommand(s.hooks.PreToolUse, "block-git.js")) {
      s.hooks.PreToolUse.push({ matcher: "Bash", hooks: [{ type: "command", command: `node ${blockGitPath}` }] });
      added.push("hooks.PreToolUse (block-git)");
    } else already.push("hooks.PreToolUse (block-git)");
  }

  writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
  return { configDir: dir, settings: p, added, alreadyPresent: already };
}

export interface Health {
  configDirSource: string;
  configDir: string;
  settings: string;
  distBuilt: boolean;
  mcpRegistered: boolean;
  recvHook: boolean;
  blockGitHook: boolean;
}

export function doctor(): Health {
  const dir = activeConfigDir();
  const p = settingsFile(dir);
  const s = readSettings(p);
  return {
    configDirSource: process.env.CLAUDE_CONFIG_DIR
      ? "CLAUDE_CONFIG_DIR"
      : "default (~/.claude)",
    configDir: dir,
    settings: p,
    distBuilt: existsSync(serverPath),
    mcpRegistered: !!s?.mcpServers?.["session-bridge"],
    recvHook: hasHookCommand(s?.hooks?.UserPromptSubmit, "recv.js"),
    blockGitHook: hasHookCommand(s?.hooks?.PreToolUse, "block-git.js"),
  };
}
