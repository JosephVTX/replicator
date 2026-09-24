import { env } from "../env.ts";
import { listPendingJobs, updateJob } from "../services/replicas.ts";
import { runJob } from "../agent/runner.ts";

class JobQueue {
  private queued: string[] = [];
  private running = new Set<string>();

  add(jobId: string): void {
    if (this.running.has(jobId) || this.queued.includes(jobId)) return;
    this.queued.push(jobId);
    void this.pump();
  }

  private async pump(): Promise<void> {
    while (this.running.size < env.MAX_CONCURRENT_JOBS && this.queued.length > 0) {
      const jobId = this.queued.shift()!;
      if (this.running.has(jobId)) continue;
      this.running.add(jobId);
      void runJob(jobId)
        .catch(async (err) => {
          const message = err instanceof Error ? err.message : String(err);
          await updateJob(jobId, {
            status: "failed",
            error: message,
            finishedAt: new Date().toISOString(),
          }).catch(() => undefined);
        })
        .finally(() => {
          this.running.delete(jobId);
          void this.pump();
        });
    }
  }

  async recover(): Promise<void> {
    const pending = await listPendingJobs();
    for (const job of pending) this.add(job.id);
  }

  get status() {
    return { running: this.running.size, queued: this.queued.length };
  }
}

export const jobQueue = new JobQueue();
