#!/usr/bin/env node
/**
 * UserPromptSubmit hook — auto-receive.
 *
 * Runs on every prompt. If this session is bridged and has unread messages,
 * it injects them into the model's context. No-ops silently otherwise so it
 * is safe to install globally across all sessions.
 */
import { maybeIdentity, recv, register, registerSession } from "../bus.js";

function main(): void {
  const me = maybeIdentity();
  if (!me) process.exit(0); // not a bridged session — do nothing

  register(me);
  registerSession(me); // keep this session's tmux pane registration fresh
  const messages = recv(me);
  if (messages.length === 0) process.exit(0);

  const lines = messages.map((m) => {
    const when = new Date(m.ts).toISOString();
    return `- from \`${m.from}\` (${when}):\n  ${m.body.replace(/\n/g, "\n  ")}`;
  });

  const additionalContext =
    `## Session Bridge — ${messages.length} new message(s) for role \`${me.role}\` in project \`${me.project}\`\n` +
    `These were sent by sibling sessions. Use them as inputs to the current work.\n\n` +
    lines.join("\n");

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext,
      },
    }),
  );
  process.exit(0);
}

main();
