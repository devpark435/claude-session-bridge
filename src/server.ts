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
import { identity, listRoles, recv, register, send, tail } from "./bus.js";

const me = identity();
register(me);

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

const transport = new StdioServerTransport();
await server.connect(transport);
