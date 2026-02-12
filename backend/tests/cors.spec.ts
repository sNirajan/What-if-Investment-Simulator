import { describe, expect, it } from 'vitest';
import { parseAllowedOrigins } from '../src/lib/cors.js';

describe('parseAllowedOrigins', () => {
  it('parses comma-separated origins and trims spaces', () => {
    expect(parseAllowedOrigins('https://a.com, https://b.com')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('includes legacy ALLOWED_ORIGIN and removes duplicates', () => {
    expect(parseAllowedOrigins('https://a.com,https://b.com', 'https://a.com')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('returns an empty list for blank values', () => {
    expect(parseAllowedOrigins('  ,  ', '   ')).toEqual([]);
  });
});
