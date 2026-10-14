import "server-only";
import crypto from "node:crypto";
import type { JobDTO } from "./types";

// A tiny in-process job runner. Long model calls run here, off the request path,
// and the browser polls /api/jobs/{id} for the current step.

const g = globalThis as unknown as { __cdaJobs?: Map<string, JobDTO & { siteId: number; finishedAt?: number }> };
const jobs = (g.__cdaJobs ??= new Map());

export interface JobContext {
  step(label: string): void;
  warn(msg: string): void;
}

export function startJob(
  siteId: number,
  kind: JobDTO["kind"],
  firstStep: string,
  run: (ctx: JobContext) => Promise<string>,
  onError: (err: unknown) => string,
): JobDTO {
  const id = crypto.randomUUID();
  const job: JobDTO & { siteId: number; finishedAt?: number } = {
    id,
    kind,
    status: "running",
    step: firstStep,
    siteId,
    warnings: [],
  };
  jobs.set(id, job);
  const ctx: JobContext = {
    step: (label) => {
      job.step = label;
    },
    warn: (msg) => {
      job.warnings!.push(msg);
    },
  };
  // Detached on purpose: the request returns immediately with the job id.
  void (async () => {
    try {
      job.message = await run(ctx);
      job.status = "done";
    } catch (err) {
      job.status = "failed";
      job.error = onError(err);
      if (!(err instanceof Error && err.name === "UserFacingError")) console.error(`[job ${kind}]`, err);
    } finally {
      job.finishedAt = Date.now();
      prune();
    }
  })();
  return publicJob(job);
}

export function getJob(id: string): JobDTO | null {
  const j = jobs.get(id);
  return j ? publicJob(j) : null;
}

export function runningJobFor(siteId: number, kind: JobDTO["kind"]): JobDTO | null {
  for (const j of jobs.values()) if (j.siteId === siteId && j.kind === kind && j.status === "running") return publicJob(j);
  return null;
}

function publicJob(j: JobDTO): JobDTO {
  return { id: j.id, kind: j.kind, status: j.status, step: j.step, error: j.error, message: j.message, warnings: j.warnings };
}

function prune() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, j] of jobs) if (j.finishedAt && j.finishedAt < cutoff) jobs.delete(id);
}
