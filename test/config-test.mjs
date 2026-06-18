// Verify the config "dashboard" MCP tools and the BRIDGE_ADMIN gate.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
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
const call = async (c, name, args = {}) =>
  JSON.parse((await c.callTool({ name, arguments: args })).content[0].text);
const diskConfig = () => JSON.parse(readFileSync(configFile, "utf8"));

// Non-admin session: reads ok, writes denied.
const plain = await session("frontend");
const cfgRead = await call(plain, "bridge_config");
check("non-admin can read config", cfgRead.config && cfgRead.admin === false);

const deniedMode = await call(plain, "bridge_mode", { project: "shop", role: "frontend", mode: "auto" });
check("non-admin bridge_mode denied", deniedMode.ok === false);
const deniedSettings = await call(plain, "bridge_settings", { maxHops: 99 });
check("non-admin bridge_settings denied", deniedSettings.ok === false);

// Admin session: writes succeed and persist to disk.
const admin = await session("control", { BRIDGE_ADMIN: "1" });

const s = await call(admin, "bridge_settings", { maxHops: 3, driver: "spawn", rateLimitPerMinute: 30 });
check("admin bridge_settings ok", s.ok && s.applied.maxHops === 3 && s.applied.driver === "spawn");

const m = await call(admin, "bridge_mode", { project: "shop", role: "frontend", mode: "auto" });
check("admin bridge_mode ok", m.ok === true);

const st = await call(admin, "bridge_set", { project: "shop", role: "backend", cwd: "/tmp/back", model: "sonnet" });
check("admin bridge_set ok", st.ok && st.set.cwd === "/tmp/back");

// unknown keys are stripped by the input schema before reaching the handler;
// known keys still apply.
const rej = await call(admin, "bridge_settings", { bogusKey: 1, maxHops: 5 });
check("unknown key ignored, known key applied", rej.ok && rej.applied.maxHops === 5 && !("bogusKey" in rej.applied));

// Verify persisted to disk (what the daemon will read).
const disk = diskConfig();
check("disk: maxHops persisted", disk.maxHops === 5);
check("disk: driver persisted", disk.driver === "spawn");
check("disk: frontend mode=auto persisted", disk.projects.shop.roles.frontend.enabled === true);
check("disk: backend cwd persisted", disk.projects.shop.roles.backend.cwd === "/tmp/back");

await plain.close();
await admin.close();
console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
