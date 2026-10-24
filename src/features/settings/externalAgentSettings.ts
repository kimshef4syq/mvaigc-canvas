/** Default Claude Code project directory that new connections write descriptors into. */
export const DEFAULT_CLAUDE_CODE_PROJECT_DIR = '';

/**
 * Normalize the user-entered Claude Code project directory. Surrounding
 * whitespace is trimmed; an all-blank value stays an empty string, which
 * disables automatic descriptor writing.
 */
export function normalizeClaudeCodeProjectDir(raw: string): string {
  return raw.trim();
}
