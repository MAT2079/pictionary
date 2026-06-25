import type { Job } from './types.js';
import { completeJob, failJob } from './jobs.js';
import { state } from './state.js';

// Tunnel mode (spec §3, §15): the server calls a player-pasted Forge URL
// directly instead of waiting for the outbound poll-worker. There is no
// server-side NSFW classifier in this path, so the curated pool + safety
// negative prompt + operator veto remain the active safety layers (§19).

interface ForgeTxt2ImgResponse {
  images?: string[]; // base64 PNGs (no data: prefix)
}

export async function runDirect(job: Job): Promise<void> {
  const base = state.settings.tunnelUrl.replace(/\/+$/, '');
  if (!base) {
    failJob(job.id, 'Tunnel mode is on but no tunnel URL is set in Settings.');
    return;
  }

  const p = job.genParams;
  const body = {
    prompt: job.prompt,
    negative_prompt: p.negativePrompt,
    steps: p.steps,
    cfg_scale: p.cfgScale,
    sampler_name: p.sampler,
    width: p.width,
    height: p.height,
    batch_size: p.batchSize,
    n_iter: 1,
    seed: p.seedMode === 'fixed' ? 1234 : -1,
    override_settings: { sd_model_checkpoint: p.checkpoint },
  };

  try {
    const res = await fetch(`${base}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // Generation can take a while on a cold model load.
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      failJob(job.id, `Forge returned ${res.status} ${res.statusText}`);
      return;
    }
    const data = (await res.json()) as ForgeTxt2ImgResponse;
    const raw = data.images ?? [];
    if (raw.length === 0) {
      failJob(job.id, 'Forge returned no images.');
      return;
    }
    // Tunnel mode skips the worker's JPEG re-encode/NSFW classifier; forward the
    // PNGs as data URLs so the prompter pick grid and presentation can render.
    const images = raw.map((b64) => `data:image/png;base64,${b64}`);
    completeJob(job.id, images);
  } catch (err) {
    failJob(job.id, `Tunnel call failed: ${(err as Error).message}`);
  }
}
