/** Default local port for the built-in mvaigc reverse proxy. */
export const DEFAULT_MVAIGC_PORT = 8787;

/**
 * Coerce user input into a usable TCP port. Empty or unparseable input falls
 * back to the default; out-of-range values clamp into 1..65535.
 */
export function normalizeMvaigcPort(raw: string | number): number {
  const value = typeof raw === 'number' ? raw : Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value) || value <= 0) {
    return Number.isNaN(value) ? DEFAULT_MVAIGC_PORT : 1;
  }
  return Math.min(65535, Math.max(1, Math.trunc(value)));
}

/** Both fields must be present (non-blank) before credentials are usable. */
export function isMvaigcCredentialsComplete(account: string, password: string): boolean {
  return account.trim().length > 0 && password.trim().length > 0;
}
