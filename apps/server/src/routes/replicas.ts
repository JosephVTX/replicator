import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createReplicaSchema, portVariantSchema, updateReplicaSchema } from "@replicator/shared";
import { audit } from "../audit.ts";
import { PATHS, replicaDir } from "../paths.ts";
import { jobQueue } from "../jobs/queue.ts";
import {
  createJob,
  createReplica,
  deleteReplica,
  ensureVariant,
  getReplica,
  getVariant,
  listJobs,
  listReplicas,
  listVariants,
  listVersions,
  touchReplica,
  updateReplica,
} from "../services/replicas.ts";

async function loadOwned(req: FastifyRequest, reply: FastifyReply, id: string) {
  const replica = await getReplica(id);
  if (!replica) {
    await reply.code(404).send({ error: "not_found", message: "Replica not found" });
    return null;
  }
  if (req.auth!.user.role !== "admin" && replica.ownerId !== req.auth!.user.id) {
    await reply.code(403).send({ error: "forbidden", message: "You do not have access to this replica" });
    return null;
  }
  return replica;
}

export async function replicaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.requireAuth);

  app.get("/api/replicas", async (req, reply) => {
    const items = await listReplicas({ ownerId: req.auth!.user.id, isAdmin: req.auth!.user.role === "admin" });
    const withVariants = await Promise.all(
      items.map(async (replica) => ({ ...replica, variants: await listVariants(replica.id) })),
    );
    return reply.send({ items: withVariants });
  });

  app.post("/api/replicas", { preHandler: app.requireCsrf }, async (req, reply) => {
    const parsed = createReplicaSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid replica payload", details: parsed.error.flatten() });
    }
    const replica = await createReplica({ ...parsed.data, ownerId: req.auth!.user.id });
    const variant = await ensureVariant(replica.id, parsed.data.uiKit);
    const job = await createJob({ replicaId: replica.id, variantId: variant.id, type: "replicate" });
    jobQueue.add(job.id);
    await audit({ userId: req.auth!.user.id, action: "replica.created", target: replica.id, ip: req.ip });
    return reply.code(201).send({ replica, job });
  });

  app.get("/api/replicas/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const replica = await loadOwned(req, reply, id);
    if (!replica) return;
    const variants = await listVariants(replica.id);
    const variantsWithVersions = await Promise.all(
      variants.map(async (v) => ({ ...v, versions: await listVersions(v.id) })),
    );
    const jobs = await listJobs({ replicaId: replica.id, limit: 25 });
    return reply.send({ replica, variants: variantsWithVersions, jobs });
  });

  app.patch("/api/replicas/:id", { preHandler: app.requireCsrf }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const replica = await loadOwned(req, reply, id);
    if (!replica) return;
    const parsed = updateReplicaSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid replica payload" });
    }
    if (parsed.data.activeVariantId) {
      const variant = await getVariant(parsed.data.activeVariantId);
      if (!variant || variant.replicaId !== replica.id) {
        return reply.code(400).send({ error: "bad_request", message: "Unknown variant" });
      }
    }
    await updateReplica(id, parsed.data);
    return reply.send({ ok: true });
  });

  app.delete("/api/replicas/:id", { preHandler: app.requireCsrf }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const replica = await loadOwned(req, reply, id);
    if (!replica) return;
    await deleteReplica(id);
    fs.rmSync(replicaDir(id), { recursive: true, force: true });
    fs.rmSync(path.join(PATHS.builds, id), { recursive: true, force: true });
    await audit({ userId: req.auth!.user.id, action: "replica.deleted", target: id, ip: req.ip });
    return reply.send({ ok: true });
  });

  app.post("/api/replicas/:id/run", { preHandler: app.requireCsrf }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const replica = await loadOwned(req, reply, id);
    if (!replica) return;
    const body = (req.body ?? {}) as { variantId?: string };
    const variants = await listVariants(replica.id);
    const variant = body.variantId ? variants.find((v) => v.id === body.variantId) : variants[0];
    if (!variant) return reply.code(400).send({ error: "bad_request", message: "No variant to run" });
    const job = await createJob({ replicaId: replica.id, variantId: variant.id, type: "replicate" });
    jobQueue.add(job.id);
    await touchReplica(replica.id);
    return reply.send({ job });
  });

  app.post("/api/replicas/:id/port", { preHandler: app.requireCsrf }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const replica = await loadOwned(req, reply, id);
    if (!replica) return;
    const parsed = portVariantSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: "Invalid port payload" });
    const variant = await ensureVariant(replica.id, parsed.data.uiKit);
    const job = await createJob({ replicaId: replica.id, variantId: variant.id, type: "port" });
    jobQueue.add(job.id);
    await audit({ userId: req.auth!.user.id, action: "replica.port", target: replica.id, data: parsed.data, ip: req.ip });
    return reply.send({ job, variant });
  });

  app.get("/api/replicas/:id/jobs", async (req, reply) => {
    const { id } = req.params as { id: string };
    const replica = await loadOwned(req, reply, id);
    if (!replica) return;
    return reply.send({ items: await listJobs({ replicaId: replica.id, limit: 50 }) });
  });

  app.get("/api/replicas/:id/download", async (req, reply) => {
    const { id } = req.params as { id: string };
    const replica = await loadOwned(req, reply, id);
    if (!replica) return;
    const query = req.query as { variantId?: string; version?: string };
    const variants = await listVariants(replica.id);
    const variant = query.variantId ? variants.find((v) => v.id === query.variantId) : variants[0];
    if (!variant || variant.version === 0) {
      return reply.code(404).send({ error: "not_found", message: "No built version to download yet" });
    }
    const version = query.version ? Number(query.version) : variant.version;
    const zipPath = path.join(PATHS.builds, replica.id, `${variant.uiKit}-v${version}.zip`);
    if (!fs.existsSync(zipPath)) {
      return reply.code(404).send({ error: "not_found", message: "That version is not available" });
    }
    const filename = `${replica.slug}-${variant.uiKit}-v${version}.zip`;
    reply.header("content-type", "application/zip");
    reply.header("content-disposition", `attachment; filename="${filename}"`);
    return reply.send(fs.createReadStream(zipPath));
  });

  app.get("/api/replicas/:id/build-url", async (req, reply) => {
    const { id } = req.params as { id: string };
    const replica = await loadOwned(req, reply, id);
    if (!replica) return;
    const variants = await listVariants(replica.id);
    return reply.send({
      paths: variants.map((v) => ({
        uiKit: v.uiKit,
        variantId: v.id,
        path: `/r/${replica.slug}/${v.uiKit}/`,
        ready: v.status === "ready",
      })),
    });
  });
}
