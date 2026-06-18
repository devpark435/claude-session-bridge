#!/usr/bin/env node
/**
 * Session Bridge MCP server.
 *
 * Exposes tools so a Claude Code session can deliberately push results to,
 * and pull messages from, sibling sessions in the same project.
 *
 * Identity comes from the environment of the launching session:
 *   BRIDGE_PROJECT, BRIDGE_ROLE   (required)
 *   BRIDGE_ROOT                   (optional, default ~/.claude/bridge)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  identity,
  listRoles,
  recv,
  register,
  registerSession,
  send,
  tail,
} from "./bus.js";
import {
  configPath,
  loadConfig,
  saveConfig,
  setGlobals,
  setMode,
  setRoleField,
} from "./config.js";

const me = identity();
register(me);
registerSession(me); // record tmux pane (if any) for the spawner's tmux driver

// Config-write tools are gated: only sessions launched with BRIDGE_ADMIN=1 may
// change automation settings. Auto-driven (spawned/woken) sessions don't have
// it, so they can't flip their own safety settings.
const isAdmin = process.env.BRIDGE_ADMIN === "1";

const server = new McpServer({
  name: "session-bridge",
  version: "0.1.0",
});

function text(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

server.registerTool(
  "bridge_whoami",
  {
    title: "Bridge: who am I",
    description:
      "Return this session's bridge identity (project + role) and the other roles currently registered in the project.",
    inputSchema: {},
  },
  async () => text({ ...me, roles: listRoles(me.project) }),
);

server.registerTool(
  "bridge_roles",
  {
    title: "Bridge: list roles",
    description:
      "List the roles (sessions) registered in this project that can receive messages.",
    inputSchema: {},
  },
  async () => text({ project: me.project, roles: listRoles(me.project) }),
);

server.registerTool(
  "bridge_send",
  {
    title: "Bridge: send message",
    description:
      "Send a message to another session in this project. Use this to share a concrete, reusable result — an API response shape, a generated type, a schema change, a decision — NOT a full transcript. `to` is a role name (e.g. \"frontend\") or \"*\" to broadcast to every other role in the project.",
    inputSchema: {
      to: z
        .string()
        .describe('Recipient role (e.g. "frontend") or "*" for everyone else'),
      body: z.string().describe("The message content to deliver"),
    },
  },
  async ({ to, body }) => {
    const { envelope, delivered } = send(me, to, body);
    return text({
      ok: true,
      id: envelope.id,
      to,
      delivered,
      note:
        delivered.length === 0
          ? "No matching roles registered yet — message not delivered. The recipient session must run once (its recv hook registers it)."
          : `Delivered to: ${delivered.join(", ")}`,
    });
  },
);

server.registerTool(
  "bridge_recv",
  {
    title: "Bridge: receive messages",
    description:
      "Pull unread messages addressed to this session and mark them read. Returns an empty list when there is nothing new.",
    inputSchema: {},
  },
  async () => text({ messages: recv(me) }),
);

server.registerTool(
  "bridge_peek",
  {
    title: "Bridge: peek messages",
    description:
      "Preview unread messages WITHOUT marking them read (cursor is not advanced).",
    inputSchema: {},
  },
  async () => text({ messages: recv(me, { peek: true }) }),
);

server.registerTool(
  "bridge_tail",
  {
    title: "Bridge: tail inbox",
    description:
      "Show the most recent messages in this session's inbox regardless of read state (for inspection/debugging).",
    inputSchema: {
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max messages to return (default 50)"),
    },
  },
  async ({ limit }) => text({ messages: tail(me.project, me.role, limit ?? 50) }),
);

// ── Dashboard: read/change automation settings from inside a session ──────────

function adminDenied() {
  return text({
    ok: false,
    error:
      "Config changes require an admin session. Launch your control session with " +
      "BRIDGE_ADMIN=1. Auto-driven sessions cannot change settings.",
  });
}

server.registerTool(
  "bridge_config",
  {
    title: "Bridge: show automation config",
    description:
      "Show the current spawner/automation settings (driver, loop guard, rate limit, per-project/role modes, sensitive roles, etc.). Read-only; allowed in any session.",
    inputSchema: {},
  },
  async () =>
    text({ configPath: configPath(), admin: isAdmin, config: loadConfig() }),
);

server.registerTool(
  "bridge_mode",
  {
    title: "Bridge: set a role's mode",
    description:
      'Set how a role reacts to new messages. "auto" = the spawner wakes that session automatically; "manual" = messages wait for its next human turn. Admin session only (BRIDGE_ADMIN=1).',
    inputSchema: {
      project: z.string(),
      role: z.string(),
      mode: z.enum(["auto", "manual"]),
    },
  },
  async ({ project, role, mode }) => {
    if (!isAdmin) return adminDenied();
    saveConfig(setMode(loadConfig(), project, role, mode));
    return text({ ok: true, project, role, mode });
  },
);

server.registerTool(
  "bridge_set",
  {
    title: "Bridge: configure a role",
    description:
      "Set per-role launch settings: cwd (spawn driver), model, tmuxTarget (tmux driver override), permissionMode. Admin session only.",
    inputSchema: {
      project: z.string(),
      role: z.string(),
      cwd: z.string().optional(),
      model: z.string().optional(),
      tmuxTarget: z.string().optional(),
      permissionMode: z.string().optional(),
    },
  },
  async ({ project, role, ...fields }) => {
    if (!isAdmin) return adminDenied();
    let cfg = loadConfig();
    const set: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      cfg = setRoleField(cfg, project, role, k as any, v as string);
      set[k] = v as string;
    }
    saveConfig(cfg);
    return text({ ok: true, project, role, set });
  },
);

server.registerTool(
  "bridge_settings",
  {
    title: "Bridge: set global automation settings",
    description:
      "Change global automation knobs. Admin session only. Takes effect live (the daemon re-reads config each event).",
    inputSchema: {
      enabled: z.boolean().optional().describe("Master on/off for auto-waking"),
      driver: z.enum(["tmux", "spawn"]).optional(),
      maxHops: z.number().int().positive().optional().describe("Loop-guard cap"),
      rateLimitPerMinute: z.number().int().positive().optional(),
      idleResetSeconds: z.number().int().positive().optional(),
      cooldownSeconds: z.number().int().nonnegative().optional(),
      nudgePrompt: z.string().optional(),
      denyTools: z.array(z.string()).optional().describe("Tools blocked in spawned sessions"),
      defaultOffRoles: z
        .array(z.string())
        .optional()
        .describe("Sensitive roles that require explicit opt-in (e.g. infra, qa)"),
    },
  },
  async (partial) => {
    if (!isAdmin) return adminDenied();
    const clean = Object.fromEntries(
      Object.entries(partial).filter(([, v]) => v !== undefined),
    );
    const { cfg, applied, rejected } = setGlobals(loadConfig(), clean);
    saveConfig(cfg);
    return text({ ok: true, applied, rejected });
  },
);

// ── MCP Prompts: a /mcp-native control surface ───────────────────────────────
// These appear as slash commands (e.g. /session-bridge:set-mode). Selecting one
// applies the change immediately in the handler (admin sessions only) and
// returns a confirmation — so you change settings from the /mcp menu itself.

function promptText(t: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text: t } }] };
}
const notAdminMsg =
  "❌ Session Bridge: this is not an admin session, so settings can't be changed. " +
  "Relaunch your control session with BRIDGE_ADMIN=1. Tell the user this briefly.";

server.registerPrompt(
  "show-config",
  {
    title: "Session Bridge: show automation config",
    description: "Display the current spawner/automation settings.",
    argsSchema: {},
  },
  () => {
    const cfg = loadConfig();
    return promptText(
      `Session Bridge automation config (admin=${isAdmin}):\n\`\`\`json\n` +
        `${JSON.stringify(cfg, null, 2)}\n\`\`\`\nSummarize this for the user in plain language.`,
    );
  },
);

server.registerPrompt(
  "set-mode",
  {
    title: "Session Bridge: set a role's mode",
    description:
      "Set a role to 'auto' (spawner wakes it automatically) or 'manual' (waits for its next turn). Admin only.",
    argsSchema: {
      project: z.string().describe("Project name"),
      role: z.string().describe("Role name, e.g. frontend"),
      mode: z.string().describe('"auto" or "manual"'),
    },
  },
  ({ project, role, mode }) => {
    if (!isAdmin) return promptText(notAdminMsg);
    if (mode !== "auto" && mode !== "manual")
      return promptText(`❌ mode must be "auto" or "manual" (got "${mode}"). Tell the user.`);
    saveConfig(setMode(loadConfig(), project, role, mode));
    return promptText(
      `✅ Session Bridge: '${project}/${role}' is now ${mode}. The daemon applies this live. Confirm to the user.`,
    );
  },
);

server.registerPrompt(
  "configure-role",
  {
    title: "Session Bridge: configure a role",
    description:
      "Set a role's cwd (spawn driver), model, or tmuxTarget (tmux driver). Admin only.",
    argsSchema: {
      project: z.string(),
      role: z.string(),
      cwd: z.string().optional().describe("Working dir (spawn driver)"),
      model: z.string().optional(),
      tmuxTarget: z.string().optional().describe("tmux pane/target override"),
    },
  },
  ({ project, role, cwd, model, tmuxTarget }) => {
    if (!isAdmin) return promptText(notAdminMsg);
    let cfg = loadConfig();
    const set: Record<string, string> = {};
    for (const [k, v] of Object.entries({ cwd, model, tmuxTarget })) {
      if (v === undefined) continue;
      cfg = setRoleField(cfg, project, role, k as any, v);
      set[k] = v;
    }
    saveConfig(cfg);
    return promptText(
      `✅ Session Bridge: set ${project}/${role} → ${JSON.stringify(set)}. Confirm to the user.`,
    );
  },
);

server.registerPrompt(
  "set-driver",
  {
    title: "Session Bridge: set wake driver",
    description:
      'Choose how sessions are woken: "tmux" (drive live sessions) or "spawn" (headless claude -p). Admin only.',
    argsSchema: { driver: z.string().describe('"tmux" or "spawn"') },
  },
  ({ driver }) => {
    if (!isAdmin) return promptText(notAdminMsg);
    if (driver !== "tmux" && driver !== "spawn")
      return promptText(`❌ driver must be "tmux" or "spawn" (got "${driver}"). Tell the user.`);
    const { cfg } = setGlobals(loadConfig(), { driver });
    saveConfig(cfg);
    return promptText(`✅ Session Bridge: driver is now ${driver}. Confirm to the user.`);
  },
);

server.registerPrompt(
  "automation",
  {
    title: "Session Bridge: turn automation on/off",
    description:
      'Master switch for auto-waking. "on" enables the spawner; "off" pauses it (messages still queue). Admin only.',
    argsSchema: { state: z.string().describe('"on" or "off"') },
  },
  ({ state }) => {
    if (!isAdmin) return promptText(notAdminMsg);
    if (state !== "on" && state !== "off")
      return promptText(`❌ state must be "on" or "off" (got "${state}"). Tell the user.`);
    const { cfg } = setGlobals(loadConfig(), { enabled: state === "on" });
    saveConfig(cfg);
    return promptText(`✅ Session Bridge: automation ${state}. Confirm to the user.`);
  },
);

server.registerPrompt(
  "set-limits",
  {
    title: "Session Bridge: set loop guard / rate limit",
    description:
      "Set maxHops (loop-guard cap) and/or rateLimitPerMinute. Admin only.",
    argsSchema: {
      maxHops: z.string().optional().describe("Loop-guard cap, e.g. 6"),
      rateLimitPerMinute: z.string().optional().describe("Max wakes/min per role"),
    },
  },
  ({ maxHops, rateLimitPerMinute }) => {
    if (!isAdmin) return promptText(notAdminMsg);
    const partial: Record<string, number> = {};
    for (const [k, v] of Object.entries({ maxHops, rateLimitPerMinute })) {
      if (v === undefined) continue;
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n <= 0)
        return promptText(`❌ ${k} must be a positive number (got "${v}"). Tell the user.`);
      partial[k] = n;
    }
    const { cfg, applied } = setGlobals(loadConfig(), partial);
    saveConfig(cfg);
    return promptText(`✅ Session Bridge: applied ${JSON.stringify(applied)}. Confirm to the user.`);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
