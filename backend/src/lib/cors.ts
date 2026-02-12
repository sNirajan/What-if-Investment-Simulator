/**
 * Helpers for CORS origin configuration.
 *
 * Supports both:
 * - ALLOWED_ORIGIN="https://app.example.com" (legacy)
 * - ALLOWED_ORIGINS="https://app.example.com,https://preview.example.com"
 */
export function parseAllowedOrigins(origins?: string, legacyOrigin?: string): string[] {
  const fromList = (origins || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const fromLegacy = legacyOrigin?.trim() ? [legacyOrigin.trim()] : [];

  return [...new Set([...fromList, ...fromLegacy])];
}
