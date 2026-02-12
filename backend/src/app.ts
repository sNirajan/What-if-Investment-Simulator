/**
 * Express application bootstrap.
 *
 * Responsibilities:
 * - Create and configure the Express app (JSON body parsing, CORS).
 * - Mount feature routers under versioned API paths.
 * - Provide a basic health endpoint.
 * - Attach global 404 and error handlers at the end of the middleware chain.
 *
 * Notes:
 * - We export `app` (without calling `listen`) so tests can import it directly.
 * - The actual server port binding happens in `index.ts`.
 */

import express from 'express';
import cors from 'cors';
import { env } from './lib/config.js';
import { parseAllowedOrigins } from './lib/cors.js';
import { errorMiddleware, notFound } from './lib/errors.js';
import { router as backtest } from './routes/backtest.js';
import { prisma } from './lib/db.js';

// Parse incoming JSON bodies into `req.body`
// (applies to all routes below this line).
export const app = express();
app.use(express.json());

// Allow browser frontends to call our API.
// Supports ALLOWED_ORIGIN (legacy) and ALLOWED_ORIGINS (comma-separated).
const configuredOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS, env.ALLOWED_ORIGIN);
const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : ['http://localhost:3000'];

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser and same-origin requests (no Origin header).
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
  })
);

// Simple liveness check for load balancers + local debugging.
app.get('/api/v1/health', (_req, res) =>
  res.json({ ok: true, service: 'what-if-simulator', version: '0.0.1' })
);

app.get('/api/v1/db/health', async (_req, res, next) => {
  try {
    const count = await prisma.scenario.count();
    res.json({ ok: true, model: 'Scenario', count });
  } catch (e) {
    next(e);
  }
});

// ---- Feature routers ----
// All "business" endpoints live under /api/v1/... for clean versioning.
app.use('/api/v1/backtest', backtest);

// If no route matched above, return a consistent 404 JSON shape.
app.use(notFound);

// Last middleware: convert thrown errors into consistent JSON responses.
app.use(errorMiddleware);
