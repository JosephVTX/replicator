import type { FastifyInstance } from "fastify";
import { changePasswordSchema, loginSchema } from "@replicator/shared";
import { audit } from "../audit.ts";
import { verifyPassword } from "../auth/password.ts";
import {
  createSession,
  findUserRowByEmail,
  findUserById,
  markLogin,
  revokeSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  setPassword,
} from "../auth/sessions.ts";
import { env } from "../env.ts";

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid credentials payload" });
    }
    const { email, password } = parsed.data;
    const row = await findUserRowByEmail(email);
    // Constant-ish work whether or not the user exists.
    const ok = row ? await verifyPassword(row.password_hash, password) : false;
    if (!row || !ok || row.disabled === 1) {
      await audit({ action: "login.failed", target: email, ip: req.ip });
      return reply.code(401).send({ error: "invalid_credentials", message: "Email or password is incorrect" });
    }
    const { token, csrfToken } = await createSession(row.id, {
      userAgent: req.headers["user-agent"] ?? null,
      ip: req.ip,
    });
    await markLogin(row.id);
    await audit({ userId: row.id, action: "login.success", ip: req.ip });
    reply.setCookie(SESSION_COOKIE, token, cookieOptions());
    const user = (await findUserById(row.id))!;
    return reply.send({ user, csrfToken });
  });

  app.post("/api/auth/logout", { preHandler: app.requireAuth }, async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await revokeSession(token);
    await audit({ userId: req.auth!.user.id, action: "logout", ip: req.ip });
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.send({ ok: true });
  });

  app.get("/api/auth/me", async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: "unauthorized", message: "Not signed in" });
    return reply.send({ user: req.auth.user, csrfToken: req.auth.session.csrfToken });
  });

  app.post(
    "/api/auth/password",
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Invalid password payload" });
      }
      const user = req.auth!.user;
      if (user.role !== "admin") {
        const row = await findUserRowByEmail(user.email);
        const ok = row ? await verifyPassword(row.password_hash, parsed.data.currentPassword ?? "") : false;
        if (!ok) {
          return reply.code(400).send({ error: "invalid_password", message: "Current password is incorrect" });
        }
      }
      await setPassword(user.id, parsed.data.newPassword, false);
      await audit({ userId: user.id, action: "password.changed", ip: req.ip });
      return reply.send({ ok: true });
    },
  );
}
