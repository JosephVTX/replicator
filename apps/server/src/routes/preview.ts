import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { PATHS, variantBuildDir } from "../paths.ts";
import { getJob, listJobEvents, listReplicas, getReplicaBySlug, listVariants, updateJob } from "../services/replicas.ts";

export async function jobRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.requireAuth);

  app.get("/api/jobs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await getJob(id);
    if (!job) return reply.code(404).send({ error: "not_found", message: "Job not found" });
    const replica = (await listReplicas({ isAdmin: true })).find((r) => r.id === job.replicaId);
    if (req.auth!.user.role !== "admin" && replica && replica.ownerId !== req.auth!.user.id) {
      return reply.code(403).send({ error: "forbidden", message: "No access to this job" });
    }
    return reply.send({ job, events: await listJobEvents(job.id) });
  });

  app.get("/api/jobs/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await getJob(id);
    if (!job) return reply.code(404).send({ error: "not_found", message: "Job not found" });
    return reply.send({ items: await listJobEvents(job.id) });
  });

  app.post("/api/jobs/:id/cancel", { preHandler: app.requireCsrf }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await getJob(id);
    if (!job) return reply.code(404).send({ error: "not_found", message: "Job not found" });
    if (job.status === "running" || job.status === "queued") {
      await updateJob(id, { status: "canceled", message: "Canceled by user", finishedAt: new Date().toISOString() });
    }
    return reply.send({ ok: true });
  });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export async function previewRoutes(app: FastifyInstance): Promise<void> {
  app.get("/r/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const replica = await getReplicaBySlug(slug);
    if (!replica) return reply.code(404).send({ error: "not_found", message: "Replica not found" });
    const variants = await listVariants(replica.id);
    const active = variants.find((v) => v.id === replica.activeVariantId) ?? variants[0];
    if (!active) return reply.code(404).send({ error: "not_found", message: "No variants" });
    return reply.redirect(`/r/${slug}/${active.uiKit}/`);
  });

  app.get("/r/:slug/:uiKit", async (req, reply) => {
    const { slug, uiKit } = req.params as { slug: string; uiKit: string };
    return reply.redirect(`/r/${slug}/${uiKit}/`);
  });

  app.get("/r/:slug/:uiKit/*", async (req, reply) => {
    const { slug, uiKit } = req.params as { slug: string; uiKit: string; "*": string };
    const replica = await getReplicaBySlug(slug);
    if (!replica) return reply.code(404).send({ error: "not_found", message: "Replica not found" });
    if (!replica.isPublic && !req.auth) {
      return reply.code(401).send({ error: "unauthorized", message: "This replica is private" });
    }
    if (uiKit !== "shadcn" && uiKit !== "daisyui") {
      return reply.code(404).send({ error: "not_found", message: "Unknown UI kit" });
    }
    const root = variantBuildDir(replica.id, uiKit);
    if (!fs.existsSync(root)) {
      return reply.code(404).send({ error: "not_found", message: "This replica has not been built yet" });
    }
    const rel = (req.params as Record<string, string>)["*"] || "index.html";
    const candidate = path.resolve(root, rel);
    if (!candidate.startsWith(path.resolve(root))) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid path" });
    }
    let file = candidate;
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(root, "index.html"); // SPA fallback
    }
    if (!fs.existsSync(file)) {
      return reply.code(404).send({ error: "not_found", message: "Not found" });
    }
    reply.header("content-type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
    return reply.send(fs.createReadStream(file));
  });
}
