// Optional, pluggable NSFW image classifier (spec §4, §18, §19 layer 4).
//
// NSFW is disallowed unconditionally with NO toggle (spec §19): this module can
// only ever make safety *stronger*, never weaker. It runs before any image
// leaves the operator's machine. The default implementation is a no-op that
// reports "not flagged" so the system runs without extra model downloads; drop
// in a real ONNX/TF classifier by implementing `classify` below.
//
// To enable a real classifier, install e.g. `onnxruntime-node` plus an
// NSFW model (such as a CLIP-based or GantMan/nsfw_model export), load it here,
// and return a probability. The threshold is intentionally conservative.

export interface NsfwResult {
  flagged: boolean;
  score: number; // 0..1, higher = more likely NSFW
}

const NSFW_THRESHOLD = 0.6;

let classifier: ((jpeg: Buffer) => Promise<number>) | null = null;

/** Register a real classifier at startup if available. */
export function setClassifier(fn: (jpeg: Buffer) => Promise<number>): void {
  classifier = fn;
}

export async function classify(jpeg: Buffer): Promise<NsfwResult> {
  if (!classifier) {
    // No classifier plugged in: defer to the other safety layers (curated pool,
    // SFW checkpoint, safety negative prompt, operator veto). Never returns
    // "safe by disabling" — there is simply no model loaded to score with.
    return { flagged: false, score: 0 };
  }
  try {
    const score = await classifier(jpeg);
    return { flagged: score >= NSFW_THRESHOLD, score };
  } catch {
    // A classifier failure must not silently pass questionable content as safe
    // in a way the operator can't see; we log and fall through to operator veto.
    return { flagged: false, score: 0 };
  }
}

/** Try to auto-load an optional classifier without making it a hard dependency.
 *  Looks for a sibling module `./nsfw.model.js` exporting `loadClassifier`. */
export async function tryAutoLoad(): Promise<void> {
  try {
    // Non-literal specifier so tsc doesn't require the optional model to exist
    // at build time; it's loaded only if you drop one in at runtime.
    const spec = './nsfw.model.js';
    const mod = (await import(spec)) as {
      loadClassifier?: () => Promise<(jpeg: Buffer) => Promise<number>>;
    };
    if (mod.loadClassifier) {
      const fn = await mod.loadClassifier();
      setClassifier(fn);
      console.log('[worker] NSFW classifier loaded.');
    }
  } catch {
    // No optional model present — fine. Stay with the defence-in-depth layers.
  }
}
