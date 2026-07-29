import { useEffect, useMemo, useState } from 'react';
import { useGame } from '../../lib/useGame';
import { api } from '../../lib/api';
import { Logo, ConnectionDot, ScoreTable } from '../../components/ui';

const TOKEN_KEY = 'aipictionary.token';

export default function PhoneView() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const { state, connected, secondsLeft } = useGame('phone', token ?? undefined);

  if (!token) return <JoinScreen onJoined={(t) => { localStorage.setItem(TOKEN_KEY, t); setToken(t); }} />;

  return (
    <div className="min-h-full flex flex-col">
      <header className="flex items-center justify-between px-5 py-4">
        <Logo className="text-lg" />
        <ConnectionDot connected={connected} />
      </header>
      <main className="flex-1 px-5 pb-8">
        <PhoneBody state={state} secondsLeft={secondsLeft} token={token} />
      </main>
    </div>
  );
}

function JoinScreen({ onJoined }: { onJoined: (token: string) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.join(name.trim());
      onJoined(token);
    } catch (e) {
      setError((e as Error).message === 'game already started' ? 'The game has already started.' : 'Could not join. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full grid place-items-center p-6">
      <div className="w-full max-w-sm animate-fade-up">
        <Logo className="text-3xl" />
        <p className="mt-2 text-muted">Name your team to join the lobby.</p>
        <input
          className="input mt-6 text-lg"
          placeholder="Team name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && join()}
          autoFocus
        />
        {error && <p className="mt-3 text-coral text-sm">{error}</p>}
        <button className="btn-primary mt-5 w-full text-lg" disabled={busy || !name.trim()} onClick={join}>
          {busy ? 'Joining…' : 'Join game'}
        </button>
      </div>
    </div>
  );
}

function PhoneBody({ state, secondsLeft, token }: { state: ReturnType<typeof useGame>['state']; secondsLeft: number | null; token: string }) {
  if (!state) return <Waiting title="Connecting…" />;
  const you = state.you;

  if (state.phase === 'finalScores') {
    return (
      <div className="animate-fade-up">
        <h2 className="font-display text-2xl font-bold mb-4">Final scores</h2>
        <ScoreTable teams={state.teams} highlightId={you?.teamId} />
        {you && <p className="mt-6 text-center text-muted">You played as <b className="text-white">{you.name}</b>.</p>}
      </div>
    );
  }

  if (you?.isPrompter && state.phase !== 'roundReveal') {
    return (
      <Waiting
        title="It's your turn to prompt!"
        body="Head to the host screen — your team composes the prompt there. Phones don't show the picture."
        accent
      />
    );
  }

  if (state.phase === 'lobby') {
    return (
      <div className="animate-fade-up">
        <Waiting title="You're in the lobby" body={`Playing as “${you?.name ?? '…'}”. Waiting for the operator to start.`} />
        <div className="mt-8">
          <div className="label mb-2">Teams joined ({state.teams.length})</div>
          <div className="flex flex-wrap gap-2">
            {state.teams.map((t) => (
              <span key={t.id} className={`chip ${t.id === you?.teamId ? 'bg-violet text-white' : 'bg-surface-2 text-muted'}`}>{t.name}</span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (state.phase === 'guessing') {
    return <GuessScreen token={token} alreadyCorrect={!!you?.alreadyCorrect} secondsLeft={secondsLeft} prompterName={state.prompterTeamName} />;
  }

  if (state.phase === 'roundReveal') {
    return (
      <div className="animate-fade-up">
        <Waiting title="Round over" body="Check the big screen for the reveal." />
        <div className="mt-8">
          <div className="label mb-2">Standings</div>
          <ScoreTable teams={state.teams} highlightId={you?.teamId} />
        </div>
      </div>
    );
  }

  // reveal / generating / picking for non-prompting teams
  return (
    <div className="animate-fade-up">
      <Waiting
        title={`${state.prompterTeamName ?? 'A team'} is prompting`}
        body="Get ready — the picture is coming to the big screen. You'll guess from here."
      />
      <div className="mt-8">
        <div className="label mb-2">Standings</div>
        <ScoreTable teams={state.teams} highlightId={you?.teamId} />
      </div>
    </div>
  );
}

function GuessScreen({ token, alreadyCorrect, secondsLeft, prompterName }: { token: string; alreadyCorrect: boolean; secondsLeft: number | null; prompterName: string | null }) {
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'correct' | 'again' | 'locked'; msg: string } | null>(
    alreadyCorrect ? { kind: 'correct', msg: 'You got it! 🎉' } : null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (alreadyCorrect) setFeedback({ kind: 'correct', msg: 'You got it! 🎉' });
  }, [alreadyCorrect]);

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const res = await api.guess(token, text.trim());
      if (res.correct) setFeedback({ kind: 'correct', msg: 'Correct! 🎉' });
      else if (res.reason === 'already-correct') setFeedback({ kind: 'correct', msg: 'Already solved! 🎉' });
      else setFeedback({ kind: 'again', msg: 'Not quite — try again!' });
      setText('');
    } catch {
      setFeedback({ kind: 'again', msg: 'Could not send. Try again.' });
    } finally {
      setBusy(false);
    }
  }

  const locked = feedback?.kind === 'correct';

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-bold">What is it?</h2>
        {secondsLeft != null && (
          <span className={`font-display text-3xl font-bold tabular-nums ${secondsLeft <= 5 ? 'text-coral' : 'text-gold'}`}>{Math.ceil(secondsLeft)}</span>
        )}
      </div>
      <p className="text-muted mt-1">Look at the projector — {prompterName ?? 'the team'}'s picture.</p>

      {locked ? (
        <div className="mt-8 card p-6 text-center border-mint/40">
          <div className="text-5xl">🎉</div>
          <div className="mt-3 font-display text-xl font-semibold text-mint">{feedback?.msg}</div>
          <div className="text-muted text-sm mt-1">Sit tight for the reveal.</div>
        </div>
      ) : (
        <>
          <input
            className="input mt-6 text-xl"
            placeholder="Type your guess"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            autoFocus
            autoCapitalize="none"
          />
          <button className="btn-primary mt-4 w-full text-lg" disabled={busy || !text.trim()} onClick={submit}>
            Submit guess
          </button>
          {feedback?.kind === 'again' && <p className="mt-3 text-center text-coral">{feedback.msg}</p>}
        </>
      )}
    </div>
  );
}

function Waiting({ title, body, accent }: { title: string; body?: string; accent?: boolean }) {
  return (
    <div className="min-h-[50vh] grid place-items-center text-center animate-fade-up">
      <div>
        <div className="relative mx-auto mb-6 h-16 w-16">
          <span className={`absolute inset-0 rounded-full ${accent ? 'bg-violet' : 'bg-mint'} animate-pulse-ring`} />
          <span className={`absolute inset-3 rounded-full ${accent ? 'bg-violet' : 'bg-mint'}`} />
        </div>
        <h2 className="font-display text-2xl font-bold">{title}</h2>
        {body && <p className="text-muted mt-2 max-w-xs mx-auto">{body}</p>}
      </div>
    </div>
  );
}
