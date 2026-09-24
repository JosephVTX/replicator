import { now, run } from "./db/index.ts";

export async function audit(input: {
  userId?: string | null;
  action: string;
  target?: string | null;
  ip?: string | null;
  data?: unknown;
}): Promise<void> {
  try {
    await run(
      "INSERT INTO audit_log (at, user_id, action, target, ip, data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        now(),
        input.userId ?? null,
        input.action,
        input.target ?? null,
        input.ip ?? null,
        input.data === undefined ? null : JSON.stringify(input.data),
      ],
    );
  } catch {
    /* audit must never break the request */
  }
}
