import { useEffect, useState, type ReactNode } from 'react';
import { useGame } from '../../lib/useGame';
import { api } from '../../lib/api';
import { Logo, CountdownRing } from '../../components/ui';

export default function PresentView() {
  const { state, secondsLeft, roundReveal, trivia } = useGame('present');
  const [qrUrl, setQrUrl] = useState<string>('');
  const [joinUrl, setJoinUrl] = useState<string>('');

  useEffect(() => {
    setQrUrl(`${(import.meta.env.VITE_SERVER_URL as string) ?? ''}/api/qr?format=svg`);
    api.joinUrl().then((r) => setJoinUrl(r.url)).catch(() => {});
  }, []);

  if (!state) return <FullCenter><p className="text-muted">Connecting…</p></FullCenter>;

  switch (state.phase) {
    case 'lobby':
      return <Lobby teams={state.teams} qrUrl={qrUrl} joinUrl={joinUrl} />;
    case 'reveal':
      return (
        <FullCenter>
          <div className="text-center animate-fade-up">
            <p className="label text-violet-soft">Now prompting</p>
            <h1 className="text-mega font-display font-bold mt-3">{state.prompterTeamName}</h1>
            <p className="text-muted text-2xl mt-6">Get your guesses ready…</p>
          </div>
        </FullCenter>
      );
    case 'generating':
      return <Generating trivia={trivia} prompter={state.prompterTeamName} />;
    case 'picking':
      return (
        <FullCenter>
          <div className="text-center animate-fade-up">
            <div className="mx-auto mb-8 h-16 w-16 rounded-full border-4 border-line border-t-violet animate-spin" />
            <h1 className="huge font-display text-huge font-bold">{state.prompterTeamName} is choosing…</h1>
          </div>
        </FullCenter>
      );
    case 'guessing':
      return <Guessing image={state.chosenImage ?? null} secondsLeft={secondsLeft} guessTotal={state.timer ? Math.round((state.timer.endsAt - Date.now()) / 1000) : null} />;
    case 'roundReveal':
      return <Reveal reveal={roundReveal} fallbackTarget={state.reveal?.target} fallbackPrompt={state.prompt ?? undefined} teams={state.teams} />;
    case 'finalScores':
      return <FinalScores teams={state.teams} />;
    default:
      return <FullCenter><Logo className="text-4xl" /></FullCenter>;
  }
}

function FullCenter({ children }: { children: ReactNode }) {
  return <div className="min-h-full grid place-items-center p-12">{children}</div>;
}

