import type { ReactNode } from 'react';
import type { PublicTeam } from '../lib/types';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`font-display font-bold tracking-tight ${className}`}>
      <span className="text-white">AI</span>
      <span className="text-violet-soft"> Pictionary</span>
    </span>
  );
}

export function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted">
      <span className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-mint' : 'bg-coral'}`} />
      {connected ? 'live' : 'reconnecting…'}
    </span>
  );
}

/** Big circular countdown for projector + prompter. */
export function CountdownRing({
  secondsLeft,
  total,
  accent = '#7c5cff',
}: {
  secondsLeft: number;
  total: number;
  accent?: string;
}) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.max(0, Math.min(1, secondsLeft / total)) : 0;
  const danger = secondsLeft <= 5;
  return (
    <div className="relative inline-grid place-items-center">
      <svg width="140" height="140" viewBox="0 0 140 140" className="-rotate-90">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#2a2a3c" strokeWidth="10" />
        <circle
          cx="70" cy="70" r={r} fill="none"
          stroke={danger ? '#ff5d73' : accent}
          strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 0.2s linear' }}
        />
      </svg>
      <span className={`absolute font-display text-4xl font-bold ${danger ? 'text-coral' : 'text-white'}`}>
        {Math.ceil(secondsLeft)}
      </span>
    </div>
  );
}

export function ScoreTable({ teams, highlightId }: { teams: PublicTeam[]; highlightId?: string }) {
  const sorted = [...teams].sort((a, b) => b.score - a.score);
  return (
    <div className="flex flex-col gap-2">
      {sorted.map((t, i) => (
        <div
          key={t.id}
          className={`flex items-center gap-4 rounded-xl px-4 py-3 border ${
            t.id === highlightId ? 'border-violet bg-violet/10' : 'border-line bg-surface-2'
          }`}
        >
          <span className="w-8 text-center font-display text-lg text-muted">{i + 1}</span>
          <span className="flex-1 font-display text-lg font-semibold truncate">{t.name}</span>
          {!t.connected && <span className="chip bg-coral/20 text-coral">offline</span>}
          <span className="font-display text-2xl font-bold text-gold tabular-nums">{t.score}</span>
        </div>
      ))}
    </div>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card p-5 ${className}`}>{children}</div>;
}

export function Center({ children }: { children: ReactNode }) {
  return <div className="min-h-full grid place-items-center p-6">{children}</div>;
}
