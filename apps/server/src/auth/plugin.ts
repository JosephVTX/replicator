import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { User } from "@replicator/shared";
import { getSessionByToken, SESSION_COOKIE, type SessionRecord } from "./sessions.ts";
import { timingSafeEqual } from "../crypto.ts";

export interface AuthContext {
  user: User;
  session: SessionRecord;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    requireCsrf: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  }
}

export const authPlugin = fp(
  async (app) => {
    app.decorateRequest("auth", null);

    app.addHook("onRequest", async (req) => {
      const token = req.cookies?.[SESSION_COOKIE];
      if (!token) return;
      const res = await getSessionByToken(token);
      if (res) req.auth = { user: res.user, session: res.session };
    });

    app.decorate("requireAuth", async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.auth) {
        await reply.code(401).send({ error: "unauthorized", message: "Authentication required" });
        return reply;
      }
    });

    app.decorate("requireAdmin", async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.auth) {
        await reply.code(401).send({ error: "unauthorized", message: "Authentication required" });
        return reply;
      }
      if (req.auth.user.role !== "admin") {
        await reply.code(403).send({ error: "forbidden", message: "Administrator role required" });
        return reply;
      }
    });

    app.decorate("requireCsrf", async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.auth) {
        await reply.code(401).send({ error: "unauthorized", message: "Authentication required" });
        return reply;
      }
      const header = req.headers["x-csrf-token"];
      if (typeof header !== "string" || !timingSafeEqual(header, req.auth.session.csrfToken)) {
        await reply.code(403).send({ error: "csrf", message: "Invalid CSRF token" });
        return reply;
      }
    });
  },
  { name: "auth-plugin" },
);
