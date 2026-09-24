import type { Role, User } from "@replicator/shared";
import { all, now, newId, one, run } from "../db/index.ts";
import { randomToken, sha256 } from "../crypto.ts";
import { hashPassword } from "./password.ts";

export const SESSION_COOKIE = "rep_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: Role;
  disabled: number;
  must_change_password: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    disabled: row.disabled === 1,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function countUsers(): Promise<number> {
  const row = await one<{ n: number }>("SELECT COUNT(*) AS n FROM users");
  return row?.n ?? 0;
}

export async function listUsers(): Promise<User[]> {
  const rows = await all<UserRow>("SELECT * FROM users ORDER BY created_at ASC");
  return rows.map(toUser);
}

export async function findUserById(id: string): Promise<User | null> {
  const row = await one<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
  return row ? toUser(row) : null;
}

export async function findUserRowByEmail(email: string): Promise<UserRow | null> {
  return one<UserRow>("SELECT * FROM users WHERE email = ?", [normalizeEmail(email)]);
}

export async function createUser(input: {
  email: string;
  name: string;
  password: string;
  role: Role;
  mustChangePassword?: boolean;
}): Promise<User> {
  const id = newId();
  const ts = now();
  const passwordHash = await hashPassword(input.password);
  await run(
    `INSERT INTO users (id, email, name, password_hash, role, disabled, must_change_password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      id,
      normalizeEmail(input.email),
      input.name,
      passwordHash,
      input.role,
      input.mustChangePassword ? 1 : 0,
      ts,
      ts,
    ],
  );
  return (await findUserById(id))!;
}

export async function updateUser(
  id: string,
  patch: { name?: string; role?: Role; disabled?: boolean },
): Promise<void> {
  const sets: string[] = [];
  const args: (string | number)[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    args.push(patch.name);
  }
  if (patch.role !== undefined) {
    sets.push("role = ?");
    args.push(patch.role);
  }
  if (patch.disabled !== undefined) {
    sets.push("disabled = ?");
    args.push(patch.disabled ? 1 : 0);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  args.push(now());
  args.push(id);
  await run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, args);
}

export async function setPassword(
  id: string,
  password: string,
  mustChange = false,
): Promise<void> {
  const passwordHash = await hashPassword(password);
  await run(
    "UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?",
    [passwordHash, mustChange ? 1 : 0, now(), id],
  );
}

export async function deleteUser(id: string): Promise<void> {
  await run("DELETE FROM users WHERE id = ?", [id]);
}

export async function markLogin(id: string): Promise<void> {
  await run("UPDATE users SET last_login_at = ? WHERE id = ?", [now(), id]);
}

/* ─────────────────────────────── Sessions ────────────────────────────────── */

export interface SessionRecord {
  id: string;
  userId: string;
  csrfToken: string;
  expiresAt: string;
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null },
): Promise<{ token: string; csrfToken: string; expiresAt: string }> {
  const token = randomToken(32);
  const id = sha256(token);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await run(
    `INSERT INTO sessions (id, user_id, csrf_token, user_agent, ip, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, csrfToken, meta.userAgent ?? null, meta.ip ?? null, now(), expiresAt],
  );
  return { token, csrfToken, expiresAt };
}

export async function getSessionByToken(
  token: string,
): Promise<{ session: SessionRecord; user: User } | null> {
  const id = sha256(token);
  const row = await one<{
    id: string;
    user_id: string;
    csrf_token: string;
    expires_at: string;
    revoked_at: string | null;
  }>("SELECT * FROM sessions WHERE id = ?", [id]);
  if (!row || row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  const user = await findUserById(row.user_id);
  if (!user || user.disabled) return null;
  return {
    session: {
      id: row.id,
      userId: row.user_id,
      csrfToken: row.csrf_token,
      expiresAt: row.expires_at,
    },
    user,
  };
}

export async function revokeSession(token: string): Promise<void> {
  const id = sha256(token);
  await run("UPDATE sessions SET revoked_at = ? WHERE id = ?", [now(), id]);
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", [
    now(),
    userId,
  ]);
}

export async function purgeExpiredSessions(): Promise<void> {
  await run("DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL", [now()]);
}
