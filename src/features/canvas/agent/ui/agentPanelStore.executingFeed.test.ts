import { describe, expect, it } from 'vitest';
import { persistableFeed, type AgentFeedItem } from './agentPanelStore';

function tool(id: string, status: 'executing' | 'succeeded' | 'failed'): AgentFeedItem {
  return {
    id,
    kind: 'tool',
    toolName: 'canvas-command',
    status,
    createdAt: 1,
    startedAt: 1,
  };
}

function toolStatus(item: AgentFeedItem): string | undefined {
  return item.kind === 'tool' ? item.status : undefined;
}

describe('persistableFeed tool statuses', () => {
  it('does not persist a tool stuck in executing, so its spinner cannot survive a reload', () => {
    const [persisted] = persistableFeed([tool('t1', 'executing')]);

    expect(toolStatus(persisted)).not.toBe('executing');
    expect(toolStatus(persisted)).toBe('unknown');
  });

  it('keeps terminal tool statuses untouched', () => {
    const persisted = persistableFeed([tool('ok', 'succeeded'), tool('bad', 'failed')]);

    expect(persisted.map(toolStatus)).toEqual(['succeeded', 'failed']);
  });
});
