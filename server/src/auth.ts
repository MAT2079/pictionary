import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

// Operator password gate (spec §6, §15). The canonical password is the
// OPERATOR_PASSWORD env var; a Settings change applies for the running session
// only (held in memory here, reverts on redeploy/spin-down).
let currentPassword = process.env.OPERATOR_PASSWORD ?? 'adminburger';

// Random per-process signing secret for session tokens. Sessions naturally
// invalidate on redeploy, which is acceptable for a single-event app.
const SIGNING_SECRET = randomBytes(32);
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

export function getOperatorPassword(): string {
  return currentPassword;
}

export function setOperatorPassword(pw: string): void {
  currentPassword = pw;
}

export function checkPassword(candidate: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(currentPassword);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sign(data: string): string {
  return createHmac('sha256', SIGNING_SECRET).update(data).digest('base64url');
}

export function issueSession(): string {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `op.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [role, expiresStr, sig] = parts;
  const payload = `${role}.${expiresStr}`;
  const expected = sign(payload);
  if (sig.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const expires = Number(expiresStr);
  return Number.isFinite(expires) && Date.now() < expires;
}

function extractToken(req: Request): string | undefined {
  const auth = req.header('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  // Cookie fallback for browser operator console.
  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookie?.op_session;
}

/** Express middleware: 401 unless a valid operator session is present. */
export function requireOperator(req: Request, res: Response, next: NextFunction): void {
  if (verifySession(extractToken(req))) {
    next();
    return;
  }
  res.status(401).json({ error: 'operator session required' });
}

// ---- Worker bearer auth (spec §12.2) ------------------------------------
export function requireWorker(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.WORKER_SECRET ?? 'dev-worker-secret';
  const auth = req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length === b.length && timingSafeEqual(a, b)) {
    next();
    return;
  }
  res.status(401).json({ error: 'invalid worker secret' });
}
