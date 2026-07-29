import { randomUUID } from 'node:crypto';
import type { Job, GenParams } from './types.js';

// In-memory job records. With Runware there is no worker queue/long-poll: the
// server kicks off generation itself (stateMachine -> runware.generateWithRunware)
// and the job is resolved via completeJob / failJob, which fire the handlers the
// state machine registered.

const jobs = new Map<string, Job>();

interface JobHandlers {
  onDone: (job: Job) => void;
  onFail: (job: Job) => void;
}
let handlers: JobHandlers | undefined;

export function setJobHandlers(h: JobHandlers): void {
  handlers = h;
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
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
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
