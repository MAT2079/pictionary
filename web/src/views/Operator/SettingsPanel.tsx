import { useEffect, useState, type ReactNode } from 'react';
import { api, type PoolEntry } from '../../lib/api';
import type { ClientState, Settings } from '../../lib/types';

export default function SettingsPanel({ state }: { state: ClientState }) {
  const [settings, setSettings] = useState<Settings | null>(state.settings ?? null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings && state.settings) setSettings(state.settings);
  }, [state.settings, settings]);

  if (!settings) return <p className="text-muted">Loading settings…</p>;

  function patch(p: Partial<Settings>) {
    setSettings((s) => (s ? { ...s, ...p } : s));
  }
  function patchGen(p: Partial<Settings['gen']>) {
    setSettings((s) => (s ? { ...s, gen: { ...s.gen, ...p } } : s));
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      await api.putSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {/* Backend */}
      <Group title="Backend">
        <Row label="Backend mode">
          <select className="input" value={settings.backendMode} onChange={(e) => patch({ backendMode: e.target.value as Settings['backendMode'] })}>
            <option value="worker">worker (poll)</option>
            <option value="tunnel">tunnel (direct)</option>
          </select>
        </Row>
        {settings.backendMode === 'tunnel' && (
          <Row label="Tunnel URL">
            <input className="input" value={settings.tunnelUrl} placeholder="https://xyz.trycloudflare.com" onChange={(e) => patch({ tunnelUrl: e.target.value })} />
          </Row>
        )}
        <Row label="Worker status">
          <span className="text-sm">{state.worker?.online ? '🟢 online' : '🔴 offline'} {state.worker?.lastPollAt ? `· last poll ${new Date(state.worker.lastPollAt).toLocaleTimeString()}` : ''}</span>
        </Row>
        <Row label="WORKER_SECRET (read-only)">
          <div className="flex gap-2">
            <input className="input font-mono text-xs" readOnly value={state.workerSecret ?? ''} />
            <button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(state.workerSecret ?? '')}>Copy</button>
          </div>
        </Row>
      </Group>

      {/* Image generation */}
      <Group title="Image generation">
        <Row label="Checkpoint"><input className="input" value={settings.gen.checkpoint} onChange={(e) => patchGen({ checkpoint: e.target.value })} /></Row>
        <Row label="Sampler"><input className="input" value={settings.gen.sampler} onChange={(e) => patchGen({ sampler: e.target.value })} /></Row>
        <div className="grid grid-cols-2 gap-3">
          <NumRow label="Steps" value={settings.gen.steps} onChange={(v) => patchGen({ steps: v })} />
          <NumRow label="CFG scale" value={settings.gen.cfgScale} step={0.1} onChange={(v) => patchGen({ cfgScale: v })} />
          <NumRow label="Width" value={settings.gen.width} step={64} onChange={(v) => patchGen({ width: v })} />
          <NumRow label="Height" value={settings.gen.height} step={64} onChange={(v) => patchGen({ height: v })} />
          <NumRow label="Batch size" value={settings.gen.batchSize} onChange={(v) => patchGen({ batchSize: v })} />
          <Row label="Seed mode">
            <select className="input" value={settings.gen.seedMode} onChange={(e) => patchGen({ seedMode: e.target.value as 'random' | 'fixed' })}>
              <option value="random">random</option>
              <option value="fixed">fixed</option>
            </select>
          </Row>
        </div>
        <p className="text-xs text-muted mt-2">The safety negative prompt is server-controlled and not editable here.</p>
      </Group>

      {/* Timing */}
      <Group title="Timing">
        <div className="grid grid-cols-2 gap-3">
          <NumRow label="Compose (s)" value={settings.composeSeconds} onChange={(v) => patch({ composeSeconds: v })} />
          <NumRow label="Extend (s)" value={settings.extendSeconds} onChange={(v) => patch({ extendSeconds: v })} />
          <NumRow label="Trivia delay (s)" value={settings.triviaDelaySeconds} onChange={(v) => patch({ triviaDelaySeconds: v })} />
          <NumRow label="Pick timeout (s)" value={settings.pickTimeoutSeconds} onChange={(v) => patch({ pickTimeoutSeconds: v })} />
          <NumRow label="Guess (s)" value={settings.guessSeconds} onChange={(v) => patch({ guessSeconds: v })} />
        </div>
      </Group>

      {/* Scoring */}
      <Group title="Scoring">
        <div className="grid grid-cols-3 gap-3">
          <NumRow label="Correct" value={settings.correctPoints} onChange={(v) => patch({ correctPoints: v })} />
          <NumRow label="First bonus" value={settings.firstBonus} onChange={(v) => patch({ firstBonus: v })} />
          <NumRow label="Per solve" value={settings.prompterPerSolve} onChange={(v) => patch({ prompterPerSolve: v })} />
        </div>
      </Group>

      {/* Validation */}
      <Group title="Validation">
        <NumRow label="Max prompt length" value={settings.maxPromptLength} onChange={(v) => patch({ maxPromptLength: v })} />
        <label className="flex items-center gap-3 mt-3">
          <input type="checkbox" checked={settings.fuzzyGuessing} onChange={(e) => patch({ fuzzyGuessing: e.target.checked })} />
          <span>Fuzzy guessing (Levenshtein ≤ 1)</span>
        </label>
        <label className="flex items-center gap-3 mt-2">
          <input type="checkbox" checked={settings.multipleGuessesAllowed} onChange={(e) => patch({ multipleGuessesAllowed: e.target.checked })} />
          <span>Allow multiple guesses per team</span>
        </label>
        <Row label="Profanity list (comma-separated)">
          <textarea className="input min-h-[80px]" value={settings.profanity.join(', ')} onChange={(e) => patch({ profanity: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
        </Row>
      </Group>

      <div className="lg:col-span-2 flex items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
        {saved && <span className="text-mint">Saved ✓</span>}
        <span className="text-xs text-muted ml-auto">In-memory: reverts to env/defaults after a Render redeploy or spin-down. Use a snapshot to persist.</span>
      </div>

      <div className="lg:col-span-2"><PoolEditor /></div>
      <div className="lg:col-span-2"><TriviaEditor /></div>
      <div className="lg:col-span-2"><GameTools /></div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card p-5">
      <div className="label mb-4">{title}</div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm text-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
function NumRow({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <Row label={label}>
      <input type="number" step={step} className="input" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Row>
  );
}

function PoolEditor() {
  const [entries, setEntries] = useState<PoolEntry[]>([]);
  const [unused, setUnused] = useState(0);
  const [form, setForm] = useState({ target: '', forbidden: '', acceptedGuesses: '', category: '' });

  async function load() {
    const r = await api.getPool();
    setEntries(r.entries);
    setUnused(r.unused);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!form.target.trim()) return;
    await api.addPool({
      target: form.target.trim(),
      forbidden: form.forbidden.split(',').map((s) => s.trim()).filter(Boolean),
      acceptedGuesses: form.acceptedGuesses.split(',').map((s) => s.trim()).filter(Boolean),
      category: form.category.trim() || undefined,
    });
    setForm({ target: '', forbidden: '', acceptedGuesses: '', category: '' });
    load();
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="label">Prompt pool — {unused} unused</div>
        <button className="btn-ghost" onClick={async () => { await api.resetUsed(); load(); }}>Reset all used</button>
      </div>
      <div className="grid sm:grid-cols-4 gap-2 mb-4">
        <input className="input" placeholder="target" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
        <input className="input" placeholder="forbidden, comma sep" value={form.forbidden} onChange={(e) => setForm({ ...form, forbidden: e.target.value })} />
        <input className="input" placeholder="accepted, comma sep" value={form.acceptedGuesses} onChange={(e) => setForm({ ...form, acceptedGuesses: e.target.value })} />
        <div className="flex gap-2">
          <input className="input" placeholder="category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <button className="btn-primary" onClick={add}>Add</button>
        </div>
      </div>
      <div className="max-h-72 overflow-auto flex flex-col gap-1">
        {entries.map((e) => (
          <div key={e.id} className="flex items-center gap-3 text-sm rounded-lg bg-surface-2 px-3 py-2">
            <span className={`h-2 w-2 rounded-full ${e.used ? 'bg-coral' : 'bg-mint'}`} title={e.used ? 'used' : 'unused'} />
            <span className="font-display font-semibold w-32 truncate">{e.target}</span>
            <span className="flex-1 text-muted truncate">forbid: {e.forbidden.join(', ')}</span>
            <button className="btn-ghost !px-2 !py-1 !min-h-0 text-xs" onClick={async () => { await api.removePool(e.id); load(); }}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TriviaEditor() {
  const [cards, setCards] = useState<{ id: string; text: string }[]>([]);
  const [text, setText] = useState('');
  async function load() { setCards((await api.getTrivia()).cards); }
  useEffect(() => { load(); }, []);
  return (
    <div className="card p-5">
      <div className="label mb-4">Trivia cards</div>
      <div className="flex gap-2 mb-4">
        <input className="input" placeholder="New trivia card…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn-primary" onClick={async () => { if (text.trim()) { await api.addTrivia(text.trim()); setText(''); load(); } }}>Add</button>
      </div>
      <div className="max-h-60 overflow-auto flex flex-col gap-1">
        {cards.map((c) => (
          <div key={c.id} className="flex items-center gap-3 text-sm rounded-lg bg-surface-2 px-3 py-2">
            <span className="flex-1 text-muted">{c.text}</span>
            <button className="btn-ghost !px-2 !py-1 !min-h-0 text-xs" onClick={async () => { await api.removeTrivia(c.id); load(); }}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function GameTools() {
  const [busy, setBusy] = useState(false);
  async function exportSnap() {
    const snap = await api.getSnapshot();
    download('ai-pictionary.snapshot.json', JSON.stringify(snap, null, 2));
  }
  async function exportScores() {
    const scores = await api.finalScores();
    download('ai-pictionary.scores.json', JSON.stringify(scores, null, 2));
  }
  async function importSnap(file: File) {
    setBusy(true);
    try {
      const snap = JSON.parse(await file.text());
      await api.importSnapshot(snap);
      alert('Snapshot imported.');
    } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="card p-5">
      <div className="label mb-4">Game — snapshot & scores</div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={exportSnap}>Export snapshot</button>
        <label className="btn-ghost cursor-pointer">
          Import snapshot
          <input type="file" accept="application/json" className="hidden" disabled={busy}
            onChange={(e) => e.target.files?.[0] && importSnap(e.target.files[0])} />
        </label>
        <button className="btn-ghost" onClick={exportScores}>Export final scores</button>
      </div>
    </div>
  );
}

function download(name: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
