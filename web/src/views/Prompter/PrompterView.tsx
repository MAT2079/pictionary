import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame } from '../../lib/useGame';
import { api } from '../../lib/api';
import { segmentForbidden } from '../../lib/match';
import { Logo, ConnectionDot, CountdownRing, ScoreTable } from '../../components/ui';

export default function PrompterView() {
  const { socket, state, connected, secondsLeft, roundReveal, images } = useGame('prompter');

  return (
    <div className="min-h-full flex flex-col">
      <header className="flex items-center justify-between px-8 py-5 border-b border-line">
        <Logo className="text-xl" />
        <div className="flex items-center gap-4">
          <span className="label">Prompter Station</span>
          <ConnectionDot connected={connected} />
        </div>
      </header>
      <main className="flex-1 p-8 max-w-5xl w-full mx-auto">
        {!state ? (
          <p className="text-muted">Connecting…</p>
        ) : (
          <Body state={state} socket={socket} secondsLeft={secondsLeft} roundReveal={roundReveal} images={images} />
        )}
      </main>
    </div>
  );
}

function Body({ state, socket, secondsLeft, roundReveal, images }: {
  state: NonNullable<ReturnType<typeof useGame>['state']>;
  socket: ReturnType<typeof useGame>['socket'];
  secondsLeft: number | null;
  roundReveal: ReturnType<typeof useGame>['roundReveal'];
  images: string[] | null;
}) {
  const target = state.reveal?.target;
  const forbidden = state.reveal?.forbidden ?? [];

  if (state.phase === 'lobby' || state.phase === 'finalScores') {
    return (
      <div className="animate-fade-up">
        <h2 className="font-display text-2xl font-bold mb-4">
          {state.phase === 'lobby' ? 'Waiting for the game to start' : 'Game over'}
        </h2>
        <ScoreTable teams={state.teams} />
      </div>
    );
  }

  // Only the prompting team's station has a target; others just wait.
  if (!target) {
    return (
      <div className="animate-fade-up text-center min-h-[40vh] grid place-items-center">
        <div>
          <p className="label">Now prompting</p>
          <h2 className="font-display text-huge font-bold mt-2">{state.prompterTeamName}</h2>
          <p className="text-muted mt-3">This station only shows the target during your own team's turn.</p>
        </div>
      </div>
    );
  }

  if (state.phase === 'reveal' || state.phase === 'compose') {
    return <Compose target={target} forbidden={forbidden} active={state.phase === 'compose'} socket={socket} secondsLeft={secondsLeft} maxLen={state.maxPromptLength ?? 300} />;
  }

  if (state.phase === 'generating') {
    return (
      <div className="animate-fade-up text-center min-h-[40vh] grid place-items-center">
        <div>
          <div className="mx-auto mb-6 h-14 w-14 rounded-full border-4 border-line border-t-violet animate-spin" />
          <h2 className="font-display text-2xl font-bold">Painting your idea…</h2>
          <p className="text-muted mt-2">Watch the projector for trivia while we generate.</p>
          {state.prompt && <p className="mt-4 chip bg-surface-2 text-muted">“{state.prompt}”</p>}
        </div>
      </div>
    );
  }

  if (state.phase === 'picking') {
    return <PickGrid images={images ?? state.images ?? []} secondsLeft={secondsLeft} />;
  }

  if (state.phase === 'guessing') {
    return (
      <div className="animate-fade-up text-center min-h-[40vh] grid place-items-center">
        <div>
          {state.chosenImage && (
            <img src={state.chosenImage} alt="chosen" className="mx-auto rounded-2xl max-h-[50vh] shadow-card" />
          )}
          <h2 className="font-display text-2xl font-bold mt-6">Teams are guessing…</h2>
          {secondsLeft != null && <p className="text-gold font-display text-3xl mt-2">{Math.ceil(secondsLeft)}s</p>}
        </div>
      </div>
    );
  }

  if (state.phase === 'roundReveal') {
    return (
      <div className="animate-fade-up">
        <p className="label">The answer was</p>
        <h2 className="font-display text-huge font-bold mb-4">{roundReveal?.target ?? target}</h2>
        <div className="card p-5 mb-6">
          <div className="label mb-1">Your prompt</div>
          <p className="text-lg">“{roundReveal?.prompt ?? state.prompt}”</p>
        </div>
        <ScoreTable teams={state.teams} highlightId={state.prompterTeamId ?? undefined} />
      </div>
    );
  }

  return null;
}

