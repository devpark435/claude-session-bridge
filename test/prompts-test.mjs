// Verify MCP prompts surface and apply config changes (admin-gated) on invoke.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "server.js");
const configFile = join(process.env.BRIDGE_ROOT, "spawner.config.json");

let failed = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failed++;
};
const disk = () => (existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {});

async function session(role, extraEnv = {}) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    env: { ...process.env, BRIDGE_PROJECT: "shop", BRIDGE_ROLE: role, ...extraEnv },
  });
  const client = new Client({ name: `t-${role}`, version: "0" });
  await client.connect(transport);
  return client;
}
const getText = async (c, name, args = {}) => {
  const r = await c.getPrompt({ name, arguments: args });
  return r.messages.map((m) => m.content.text).join("\n");
};

// Prompts are listed.
const admin = await session("control", { BRIDGE_ADMIN: "1" });
const names = (await admin.listPrompts()).prompts.map((p) => p.name);
check("prompts listed", ["show-config", "set-mode", "configure-role", "set-driver", "automation", "set-limits"].every((n) => names.includes(n)));

// Non-admin: prompt is denied and does NOT change config.
const plain = await session("frontend");
const denied = await getText(plain, "set-mode", { project: "shop", role: "frontend", mode: "auto" });
check("non-admin set-mode denied", denied.includes("not an admin"));
check("non-admin made no change", disk()?.projects?.shop?.roles?.frontend?.enabled !== true);

// Admin: invoking the prompt applies the change immediately (side effect).
const m = await getText(admin, "set-mode", { project: "shop", role: "frontend", mode: "auto" });
check("admin set-mode confirms", m.includes("✅") && m.includes("auto"));
check("disk: frontend enabled=true", disk().projects.shop.roles.frontend.enabled === true);

const lim = await getText(admin, "set-limits", { maxHops: "3" });
check("admin set-limits confirms", lim.includes("✅"));
check("disk: maxHops=3", disk().maxHops === 3);

const drv = await getText(admin, "set-driver", { driver: "spawn" });
check("disk: driver=spawn", disk().driver === "spawn");

const auto = await getText(admin, "automation", { state: "off" });
check("disk: automation off (enabled=false)", disk().enabled === false);

const bad = await getText(admin, "set-driver", { driver: "nope" });
check("invalid driver rejected", bad.includes("❌"));

await plain.close();
await admin.close();
console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
