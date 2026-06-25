import { randomUUID } from 'node:crypto';
import type { Job, GenParams } from './types.js';

// In-memory job queue (spec §3, §12.2). Worker mode: jobs sit `queued` for the
// outbound poll-worker. Tunnel mode: the server calls Forge directly (forgeDirect).

const jobs = new Map<string, Job>();

let lastPollAt = 0;

interface JobHandlers {
  onDone: (job: Job) => void;
  onFail: (job: Job) => void;
}
let handlers: JobHandlers | undefined;

export function setJobHandlers(h: JobHandlers): void {
  handlers = h;
}

// Long-poll waiters for GET /worker/next-job.
type Waiter = (job: Job | null) => void;
const waiters: Waiter[] = [];

export function getLastPollAt(): number {
  return lastPollAt;
}

export function createJob(
  prompt: string,
  genParams: GenParams,
  turnPromptingTeamId: string,
): Job {
  const job: Job = {
    id: randomUUID(),
    status: 'queued',
    prompt,
    genParams,
    createdAt: Date.now(),
    turnPromptingTeamId,
  };
  jobs.set(job.id, job);
  // Hand off to a waiting worker immediately if one is parked on the long-poll.
  const waiter = waiters.shift();
  if (waiter) deliver(waiter, job);
  return job;
}

function deliver(waiter: Waiter, job: Job): void {
  job.status = 'claimed';
  job.claimedAt = Date.now();
  waiter(job);
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/** Long-poll: resolve immediately with the oldest queued job, else park the
 *  request up to `timeoutMs` (~25s) and resolve null on timeout. */
export function nextJob(timeoutMs = 25_000): Promise<Job | null> {
  lastPollAt = Date.now();
  const queued = [...jobs.values()]
    .filter((j) => j.status === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (queued) {
    queued.status = 'claimed';
    queued.claimedAt = Date.now();
    return Promise.resolve(queued);
  }
  return new Promise<Job | null>((resolve) => {
    const waiter: Waiter = (job) => resolve(job);
    waiters.push(waiter);
    const timer = setTimeout(() => {
      const idx = waiters.indexOf(waiter);
      if (idx >= 0) waiters.splice(idx, 1);
      resolve(null);
    }, timeoutMs);
    // Ensure timer doesn't keep the process alive.
    if (typeof timer.unref === 'function') timer.unref();
  });
}

export function markPolled(): void {
  lastPollAt = Date.now();
}

export function completeJob(id: string, images: string[]): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  job.status = 'done';
  job.images = images;
  handlers?.onDone(job);
  return true;
}

export function failJob(id: string, error: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  job.status = 'failed';
  job.error = error;
  handlers?.onFail(job);
  return true;
}

/** Re-queue a job with fresh id (operator "Regenerate" with new seeds). */
export function requeueAsNew(prompt: string, genParams: GenParams, teamId: string): Job {
  return createJob(prompt, genParams, teamId);
}
