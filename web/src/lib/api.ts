const BASE = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? '';

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw Object.assign(new Error(data.error ?? res.statusText), { status: res.status, data });
  return data as T;
}

export const api = {
  // Phone
  join: (teamName: string) => req<{ teamId: string; token: string }>('/api/join', { method: 'POST', body: JSON.stringify({ teamName }) }),
  rejoin: (token: string) => req<{ teamId: string; name: string }>('/api/rejoin', { method: 'POST', body: JSON.stringify({ token }) }),
  guess: (token: string, text: string) => req<{ accepted: boolean; correct: boolean; reason?: string }>('/api/guess', { method: 'POST', body: JSON.stringify({ token, text }) }),

  // Prompter
  submitPrompt: (prompt: string) => req<{ ok: boolean; errors?: { type: string; term?: string }[] }>('/api/prompt/submit', { method: 'POST', body: JSON.stringify({ prompt }) }),
  pickImage: (index: number) => req<{ ok: boolean }>('/api/prompt/pick', { method: 'POST', body: JSON.stringify({ index }) }),

  // Operator
  login: (password: string) => req<{ sessionToken: string }>('/api/operator/login', { method: 'POST', body: JSON.stringify({ password }) }),
  op: (action: string, body?: unknown) => req<{ ok: boolean }>(`/api/operator/${action}`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  getSettings: () => req('/api/settings'),
  putSettings: (patch: unknown) => req('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  getPool: () => req<{ entries: PoolEntry[]; unused: number }>('/api/operator/pool'),
  addPool: (e: unknown) => req('/api/operator/pool', { method: 'POST', body: JSON.stringify(e) }),
  updatePool: (id: string, patch: unknown) => req(`/api/operator/pool/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  removePool: (id: string) => req(`/api/operator/pool/${id}`, { method: 'DELETE' }),
  resetUsed: () => req('/api/operator/pool-reset-used', { method: 'POST', body: '{}' }),
  getTrivia: () => req<{ cards: { id: string; text: string }[] }>('/api/operator/trivia'),
  addTrivia: (text: string) => req('/api/operator/trivia', { method: 'POST', body: JSON.stringify({ text }) }),
  removeTrivia: (id: string) => req(`/api/operator/trivia/${id}`, { method: 'DELETE' }),
  getSnapshot: () => req('/api/operator/snapshot'),
  importSnapshot: (snap: unknown) => req('/api/operator/snapshot', { method: 'POST', body: JSON.stringify(snap) }),
  finalScores: () => req<{ name: string; score: number }[]>('/api/operator/final-scores'),
  joinUrl: () => req<{ url: string }>('/api/join-url'),
};

export interface PoolEntry {
  id: string;
  target: string;
  forbidden: string[];
  acceptedGuesses: string[];
  category?: string;
  used: boolean;
}
