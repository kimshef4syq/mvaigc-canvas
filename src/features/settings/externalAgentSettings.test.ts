import { describe, it, expect } from 'vitest';
import { DEFAULT_CLAUDE_CODE_PROJECT_DIR, normalizeClaudeCodeProjectDir } from './externalAgentSettings';

describe('externalAgentSettings', () => {
  it('defaults to empty project dir', () => {
    expect(DEFAULT_CLAUDE_CODE_PROJECT_DIR).toBe('');
  });
  it('trims and preserves empty as disable', () => {
    expect(normalizeClaudeCodeProjectDir('  /a/b  ')).toBe('/a/b');
    expect(normalizeClaudeCodeProjectDir('   ')).toBe('');
  });
});
