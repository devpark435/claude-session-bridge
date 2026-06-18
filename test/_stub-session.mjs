// Fake "session" used to test the spawner deterministically (no Claude/auth).
// The spawner launches this in place of `claude`. It behaves like a session
// woken by the bridge: read my new messages, then reply to the sender — which
// drives ping-pong so we can verify loop-guard / rate-limit / cursor logic.
import { identity, recv, register, send } from "../dist/bus.js";

const me = identity();
register(me);
const msgs = recv(me);
if (msgs.length > 0) {
  const target = msgs[0].from; // bounce back to whoever last messaged us
  send(me, target, `ack from ${me.role} for ${msgs.length} msg(s)`);
}
