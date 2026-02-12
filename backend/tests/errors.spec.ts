import express from 'express';
import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { errorMiddleware } from '../src/lib/errors.js';

describe('errorMiddleware', () => {
  it('maps legacy errors with status/detail to JSON response', async () => {
    const app = express();

    app.get('/legacy-rate-limit', (_req, _res, next) => {
      const err = new Error('Price provider error') as Error & { status: number; detail?: string };
      err.status = 429;
      err.detail = 'Rate-limited by price provider. Please retry shortly.';
      next(err);
    });

    app.use(errorMiddleware);

    const res = await request(app).get('/legacy-rate-limit');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: 'Price provider error',
      detail: 'Rate-limited by price provider. Please retry shortly.',
    });
  });
});
