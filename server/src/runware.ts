import { randomUUID } from 'node:crypto';
import type { Job } from './types.js';
import { completeJob, failJob } from './jobs.js';
import { state } from './state.js';

// Runware image-generation API client. Replaces the local poll-worker + Forge
// stack: the server calls Runware directly and receives image URLs.
//
// Docs: https://runware.ai/docs — the HTTP endpoint accepts an array of task
// objects; here we send a single `imageInference` task. Auth is the API key as a
// Bearer token (env RUNWARE_API_KEY, overridable per-session in Settings).

const RUNWARE_ENDPOINT = 'https://api.runware.ai/v1';

interface RunwareImageResult {
  taskType: string;
  taskUUID: string;
  imageUUID?: string;
  imageURL?: string;
  imageBase64Data?: string;
  NSFWContent?: boolean;
  cost?: number;
}
interface RunwareResponse {
  data?: RunwareImageResult[];
  errors?: { message?: string; code?: string; parameter?: string }[];
}

function apiKey(): string {
  return state.settings.runware.apiKey?.trim() || process.env.RUNWARE_API_KEY || '';
}

export function isConfigured(): boolean {
  return apiKey().length > 0;
}

/** Generate images for a job via Runware, then resolve the job (completeJob /
 *  failJob) so the state machine advances exactly as the old worker path did. */
export async function generateWithRunware(job: Job): Promise<void> {
  const key = apiKey();
  if (!key) {
    failJob(job.id, 'Runware API key is not set (RUNWARE_API_KEY env or Settings).');
    return;
  }

  const p = job.genParams;
  const s = state.settings;
  const task: Record<string, unknown> = {
    taskType: 'imageInference',
    taskUUID: randomUUID(),
    positivePrompt: job.prompt,
    negativePrompt: p.negativePrompt,
    model: s.runware.model,
    width: p.width,
    height: p.height,
    numberResults: p.batchSize,
    steps: p.steps,
    CFGScale: p.cfgScale,
    // Deliver hosted URLs (light on server memory); <img> renders them directly.
    outputType: 'URL',
    outputFormat: 'JPG',
    // Runware-side NSFW screen: flagged images are dropped before use (a safety
    // layer that replaces the old worker-side classifier). NSFW stays disallowed
    // unconditionally — there is no toggle.
    checkNSFW: true,
  };
  if (s.runware.scheduler.trim()) task.scheduler = s.runware.scheduler.trim();
  if (p.seedMode === 'fixed') task.seed = 1234;

  try {
    const res = await fetch(RUNWARE_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify([task]),
      signal: AbortSignal.timeout(120_000),
    });

    const body = (await res.json().catch(() => ({}))) as RunwareResponse;

    if (!res.ok || body.errors?.length) {
      const msg = body.errors?.map((e) => e.message).filter(Boolean).join('; ') || `HTTP ${res.status}`;
      failJob(job.id, `Runware error: ${msg}`);
      return;
    }

    const results = (body.data ?? []).filter((d) => d.taskType === 'imageInference');
    // Drop NSFW-flagged images (defence in depth); keep only usable URLs.
    const images = results
      .filter((d) => !d.NSFWContent)
      .map((d) => d.imageURL ?? (d.imageBase64Data ? `data:image/jpeg;base64,${d.imageBase64Data}` : ''))
      .filter(Boolean);

    if (images.length === 0) {
      failJob(job.id, 'Runware returned no usable images (all empty or NSFW-filtered).');
      return;
    }
    completeJob(job.id, images);
  } catch (err) {
    failJob(job.id, `Runware call failed: ${(err as Error).message}`);
  }
}
