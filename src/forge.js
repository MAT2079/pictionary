'use strict';

/*
 * Forge / A1111-compatible image client (spec §7).
 *
 * Calls ${FORGE_URL}/sdapi/v1/txt2img. Forge must be launched with --api and is
 * reached over the public cloudflared tunnel URL (a Settings value). Response
 * PNGs are compressed to JPEG before storing/broadcasting to keep Render
 * bandwidth trivial.
 */

const Jimp = require('jimp');

function trimUrl(u) {
  return String(u || '').trim().replace(/\/+$/, '');
}

function authHeaders(settings) {
  const h = { 'Content-Type': 'application/json' };
  const auth = (settings.FORGE_AUTH_HEADER || '').trim();
  if (auth) h['Authorization'] = auth;
  return h;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } finally {
    clearTimeout(t);
  }
}

/** Compress a base64 PNG (no data: prefix) to a JPEG data URL. */
async function pngBase64ToJpegDataUrl(b64, quality) {
  const buf = Buffer.from(b64, 'base64');
  const img = await Jimp.read(buf);
  img.quality(quality || 72);
  const out = await img.getBufferAsync(Jimp.MIME_JPEG);
  return `data:image/jpeg;base64,${out.toString('base64')}`;
}

/**
 * Generate N_CANDIDATES images for a validated prompt.
 * Returns { ok: true, images: [dataUrl…], ms } or { ok: false, error, ms }.
 */
async function txt2img(prompt, settings) {
  const base = trimUrl(settings.FORGE_URL);
  if (!base) return { ok: false, error: 'FORGE_URL is not set in Settings.' };

  const n = Math.max(1, parseInt(settings.N_CANDIDATES, 10) || 4);
  const sequential = settings.SEQUENTIAL_GEN !== false;

  const body = {
    prompt,
    negative_prompt: settings.NEGATIVE_PROMPT || '',
    steps: parseInt(settings.STEPS, 10) || 6,
    cfg_scale: Number(settings.CFG_SCALE) || 1.5,
    width: parseInt(settings.WIDTH, 10) || 832,
    height: parseInt(settings.HEIGHT, 10) || 832,
    batch_size: sequential ? 1 : n,
    n_iter: sequential ? n : 1,
    sampler_name: settings.SAMPLER || 'DPM++ SDE',
    seed: -1,
    override_settings: settings.MODEL_CHECKPOINT
      ? { sd_model_checkpoint: settings.MODEL_CHECKPOINT }
      : {},
    override_settings_restore_afterwards: true,
    save_images: false
  };

  // The safety checker is a Forge/webui launch + runtime setting; we surface the
  // intent here and keep an SFW checkpoint + profanity filter as the real guard.
  if (settings.SAFETY_CHECKER === false) {
    body.override_settings.enable_pnginfo = body.override_settings.enable_pnginfo;
  }

  const timeoutMs = (parseInt(settings.GEN_TIMEOUT_SECONDS, 10) || 90) * 1000;
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(
      `${base}/sdapi/v1/txt2img`,
      { method: 'POST', headers: authHeaders(settings), body: JSON.stringify(body) },
      timeoutMs
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Forge returned HTTP ${res.status}. ${text.slice(0, 200)}`, ms: Date.now() - started };
    }
    const data = await res.json();
    const pngs = Array.isArray(data.images) ? data.images : [];
    if (pngs.length === 0) {
      return { ok: false, error: 'Forge returned no images.', ms: Date.now() - started };
    }
    const images = [];
    for (const b64 of pngs.slice(0, n)) {
      images.push(await pngBase64ToJpegDataUrl(b64, 72));
    }
    return { ok: true, images, ms: Date.now() - started };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? `Generation timed out after ${settings.GEN_TIMEOUT_SECONDS || 90}s.`
        : `Could not reach Forge: ${err.message}`,
      ms: Date.now() - started
    };
  }
}

/** GET /sdapi/v1/sd-models — for the Settings model dropdown. */
async function listModels(settings) {
  const base = trimUrl(settings.FORGE_URL);
  if (!base) return { ok: false, error: 'FORGE_URL is not set.' };
  try {
    const res = await fetchWithTimeout(
      `${base}/sdapi/v1/sd-models`,
      { method: 'GET', headers: authHeaders(settings) },
      15000
    );
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const models = (Array.isArray(data) ? data : []).map((m) => m.title || m.model_name).filter(Boolean);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Test Connection / Generate Test Image (spec §7, §8.2). Generates a single
 * quick image and reports success, latency and any error.
 */
async function testConnection(settings) {
  const single = Object.assign({}, settings, { N_CANDIDATES: 1 });
  const result = await txt2img('a friendly robot waving, simple, clear', single);
  if (result.ok) {
    return { ok: true, ms: result.ms, image: result.images[0] };
  }
  return { ok: false, ms: result.ms || 0, error: result.error };
}

module.exports = { txt2img, listModels, testConnection };
