import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { env, isProd } from "./env.ts";
import { PATHS, ensureDirs } from "./paths.ts";
import { db, migrate } from "./db/index.ts";
import { bootstrapAdmin } from "./bootstrap.ts";
import { authPlugin } from "./auth/plugin.ts";
import { purgeExpiredSessions } from "./auth/sessions.ts";
import { authRoutes } from "./routes/auth.ts";
import { userRoutes } from "./routes/users.ts";
import { replicaRoutes } from "./routes/replicas.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { jobRoutes, previewRoutes } from "./routes/preview.ts";
import { agent } from "./agent/opencode.ts";
import { jobQueue } from "./jobs/queue.ts";
import { recoverInterruptedJobs } from "./services/replicas.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(here, "../../web/dist");

async function main(): Promise<void> {
  ensureDirs();
  await migrate();
  await bootstrapAdmin();
  await purgeExpiredSessions();

  const app = Fastify({
    trustProxy: true,
    bodyLimit: 16 * 1024 * 1024,
    logger: isProd
      ? { level: "info" }
      : { level: "info", transport: undefined },
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(authPlugin);

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(replicaRoutes);
  await app.register(settingsRoutes);
  await app.register(jobRoutes);
  await app.register(previewRoutes);

  app.get("/api/health", async () => ({
    status: "ok",
    opencode: await agent.health(),
    queue: jobQueue.status,
  }));

  // Serve the built admin panel (present in the container image).
  if (fs.existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, { root: WEB_DIST, prefix: "/", wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== "GET" || req.url.startsWith("/api") || req.url.startsWith("/r/")) {
        return reply.code(404).send({ error: "not_found", message: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`Replicator listening on ${env.PUBLIC_BASE_URL} (port ${env.PORT})`);
  app.log.info(`Data directory: ${PATHS.data}`);

  // Fire up the agent engine and resume any interrupted work.
  agent.ensureStarted().catch((err) => app.log.error(err, "opencode failed to start"));
  await recoverInterruptedJobs();
  await jobQueue.recover();

  const interval = setInterval(() => {
    void purgeExpiredSessions().catch(() => undefined);
  }, 60 * 60 * 1000);
  interval.unref();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}, shutting down…`);
    try {
      await app.close();
      await agent.stop();
      db.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