function Lobby({ teams, qrUrl, joinUrl }: { teams: { id: string; name: string }[]; qrUrl: string; joinUrl: string }) {
  return (
    <div className="min-h-full grid lg:grid-cols-2 gap-10 p-12 items-center">
      <div className="animate-fade-up">
        <Logo className="text-5xl" />
        <h1 className="text-huge font-display font-bold mt-6">Scan to join</h1>
        <p className="text-muted text-2xl mt-4">One phone per team. Name your team and wait for kickoff.</p>
        {joinUrl && <p className="mt-6 text-violet-soft text-3xl font-display break-all">{joinUrl}</p>}
      </div>
      <div className="flex flex-col items-center gap-8">
        <div className="bg-white rounded-3xl p-6 shadow-glow">
          {qrUrl ? <img src={qrUrl} alt="join QR" className="w-72 h-72" /> : <div className="w-72 h-72" />}
        </div>
        <div className="w-full max-w-md">
          <div className="label mb-3">Teams in the lobby ({teams.length})</div>
          <div className="flex flex-wrap gap-3">
            {teams.map((t) => (
              <span key={t.id} className="chip bg-surface-2 text-white text-xl px-5 py-2 animate-fade-up">{t.name}</span>
            ))}
            {teams.length === 0 && <span className="text-muted">Waiting for teams…</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Generating({ trivia, prompter }: { trivia: string | null; prompter: string | null }) {
  return (
    <FullCenter>
      <div className="text-center max-w-4xl animate-fade-up">
        <div className="mx-auto mb-10 h-16 w-16 rounded-full border-4 border-line border-t-mint animate-spin" />
        {trivia ? (
          <>
            <p className="label text-mint mb-4">Did you know?</p>
            <p className="text-huge font-display font-semibold leading-tight">{trivia}</p>
          </>
        ) : (
          <h1 className="text-huge font-display font-bold">{prompter} is generating an image…</h1>
        )}
      </div>
    </FullCenter>
  );
}

function Guessing({ image, secondsLeft, guessTotal }: { image: string | null; secondsLeft: number | null; guessTotal: number | null }) {
  return (
    <div className="min-h-full grid grid-rows-[1fr_auto] p-8 gap-6">
      <div className="grid place-items-center">
        {image ? (
          <img src={image} alt="guess this" className="max-h-[72vh] rounded-3xl shadow-card border border-line" />
        ) : (
          <p className="text-muted text-2xl">Loading image…</p>
        )}
      </div>
      <div className="flex items-center justify-center gap-8">
        <h2 className="text-huge font-display font-bold">Guess on your phones!</h2>
        {secondsLeft != null && (
          <CountdownRing secondsLeft={secondsLeft} total={Math.max(guessTotal ?? secondsLeft, 1)} accent="#ffcf5c" />
        )}
      </div>
    </div>
  );
}

function Reveal({ reveal, fallbackTarget, fallbackPrompt, teams }: {
  reveal: ReturnType<typeof useGame>['roundReveal'];
  fallbackTarget?: string; fallbackPrompt?: string;
  teams: { id: string; name: string; score: number }[];
}) {
  const target = reveal?.target ?? fallbackTarget ?? '—';
  const prompt = reveal?.prompt ?? fallbackPrompt ?? '';
  const solvers = reveal?.results.filter((r) => r.correct) ?? [];
  return (
    <div className="min-h-full grid lg:grid-cols-2 gap-10 p-12 items-center">
      <div className="animate-fade-up">
        <p className="label text-violet-soft">The answer was</p>
        <h1 className="text-mega font-display font-bold mt-2">{target}</h1>
        <div className="card p-6 mt-8">
          <div className="label mb-2">The prompt they actually wrote</div>
          <p className="text-3xl font-display leading-snug">“{prompt}”</p>
        </div>
      </div>
      <div className="animate-fade-up">
        <div className="label mb-4">Who got it</div>
        {solvers.length === 0 ? (
          <p className="text-coral text-3xl font-display">Nobody guessed it! 😮 (prompter scores 0)</p>
        ) : (
          <div className="flex flex-col gap-3">
            {solvers.map((r) => (
              <div key={r.teamId} className="flex items-center justify-between card p-4">
                <span className="font-display text-2xl">{r.teamName} {r.firstCorrect && <span className="text-mint">⚡ first</span>}</span>
                <span className="text-gold font-display text-2xl">+{r.awarded}</span>
              </div>
            ))}
          </div>
        )}
        {reveal && (
          <div className="mt-6 flex items-center justify-between card p-4 border-violet/40">
            <span className="font-display text-2xl">{reveal.prompterTeamName} (prompter)</span>
            <span className="text-gold font-display text-2xl">+{reveal.prompterAwarded}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function FinalScores({ teams }: { teams: { id: string; name: string; score: number }[] }) {
  const sorted = [...teams].sort((a, b) => b.score - a.score);
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <div className="min-h-full grid place-items-center p-12">
      <div className="w-full max-w-3xl animate-fade-up">
        <p className="label text-center text-violet-soft">Final scoreboard</p>
        <h1 className="text-mega font-display font-bold text-center mb-10">Game over</h1>
        <div className="flex flex-col gap-4">
          {sorted.map((t, i) => (
            <div key={t.id} className={`flex items-center gap-6 rounded-2xl px-8 py-5 border ${i === 0 ? 'border-gold bg-gold/10' : 'border-line bg-surface-2'}`}>
              <span className="text-4xl w-12 text-center">{medals[i] ?? i + 1}</span>
              <span className="flex-1 font-display text-4xl font-bold truncate">{t.name}</span>
              <span className="font-display text-5xl font-bold text-gold tabular-nums">{t.score}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
