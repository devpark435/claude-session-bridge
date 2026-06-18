// Deterministic end-to-end test: drives the MCP server exactly like a Claude
// session would (real MCP client over stdio, real tools/call), for two roles.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "server.js");

let failed = 0;
function check(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failed++;
}

async function openSession(project, role) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    env: { ...process.env, BRIDGE_PROJECT: project, BRIDGE_ROLE: role },
  });
  const client = new Client({ name: `test-${role}`, version: "0.0.0" });
  await client.connect(transport);
  return client;
}

function parse(res) {
  return JSON.parse(res.content[0].text);
}

const PROJECT = "e2e";

// Two real MCP sessions, like two terminals.
const backend = await openSession(PROJECT, "backend");
const frontend = await openSession(PROJECT, "frontend");

// frontend identity is registered on server startup, so backend can broadcast.
const who = parse(await frontend.callTool({ name: "bridge_whoami", arguments: {} }));
check("frontend whoami reports correct identity", who.project === "e2e" && who.role === "frontend");

// backend sends an addressed message to frontend.
const sent = parse(await backend.callTool({
  name: "bridge_send",
  arguments: { to: "frontend", body: "GET /users -> {id,name,email}" },
}));
check("backend send delivered to frontend", sent.ok && sent.delivered.includes("frontend"));

// backend broadcasts to everyone else.
const bc = parse(await backend.callTool({
  name: "bridge_send",
  arguments: { to: "*", body: "migration applied" },
}));
check("backend broadcast reached frontend", bc.delivered.includes("frontend"));
check("backend broadcast did NOT echo to backend", !bc.delivered.includes("backend"));

// frontend peeks (no consume) then receives (consume).
const peek = parse(await frontend.callTool({ name: "bridge_peek", arguments: {} }));
check("frontend peek sees 2 messages", peek.messages.length === 2);

const recv1 = parse(await frontend.callTool({ name: "bridge_recv", arguments: {} }));
check("frontend recv returns 2 messages in order", recv1.messages.length === 2 &&
  recv1.messages[0].body.includes("/users") && recv1.messages[1].body === "migration applied");

const recv2 = parse(await frontend.callTool({ name: "bridge_recv", arguments: {} }));
check("frontend recv again is empty (cursor advanced)", recv2.messages.length === 0);

// backend never received anything (it only sent).
const backRecv = parse(await backend.callTool({ name: "bridge_recv", arguments: {} }));
check("backend inbox is empty", backRecv.messages.length === 0);

// roles listing.
const roles = parse(await backend.callTool({ name: "bridge_roles", arguments: {} }));
check("both roles registered", roles.roles.includes("backend") && roles.roles.includes("frontend"));

await backend.close();
await frontend.close();

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
