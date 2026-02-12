/**
 * Centralized error utilities for the API.
 *
 * Why this file exists:
 * - Give us a consistent JSON error shape.
 * - Distinguish between *expected* errors (bad input, not found) and
 *   *unexpected* errors (bugs, provider down).
 * - Keep all Express error plumbing in one place.
 */
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

function hasLegacyHttpStatus(err: unknown): err is Error & { status: number; detail?: unknown } {
  if (!(err instanceof Error)) return false;
  const maybeStatus = (err as { status?: unknown }).status;
  return typeof maybeStatus === 'number' && Number.isInteger(maybeStatus) && maybeStatus >= 400 && maybeStatus <= 599;
}


/**
 * AppError: throw this for business/expected failures.
 * Example: new AppError(422, "Insufficient data")
 */
export class AppError extends Error {
  status: number;
  expose: boolean;
  constructor(status: number, message: string, expose = true) {
    super(message);
    this.status = status;   // Http Status Code
    this.expose = expose;   // if false, hide message from clients
  }
}

/** 404 handler: runs if no route matched. */
export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Not Found' });
}

/**
 * Final error middleware: converts thrown errors → JSON responses.
 * Order matters: this must be mounted *after* all routes.
 */
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  // 1) Our own expected errors
  if (err instanceof AppError) {
    const body = err.expose ? { error: err.message } : { error: 'Error' };
    return res.status(err.status).json(body);
  }

  // 2) Validation errors from Zod (bad request body/query)
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'ValidationError', details: err.flatten() });
  }

  // 3) Backward-compatibility: plain Error objects with `status`.
  // Some older code paths throw `Error` and attach { status, detail }.
  if (hasLegacyHttpStatus(err)) {
    const legacy = err as Error & { status: number; detail?: unknown };
    const body: { error: string; detail?: string } = { error: legacy.message || 'Error' };
    if (typeof legacy.detail === 'string') body.detail = legacy.detail;
    return res.status(legacy.status).json(body);
  }

  // 4) Anything else is unexpected → 500
  console.error('Unhandled error:', err);
  return res.status(500).json({ error: 'InternalServerError' });
}
