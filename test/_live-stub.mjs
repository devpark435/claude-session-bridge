// A stand-in for a live `claude` session, used to test the tmux driver against
// REAL tmux (real panes, real send-keys). It registers its tmux pane (like the
// real MCP server does) and, on each line typed into the pane by the daemon,
// reads its new messages and replies — driving real ping-pong.
import readline from "node:readline";
import { recv, register, registerSession, send } from "../dist/bus.js";

const me = { project: process.env.BRIDGE_PROJECT, role: process.env.BRIDGE_ROLE };
register(me);
registerSession(me); // writes $TMUX_PANE so the daemon can find this pane

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", () => {
  const msgs = recv(me);
  if (msgs.length > 0) send(me, msgs[0].from, `live-ack from ${me.role}`);
});
// stay alive
