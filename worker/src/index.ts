import sharp from 'sharp';
import { classify, tryAutoLoad } from './nsfw.js';

// Outbound-only poll-worker (spec §3): pulls jobs from the cloud server, calls
// the local Forge backend, NSFW-screens + JPEG-compresses, uploads results.
// Nothing here listens on a public interface.

const RENDER_URL = (process.env.RENDER_URL ?? '').replace(/\/+$/, '');
const WORKER_SECRET = process.env.WORKER_SECRET ?? '';
const FORGE_URL = (process.env.FORGE_URL ?? 'http://forge:7860').replace(/\/+$/, '');
const NSFW_REGEN_ATTEMPTS = Number(process.env.NSFW_REGEN_ATTEMPTS ?? 2);
const JPEG_QUALITY = Number(process.env.JPEG_QUALITY ?? 82);

if (!RENDER_URL) {
  console.error('[worker] RENDER_URL is required (the cloud server base URL).');
  process.exit(1);
}
if (!WORKER_SECRET) {
  console.error('[worker] WORKER_SECRET is required (Bearer token for /worker/*).');
  process.exit(1);
}

const authHeaders = { authorization: `Bearer ${WORKER_SECRET}` };

interface GenParams {
  checkpoint: string; sampler: string; steps: number; cfgScale: number;
  width: number; height: number; batchSize: number; seedMode: 'random' | 'fixed';
  negativePrompt: string;
}
interface Job { id: string; prompt: string; genParams: GenParams; }

interface Txt2ImgResponse { images?: string[]; }

async function callForge(prompt: string, p: GenParams, seed: number): Promise<string[]> {
  const body = {
    prompt,
    negative_prompt: p.negativePrompt,
    steps: p.steps,
    cfg_scale: p.cfgScale,
    sampler_name: p.sampler,
    width: p.width,
    height: p.height,
    batch_size: p.batchSize,
    n_iter: 1,
    seed,
    override_settings: { sd_model_checkpoint: p.checkpoint },
  };
  const res = await fetch(`${FORGE_URL}/sdapi/v1/txt2img`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`Forge ${res.status} ${res.statusText}`);
  const data = (await res.json()) as Txt2ImgResponse;
  const images = data.images ?? [];
  if (images.length === 0) throw new Error('Forge returned no images');
  return images;
}

/** Decode base64 PNG -> NSFW screen (regenerate up to N, then drop) -> JPEG. */
async function processImages(job: Job): Promise<string[]> {
  const p = job.genParams;
  const randomSeed = () => (p.seedMode === 'fixed' ? 1234 : Math.floor(Math.random() * 2 ** 31));

  let pngs = await callForge(job.prompt, p, randomSeed());
  const out: string[] = [];

  for (let i = 0; i < pngs.length; i++) {
    let jpeg = await toJpeg(pngs[i]);
    let attempts = 0;
    let result = await classify(jpeg);

    // Regenerate flagged images with fresh seeds up to N times, then drop.
    while (result.flagged && attempts < NSFW_REGEN_ATTEMPTS) {
      attempts++;
      const regen = await callForge(job.prompt, p, randomSeed());
      jpeg = await toJpeg(regen[0]);
      result = await classify(jpeg);
    }
    if (result.flagged) {
      console.warn(`[worker] dropped a flagged image for job ${job.id} after ${attempts} regen attempts`);
      continue;
    }
    out.push(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
  }
  return out;
}

async function toJpeg(b64png: string): Promise<Buffer> {
  const raw = Buffer.from(b64png.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  return sharp(raw).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
}

async function postResult(jobId: string, images: string[]): Promise<void> {
  await fetch(`${RENDER_URL}/worker/jobs/${jobId}/result`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ images }),
  });
}

async function postFail(jobId: string, error: string): Promise<void> {
  await fetch(`${RENDER_URL}/worker/jobs/${jobId}/fail`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ error }),
  });
}

async function pollOnce(): Promise<void> {
  const res = await fetch(`${RENDER_URL}/worker/next-job`, { headers: authHeaders });
  if (res.status === 204) return; // long-poll timed out, no job
  if (!res.ok) throw new Error(`next-job ${res.status} ${res.statusText}`);
  const { job } = (await res.json()) as { job: Job };
  if (!job) return;

  console.log(`[worker] job ${job.id}: "${job.prompt.slice(0, 60)}"`);
  try {
    const images = await processImages(job);
    if (images.length === 0) {
      await postFail(job.id, 'All images were dropped by the NSFW filter.');
    } else {
      await postResult(job.id, images);
      console.log(`[worker] job ${job.id} done (${images.length} images)`);
    }
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[worker] job ${job.id} failed: ${msg}`);
    await postFail(job.id, msg).catch(() => {});
  }
}

async function main(): Promise<void> {
  console.log(`[worker] polling ${RENDER_URL} → Forge at ${FORGE_URL}`);
  await tryAutoLoad();
  // Continuous outbound long-poll loop with backoff on transport errors.
  let backoff = 1000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await pollOnce();
      backoff = 1000;
    } catch (err) {
      console.error(`[worker] poll error: ${(err as Error).message} (retry in ${backoff}ms)`);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 15_000);
    }
  }
}

void main();
