#!/usr/bin/env node
/**
 * Stop hook — optional auto-send (opt-in).
 *
 * When BRIDGE_AUTOSEND=1, this broadcasts this session's last assistant message
 * to the rest of the project when a turn ends. Off by default: prefer the
 * deliberate `bridge_send` tool so only meaningful results are shared, not the
 * full transcript. Destination overridable via BRIDGE_SEND_TO (default "*").
 */
import { readFileSync } from "node:fs";
import { maybeIdentity, register, send } from "../bus.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function lastAssistantText(transcriptPath: string): string | null {
  try {
    const lines = readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const ev = JSON.parse(lines[i]);
      const content = ev?.message?.content;
      if (ev?.type === "assistant" && Array.isArray(content)) {
        const t = content
          .filter((b: any) => b?.type === "text")
          .map((b: any) => b.text)
          .join("\n")
          .trim();
        if (t) return t;
      }
    }
  } catch {
    // ignore parse errors — best effort
  }
  return null;
}

async function main(): Promise<void> {
  if (process.env.BRIDGE_AUTOSEND !== "1") process.exit(0);
  const me = maybeIdentity();
  if (!me) process.exit(0);

  const raw = await readStdin();
  let payload: any = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    // no payload — nothing to send
  }

  const transcript = payload?.transcript_path;
  const body = transcript ? lastAssistantText(transcript) : null;
  if (!body) process.exit(0);

  register(me);
  send(me, process.env.BRIDGE_SEND_TO || "*", body);
  process.exit(0);
}

main();
