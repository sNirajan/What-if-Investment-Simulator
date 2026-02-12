/**
 * Environment configuration loader & validator.
 *
 * Responsibilities:
 * - Load process environment variables (from `.env` in dev) using dotenv.
 * - Validate and coerce them into a typed object with Zod.
 * - Provide tiny conveniences (e.g., `isStub`, numeric `port`) for consumers.
 *
 * Why Zod?
 * - Fails fast on invalid config (no mysterious runtime errors later).
 * - Gives us typed `env` everywhere else in the codebase.
 */
import 'dotenv/config';
import { z } from 'zod';

// Define the "shape" of all environment variables we care about.
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().regex(/^\d+$/).default('8080'),    // keep as string, coerce letter
  ALLOWED_ORIGIN: z.string().optional(),              // legacy single CORS origin
  ALLOWED_ORIGINS: z.string().optional(),             // comma-separated CORS origins
  STUB_DATA: z.string().optional(), // "true" | "false" (strings from .env)
});

// Validate `process.env` against our schema
const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  // Print a developer-friendly error and exit the process
  console.error('Invalid environment:', parsed.error.flatten());
  process.exit(1);
}

// Export a normalized, typed config object
// Provide small helpers so consumers don't repeat logic
export const env = {
  ...parsed.data,
  isStub: parsed.data.STUB_DATA === 'true',   // convenient boolean for feature flags
  port: Number(parsed.data.PORT),             // number for express.listen
};
