#!/usr/bin/env node
/**
 * PreToolUse hook — hard-block git commit/push/reset.
 *
 * The spawner's `--disallowed-tools` only protects spawned `claude -p` sessions.
 * When the tmux driver drives a LIVE interactive session instead, those flags
 * don't apply — so install this hook in settings.json to deny commits/pushes in
 * any session, however its turn was triggered. The user commits manually.
 *
 * Configure which commands are blocked with BRIDGE_BLOCK_GIT (regex). Default
 * blocks commit/push/reset. The hook only inspects Bash tool calls.
 */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c) => chunks.push(c as Buffer));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

function allow(): never {
  process.exit(0); // no output = allow
}

function deny(reason: string): never {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let payload: any = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    allow();
  }

  if (payload?.tool_name !== "Bash") allow();
  const command: string = payload?.tool_input?.command ?? "";

  const pattern =
    process.env.BRIDGE_BLOCK_GIT || "\\bgit\\b[^\\n]*\\b(commit|push|reset)\\b";
  const re = new RegExp(pattern);
  if (re.test(command)) {
    deny(
      "Session Bridge: git commit/push/reset is blocked here. The user commits " +
        "manually after testing. (Configure via BRIDGE_BLOCK_GIT.)",
    );
  }
  allow();
}

main();
