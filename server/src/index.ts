import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { buildRouter, registerWorkerRoutes } from './http.js';
import { requireWorker } from './auth.js';
import { setupSockets } from './sockets.js';
import { loadPool } from './pool.js';
import { loadTrivia } from './trivia.js';
import { setSettings } from './state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadProfanity(): string[] {
  const path = join(__dirname, '..', 'data', 'profanity.txt');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function main(): void {
  // Load game data into memory (spec §3: no database).
  loadPool();
  loadTrivia();
  setSettings({ profanity: loadProfanity() });

  const app = express();
  app.set('trust proxy', true);
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '15mb' })); // worker uploads base64 JPEG batches
  app.use(cookieParser());

  // Worker endpoints, mounted at /worker behind Bearer WORKER_SECRET (spec §12.2).
  // Scoping the auth to this mount keeps it off the public/player routes.
  const workerRouter = express.Router();
  workerRouter.use(requireWorker);
  registerWorkerRoutes(workerRouter);
  app.use('/worker', workerRouter);

  // REST API (phone/operator/prompter).
  app.use(buildRouter());

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Serve the built frontend (single Render web service, spec §4/§13).
  const webDist = join(__dirname, '..', '..', 'web', 'dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    // SPA fallback for the four view routes (and anything else non-API).
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/worker')) return next();
      res.sendFile(join(webDist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) =>
      res.send('AI Pictionary server running. Frontend not built (run `npm run build`).'),
    );
  }

  const server = createServer(app);
  setupSockets(server);

  const port = Number(process.env.PORT) || 3000;
  // Bind 0.0.0.0 or Render marks the service unhealthy (spec §13).
  server.listen(port, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`AI Pictionary server listening on 0.0.0.0:${port}`);
  });
}

main();
