/**
 * Session Bridge — shared file bus.
 *
 * Addressing: every session has an identity (project, role). Messages are
 * delivered into the recipient role's inbox under the project namespace, so
 * projects are isolated by path construction (project A can never read B).
 *
 * Bus layout:
 *   <root>/<project>/<role>.inbox.jsonl   append-only message log per role
 *   <root>/<project>/.cursors/<role>.cursor   how many lines this role consumed
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface Envelope {
  id: string;
  project: string;
  from: string;
  to: string; // a role name, or "*" for everyone else in the project
  ts: number;
  origin_session?: string;
  body: string;
  hop: number; // loop-guard counter; increments each bridge step
}

export interface Identity {
  project: string;
  role: string;
  session?: string;
}

export function busRoot(): string {
  return process.env.BRIDGE_ROOT || join(homedir(), ".claude", "bridge");
}

/** Read identity from the environment. Throws if not a bridged session. */
export function identity(): Identity {
  const project = process.env.BRIDGE_PROJECT;
  const role = process.env.BRIDGE_ROLE;
  if (!project || !role) {
    throw new Error(
      "Session Bridge: BRIDGE_PROJECT and BRIDGE_ROLE must be set. " +
        "Launch with e.g. `BRIDGE_PROJECT=myapp BRIDGE_ROLE=backend claude`.",
    );
  }
  return {
    project,
    role,
    session: process.env.CLAUDE_SESSION_ID || process.env.BRIDGE_SESSION,
  };
}

/** Identity without throwing — returns null when the session is not bridged. */
export function maybeIdentity(): Identity | null {
  if (!process.env.BRIDGE_PROJECT || !process.env.BRIDGE_ROLE) return null;
  return identity();
}

function projectDir(project: string): string {
  return join(busRoot(), project);
}
function inboxPath(project: string, role: string): string {
  return join(projectDir(project), `${role}.inbox.jsonl`);
}
function cursorDir(project: string): string {
  return join(projectDir(project), ".cursors");
}
function cursorPath(project: string, role: string): string {
  return join(cursorDir(project), `${role}.cursor`);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** List roles that have registered an inbox in a project. */
export function listRoles(project: string): string[] {
  const dir = projectDir(project);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".inbox.jsonl"))
    .map((f) => f.slice(0, -".inbox.jsonl".length))
    .sort();
}

/** Make this role visible to broadcasts by ensuring its inbox file exists. */
export function register(me: Identity): void {
  ensureDir(projectDir(me.project));
  const p = inboxPath(me.project, me.role);
  if (!existsSync(p)) writeFileSync(p, "");
}

function sessionsDir(project: string): string {
  return join(projectDir(project), ".sessions");
}

/**
 * Record this session's tmux pane id (from $TMUX_PANE) so the spawner's tmux
 * driver can find the live session to drive. No-op outside tmux.
 */
export function registerSession(me: Identity): void {
  const pane = process.env.TMUX_PANE;
  if (!pane) return;
  ensureDir(sessionsDir(me.project));
  writeFileSync(join(sessionsDir(me.project), `${me.role}.pane`), pane.trim());
}

/** The tmux pane id registered for a role's live session, or null. */
export function getSessionPane(project: string, role: string): string | null {
  const p = join(sessionsDir(project), `${role}.pane`);
  if (!existsSync(p)) return null;
  const v = readFileSync(p, "utf8").trim();
  return v || null;
}

/**
 * Send a message. `to` is a role name or "*" (everyone else in the project).
 * Returns the list of roles the message was actually delivered to.
 */
export function send(
  from: Identity,
  to: string,
  body: string,
): { envelope: Envelope; delivered: string[] } {
  // hop chains across spawned sessions: a session woken to handle a hop-N
  // message exports BRIDGE_HOP=N, so its replies are stamped hop N+1.
  const hop = (parseInt(process.env.BRIDGE_HOP || "", 10) || 0) + 1;
  const envelope: Envelope = {
    id: randomUUID(),
    project: from.project,
    from: from.role,
    to,
    ts: Date.now(),
    origin_session: from.session,
    body,
    hop,
  };

  ensureDir(projectDir(from.project));

  let targets: string[];
  if (to === "*") {
    targets = listRoles(from.project).filter((r) => r !== from.role);
  } else {
    targets = [to];
  }

  const line = JSON.stringify(envelope) + "\n";
  for (const t of targets) {
    appendFileSync(inboxPath(from.project, t), line);
  }
  return { envelope, delivered: targets };
}

function readCursor(project: string, role: string): number {
  const p = cursorPath(project, role);
  if (!existsSync(p)) return 0;
  const n = parseInt(readFileSync(p, "utf8").trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function writeCursor(project: string, role: string, n: number): void {
  ensureDir(cursorDir(project));
  writeFileSync(cursorPath(project, role), String(n));
}

/** All messages in a role's inbox (used by recv, tail, and the spawner). */
export function inboxMessages(project: string, role: string): Envelope[] {
  const p = inboxPath(project, role);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Envelope);
}

/**
 * Read unconsumed messages from my own inbox.
 * Advances the cursor unless `peek` is set.
 */
export function recv(me: Identity, opts: { peek?: boolean } = {}): Envelope[] {
  const all = inboxMessages(me.project, me.role);
  const cur = readCursor(me.project, me.role);
  const fresh = all.slice(cur);
  if (!opts.peek) writeCursor(me.project, me.role, all.length);
  // Defensive echo guard (we never write to our own inbox, but just in case).
  return fresh.filter((e) => e.from !== me.role);
}

/**
 * Named cursors let other components (e.g. the spawner) track how far they
 * have independently reacted to a role's inbox, without disturbing the role's
 * own read cursor. Use a distinct name like `__spawner__frontend`.
 */
export function getCursor(project: string, name: string): number {
  return readCursor(project, name);
}
export function setCursor(project: string, name: string, n: number): void {
  writeCursor(project, name, n);
}

/** Full inbox contents regardless of cursor (for inspection). */
export function tail(project: string, role: string, limit = 50): Envelope[] {
  const all = inboxMessages(project, role);
  return all.slice(Math.max(0, all.length - limit));
}