function Compose({ target, forbidden, active, socket, secondsLeft, maxLen }: {
  target: string; forbidden: string[]; active: boolean;
  socket: ReturnType<typeof useGame>['socket']; secondsLeft: number | null; maxLen: number;
}) {
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<{ type: string; term?: string }[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const segments = useMemo(() => segmentForbidden(text, forbidden), [text, forbidden]);
  const liveHits = useMemo(() => Array.from(new Set(segments.filter((s) => s.forbidden).map((s) => s.text.toLowerCase()))), [segments]);

  useEffect(() => {
    if (active && socket) socket.emit('prompt:keystroke', { draft: text });
  }, [text, active, socket]);

  function syncScroll() {
    if (backdropRef.current && taRef.current) backdropRef.current.scrollTop = taRef.current.scrollTop;
  }

  async function submit() {
    if (liveHits.length > 0) {
      setErrors(liveHits.map((t) => ({ type: 'forbidden', term: t })));
      return;
    }
    try {
      const res = await api.submitPrompt(text);
      if (res.ok) setSubmitted(true);
      else setErrors(res.errors ?? []);
    } catch (e) {
      const data = (e as { data?: { errors?: { type: string; term?: string }[] } }).data;
      setErrors(data?.errors ?? [{ type: 'unknown' }]);
    }
  }

  const over = text.length > maxLen;

  return (
    <div className="grid md:grid-cols-[1fr_auto] gap-8 items-start animate-fade-up">
      <div>
        <p className="label">Make them guess</p>
        <h2 className="font-display text-mega font-bold leading-none mb-6">{target}</h2>

        <div className="label mb-2">Forbidden — don't type these</div>
        <div className="flex flex-wrap gap-2 mb-6">
          {forbidden.map((w) => (
            <span key={w} className={`chip ${liveHits.includes(w.toLowerCase()) ? 'bg-coral text-white' : 'bg-surface-2 text-coral/80'}`}>{w}</span>
          ))}
        </div>

        <div className="relative">
          {/* Highlight backdrop mirrors the textarea text. */}
          <div
            ref={backdropRef}
            aria-hidden
            className="input absolute inset-0 overflow-auto whitespace-pre-wrap break-words pointer-events-none text-transparent"
          >
            {segments.map((s, i) =>
              s.forbidden ? (
                <mark key={i} className="bg-coral/40 text-transparent rounded">{s.text}</mark>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
            {'​'}
          </div>
          <textarea
            ref={taRef}
            className="input relative bg-transparent min-h-[160px] resize-none caret-white"
            placeholder={active ? 'Describe the picture without the forbidden words…' : 'Wait for the operator to start the timer…'}
            value={text}
            disabled={!active || submitted}
            onChange={(e) => setText(e.target.value)}
            onScroll={syncScroll}
            autoFocus={active}
          />
        </div>

        <div className="flex items-center justify-between mt-3">
          <span className={`text-sm ${over ? 'text-coral' : 'text-muted'}`}>{text.length} / {maxLen}</span>
          {liveHits.length > 0 && <span className="text-coral text-sm">Remove: {liveHits.join(', ')}</span>}
        </div>

        {errors.length > 0 && (
          <div className="mt-3 card p-4 border-coral/40">
            {errors.map((e, i) => (
              <p key={i} className="text-coral text-sm">
                {e.type === 'forbidden' && <>You can't use “{e.term}”. Reword it.</>}
                {e.type === 'profanity' && <>Please keep it clean — that word isn't allowed.</>}
                {e.type === 'length' && <>Too long — keep it under {maxLen} characters.</>}
                {e.type === 'phase' && <>The composing window isn't open.</>}
                {e.type === 'unknown' && <>Something went wrong submitting. Try again.</>}
              </p>
            ))}
          </div>
        )}

        <button className="btn-primary mt-5 text-lg px-8" disabled={!active || submitted || over || liveHits.length > 0 || !text.trim()} onClick={submit}>
          {submitted ? 'Sent! Generating…' : 'Generate image'}
        </button>
      </div>

      <div className="justify-self-center md:sticky md:top-8">
        {active && secondsLeft != null ? (
          <CountdownRing secondsLeft={secondsLeft} total={Math.max(secondsLeft, 1)} />
        ) : (
          <div className="text-center text-muted">
            <div className="font-display text-2xl">Ready</div>
            <div className="text-sm">timer starts on operator cue</div>
          </div>
        )}
      </div>
    </div>
  );
}

function PickGrid({ images, secondsLeft }: { images: string[]; secondsLeft: number | null }) {
  const [picking, setPicking] = useState<number | null>(null);
  async function pick(i: number) {
    setPicking(i);
    try { await api.pickImage(i); } catch { setPicking(null); }
  }
  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-display text-2xl font-bold">Pick your image</h2>
        {secondsLeft != null && <span className="text-gold font-display text-2xl">{Math.ceil(secondsLeft)}s</span>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        {images.map((src, i) => (
          <button
            key={i}
            onClick={() => pick(i)}
            disabled={picking !== null}
            className={`group relative rounded-2xl overflow-hidden border-2 transition ${picking === i ? 'border-mint' : 'border-line hover:border-violet'}`}
          >
            <img src={src} alt={`option ${i + 1}`} className="w-full aspect-square object-cover" />
            <span className="absolute inset-x-0 bottom-0 bg-ink/80 py-2 text-center font-display font-semibold opacity-0 group-hover:opacity-100 transition">
              Use this one
            </span>
          </button>
        ))}
        {images.length === 0 && <p className="text-muted col-span-2">No images yet…</p>}
      </div>
    </div>
  );
}
