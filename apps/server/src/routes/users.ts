import type { FastifyInstance } from "fastify";
import { createUserSchema, updateUserSchema } from "@replicator/shared";
import { z } from "zod";
import { audit } from "../audit.ts";
import {
  createUser,
  deleteUser,
  findUserRowByEmail,
  listUsers,
  revokeAllSessionsForUser,
  setPassword,
  updateUser,
} from "../auth/sessions.ts";

const resetPasswordSchema = z.object({ password: z.string().min(8).max(400) });

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.requireAdmin);

  app.get("/api/users", async (_req, reply) => {
    return reply.send({ items: await listUsers() });
  });

  app.post("/api/users", { preHandler: app.requireCsrf }, async (req, reply) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid user payload", details: parsed.error.flatten() });
    }
    const existing = await findUserRowByEmail(parsed.data.email);
    if (existing) {
      return reply.code(409).send({ error: "conflict", message: "A user with that email already exists" });
    }
    const user = await createUser(parsed.data);
    await audit({ userId: req.auth!.user.id, action: "user.created", target: user.id, ip: req.ip });
    return reply.code(201).send({ user });
  });

  app.patch("/api/users/:id", { preHandler: app.requireCsrf }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid user payload" });
    }
    if (id === req.auth!.user.id && (parsed.data.disabled || parsed.data.role === "user")) {
      return reply.code(400).send({ error: "bad_request", message: "You cannot disable or demote yourself" });
    }
    await updateUser(id, parsed.data);
    if (parsed.data.disabled) await revokeAllSessionsForUser(id);
    await audit({ userId: req.auth!.user.id, action: "user.updated", target: id, data: parsed.data, ip: req.ip });
    return reply.send({ ok: true });
  });

  app.post("/api/users/:id/password", { preHandler: app.requireCsrf }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: "Password must be at least 8 characters" });
    }
    await setPassword(id, parsed.data.password, true);
    await revokeAllSessionsForUser(id);
    await audit({ userId: req.auth!.user.id, action: "user.password_reset", target: id, ip: req.ip });
    return reply.send({ ok: true });
  });

  app.delete("/api/users/:id", { preHandler: app.requireCsrf }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (id === req.auth!.user.id) {
      return reply.code(400).send({ error: "bad_request", message: "You cannot delete your own account" });
    }
    await deleteUser(id);
    await audit({ userId: req.auth!.user.id, action: "user.deleted", target: id, ip: req.ip });
    return reply.send({ ok: true });
  });
}
