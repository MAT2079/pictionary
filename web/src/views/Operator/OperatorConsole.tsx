import { useState } from 'react';
import { useGame } from '../../lib/useGame';
import { api } from '../../lib/api';
import { Logo, ConnectionDot, ScoreTable } from '../../components/ui';
import SettingsPanel from './SettingsPanel';
import type { ClientState } from '../../lib/types';

export default function OperatorConsole() {
  const { state, connected, secondsLeft, images } = useGame('operator');
  const [tab, setTab] = useState<'control' | 'settings'>('control');

  async function act(action: string, body?: unknown) {
    try { await api.op(action, body); } catch (e) { alert((e as Error).message); }
  }

  return (
    <div className="min-h-full flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface/60 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <Logo className="text-lg" />
          <span className="chip bg-surface-2 text-violet-soft uppercase tracking-wider text-xs">{state?.phase ?? '…'}</span>
        </div>
        <div className="flex items-center gap-5">
          <WorkerStatus state={state} />
          <ConnectionDot connected={connected} />
          <div className="flex rounded-xl bg-surface-2 p-1">
            {(['control', 'settings'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded-lg text-sm font-display font-semibold capitalize ${tab === t ? 'bg-violet text-white' : 'text-muted'}`}>{t}</button>
            ))}
          </div>
        </div>
      </header>

      {state?.jobError && (
        <div className="bg-coral/20 border-b border-coral/40 px-6 py-2 text-coral text-sm">
          Generation error: {state.jobError} — try Regenerate.
        </div>
      )}

      <main className="flex-1 p-6 max-w-6xl w-full mx-auto">
        {!state ? <p className="text-muted">Connecting…</p> : tab === 'control' ? (
          <Control state={state} act={act} secondsLeft={secondsLeft} images={images ?? state.images ?? []} />
        ) : (
          <SettingsPanel state={state} />
        )}
      </main>
    </div>
  );
}

function WorkerStatus({ state }: { state: ClientState | null }) {
  const w = state?.worker;
  const online = w?.online;
  const ago = w?.lastPollAt ? Math.round((Date.now() - w.lastPollAt) / 1000) : null;
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted">
      <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-mint' : 'bg-coral'}`} />
      worker {online ? `online${ago != null ? ` (${ago}s)` : ''}` : 'offline'}
      {state?.settings && <span className="chip bg-surface-2 ml-2">{state.settings.backendMode}</span>}
    </span>
  );
}

function Control({ state, act, secondsLeft, images }: {
  state: ClientState; act: (a: string, b?: unknown) => void; secondsLeft: number | null; images: string[];
}) {
  const phase = state.phase;
  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6">
      <div className="flex flex-col gap-6">
        {/* Phase actions */}
        <div className="card p-5">
          <div className="label mb-3">Phase controls</div>
          <div className="flex flex-wrap gap-2">
            {phase === 'lobby' && <button className="btn-primary" onClick={() => act('start-game')}>Start game</button>}
            {phase === 'reveal' && <button className="btn-primary" onClick={() => act('start-compose')}>Start compose timer</button>}
            {phase === 'compose' && <>
              <button className="btn-ghost" onClick={() => act('extend')}>Extend timer</button>
              <button className="btn-danger" onClick={() => act('skip')}>Skip turn</button>
            </>}
            {phase === 'generating' && <button className="btn-ghost" onClick={() => act('regenerate')}>Regenerate</button>}
            {phase === 'picking' && <button className="btn-ghost" onClick={() => act('regenerate')}>Regenerate (new seeds)</button>}
            {phase === 'guessing' && <button className="btn-primary" onClick={() => act('finish-guessing')}>End guessing now</button>}
            {phase === 'roundReveal' && <button className="btn-primary" onClick={() => act('next-turn')}>Next turn →</button>}
            {phase === 'finalScores' && <button className="btn-ghost" onClick={() => act('reset-game')}>Reset game</button>}
            {phase !== 'finalScores' && phase !== 'lobby' && (
              <button className="btn-danger ml-auto" onClick={() => confirm('Reset the whole game?') && act('reset-game')}>Reset game</button>
            )}
          </div>
          {secondsLeft != null && (
            <p className="mt-3 text-gold font-display text-xl">{Math.ceil(secondsLeft)}s — {state.timer?.kind}</p>
          )}
        </div>

        {/* Lobby: order + teams */}
        {phase === 'lobby' && <LobbyControl state={state} act={act} />}

        {/* Current turn secret */}
        {state.reveal?.target && (
          <div className="card p-5">
            <div className="label mb-2">Current turn — {state.prompterTeamName} prompting</div>
            <div className="text-2xl font-display font-bold">{state.reveal.target}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {state.reveal.forbidden?.map((f) => <span key={f} className="chip bg-surface-2 text-coral/80 text-xs">{f}</span>)}
            </div>
            {state.prompt && <p className="mt-3 text-muted">Prompt: “{state.prompt}”</p>}
          </div>
        )}

        {/* Pick grid with veto */}
        {phase === 'picking' && (
          <div className="card p-5">
            <div className="label mb-3">Images — reject any (safety veto)</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {images.map((src, i) => (
                <div key={i} className="relative rounded-xl overflow-hidden border border-line">
                  <img src={src} className="w-full aspect-square object-cover" />
                  <button className="absolute top-1 right-1 btn-danger !px-2 !py-1 !min-h-0 text-xs" onClick={() => act('reject-image', { index: i })}>✕</button>
                  <button className="absolute bottom-1 left-1 btn-ghost !px-2 !py-1 !min-h-0 text-xs" onClick={() => act('pick-image', { index: i })}>pick</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Guessing: live moderation */}
        {(phase === 'guessing' || phase === 'roundReveal') && (
          <GuessModeration state={state} act={act} />
        )}
      </div>

      {/* Sidebar scoreboard */}
      <div className="flex flex-col gap-4">
        <div className="card p-5">
          <div className="label mb-3">Scores</div>
          <ScoreTable teams={state.teams} highlightId={state.prompterTeamId ?? undefined} />
        </div>
        {phase === 'roundReveal' && (
          <div className="card p-5">
            <div className="label mb-3">Override scores</div>
            {state.teams.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate">{t.name}</span>
                <div className="flex gap-1">
                  <button className="btn-ghost !px-2 !py-1 !min-h-0" onClick={() => act('override-score', { teamId: t.id, delta: -50 })}>-50</button>
                  <button className="btn-ghost !px-2 !py-1 !min-h-0" onClick={() => act('override-score', { teamId: t.id, delta: 50 })}>+50</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LobbyControl({ state, act }: { state: ClientState; act: (a: string, b?: unknown) => void }) {
  const [order, setOrder] = useState<string[]>(state.turnOrder.length ? state.turnOrder : state.teams.map((t) => t.id));
  const ids = order.length === state.teams.length ? order : state.teams.map((t) => t.id);
  function move(i: number, dir: -1 | 1) {
    const next = [...ids];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    act('set-order', { order: next });
  }
  const nameOf = (id: string) => state.teams.find((t) => t.id === id)?.name ?? '?';
  return (
    <div className="card p-5">
      <div className="label mb-3">Turn order ({state.teams.length} teams)</div>
      {state.teams.length < 2 && <p className="text-coral text-sm mb-2">Need at least 2 teams to start.</p>}
      <div className="flex flex-col gap-2">
        {ids.map((id, i) => (
          <div key={id} className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-2">
            <span className="text-muted font-display w-6">{i + 1}</span>
            <span className="flex-1">{nameOf(id)}</span>
            <button className="btn-ghost !px-2 !py-1 !min-h-0" onClick={() => move(i, -1)}>↑</button>
            <button className="btn-ghost !px-2 !py-1 !min-h-0" onClick={() => move(i, 1)}>↓</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function GuessModeration({ state, act }: { state: ClientState; act: (a: string, b?: unknown) => void }) {
  const guesses = state.guesses ?? [];
  const byTeam = new Map<string, typeof guesses>();
  for (const g of guesses) {
    if (!byTeam.has(g.teamId)) byTeam.set(g.teamId, []);
    byTeam.get(g.teamId)!.push(g);
  }
  const nameOf = (id: string) => state.teams.find((t) => t.id === id)?.name ?? '?';
  const guessers = state.teams.filter((t) => t.id !== state.prompterTeamId);
  return (
    <div className="card p-5">
      <div className="label mb-3">Guesses — accept / reject overrides the matcher</div>
      <div className="flex flex-col gap-2">
        {guessers.map((t) => {
          const gs = byTeam.get(t.id) ?? [];
          const correct = gs.some((g) => g.correct);
          return (
            <div key={t.id} className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-2">
              <span className="font-display w-32 truncate">{t.name}</span>
              <span className="flex-1 text-muted text-sm truncate">
                {gs.length ? gs.map((g) => g.text).join(', ') : <span className="opacity-50">no guesses</span>}
              </span>
              <span className={`chip ${correct ? 'bg-mint/20 text-mint' : 'bg-surface text-muted'}`}>{correct ? 'correct' : '—'}</span>
              <button className="btn-ghost !px-2 !py-1 !min-h-0 text-xs" onClick={() => act('accept-guess', { teamId: t.id, correct: true })}>✓</button>
              <button className="btn-ghost !px-2 !py-1 !min-h-0 text-xs" onClick={() => act('accept-guess', { teamId: t.id, correct: false })}>✕</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
