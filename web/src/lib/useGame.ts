import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { connectSocket } from './socket';
import type { Role } from './roles';
import type { ClientState, RoundReveal, TimerTick } from './types';

export interface GameHook {
  socket: Socket | null;
  state: ClientState | null;
  connected: boolean;
  secondsLeft: number | null;
  roundReveal: RoundReveal | null;
  trivia: string | null;
  images: string[] | null; // operator/prompter pick grid
  forbiddenHits: string[];
}

/** Connects a socket for the given role, tracks redacted state, derives a
 *  server-authoritative countdown from timer ticks, and surfaces one-off
 *  events (round reveal, trivia, images). */
export function useGame(role: Role, token?: string): GameHook {
  const socketRef = useRef<Socket | null>(null);
  const [state, setState] = useState<ClientState | null>(null);
  const [connected, setConnected] = useState(false);
  const [tick, setTick] = useState<TimerTick | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [roundReveal, setRoundReveal] = useState<RoundReveal | null>(null);
  const [trivia, setTrivia] = useState<string | null>(null);
  const [images, setImages] = useState<string[] | null>(null);
  const [forbiddenHits, setForbiddenHits] = useState<string[]>([]);

  useEffect(() => {
    const socket = connectSocket(role, token);
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('state:update', (s: ClientState) => {
      setState(s);
      if (!s.timer) setSecondsLeft(null);
      // New round clears the previous reveal once we leave roundReveal.
      if (s.phase !== 'roundReveal') setRoundReveal(null);
      if (s.phase !== 'generating') setTrivia(null);
    });
    socket.on('timer:tick', (t: TimerTick) => setTick(t));
    socket.on('round:reveal', (r: RoundReveal) => setRoundReveal(r));
    socket.on('trivia:show', (p: { card: { text: string } }) => setTrivia(p.card.text));
    socket.on('images:ready', (p: { images: string[] }) => setImages(p.images));
    socket.on('prompt:hits', (p: { hits: string[] }) => setForbiddenHits(p.hits));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [role, token]);

  // Smooth local countdown between server ticks (server remains authoritative).
  useEffect(() => {
    if (!tick) return;
    let raf = 0;
    const update = () => {
      const left = Math.max(0, (tick.endsAt - Date.now()) / 1000);
      setSecondsLeft(left);
      if (left > 0) raf = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(raf);
  }, [tick]);

  return {
    socket: socketRef.current,
    state,
    connected,
    secondsLeft,
    roundReveal,
    trivia,
    images,
    forbiddenHits,
  };
}
