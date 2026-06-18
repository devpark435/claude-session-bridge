// Fake `tmux` used to test the spawner's tmux driver deterministically.
// The daemon invokes us as: `<stub> send-keys -t <project:role> <prompt> Enter`.
// We simulate the live session that the nudge would have woken: act as that
// role — read its new messages and bounce a reply to the sender — which drives
// ping-pong so we can verify the per-project chain loop guard bounds it.
import { recv, register, send } from "../dist/bus.js";

const args = process.argv.slice(2);
const ti = args.indexOf("-t");
if (ti === -1 || args[0] !== "send-keys") process.exit(0);

const [project, role] = (args[ti + 1] || "").split(":");
if (!project || !role) process.exit(0);

const me = { project, role };
register(me);
const msgs = recv(me);
if (msgs.length > 0) {
  send(me, msgs[0].from, `tmux-ack from ${role}`);
}
