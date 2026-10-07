import { describe, expect, it } from 'vitest';

import { isMvaigcCredentialsComplete, normalizeMvaigcPort } from './mvaigcSettings';

describe('normalizeMvaigcPort', () => {
  it('parses a valid port string', () => {
    expect(normalizeMvaigcPort('9000')).toBe(9000);
  });

  it('falls back to the default for empty or invalid input', () => {
    expect(normalizeMvaigcPort('')).toBe(8787);
    expect(normalizeMvaigcPort('abc')).toBe(8787);
  });

  it('clamps out-of-range values into 1..65535', () => {
    expect(normalizeMvaigcPort('0')).toBe(1);
    expect(normalizeMvaigcPort('70000')).toBe(65535);
  });
});

describe('isMvaigcCredentialsComplete', () => {
  it('is true only when both account and password are non-empty', () => {
    expect(isMvaigcCredentialsComplete('user', 'pass')).toBe(true);
    expect(isMvaigcCredentialsComplete('', 'pass')).toBe(false);
    expect(isMvaigcCredentialsComplete('user', '')).toBe(false);
    expect(isMvaigcCredentialsComplete('  ', 'pass')).toBe(false);
  });
});
