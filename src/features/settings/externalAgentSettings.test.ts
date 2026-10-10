import { describe, it, expect } from 'vitest';
import { DEFAULT_CLAUDE_CODE_PROJECT_DIR, normalizeClaudeCodeProjectDir } from './externalAgentSettings';

describe('externalAgentSettings', () => {
  it('defaults to the 000OD project dir', () => {
    expect(DEFAULT_CLAUDE_CODE_PROJECT_DIR).toBe('/Users/spic007/Downloads/07-项目文件/000OD');
  });
  it('trims and preserves empty as disable', () => {
    expect(normalizeClaudeCodeProjectDir('  /a/b  ')).toBe('/a/b');
    expect(normalizeClaudeCodeProjectDir('   ')).toBe('');
  });
});
