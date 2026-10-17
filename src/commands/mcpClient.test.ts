import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { connectMcpServer, disconnectMcpServer } from './mcpClient';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined), isTauri: () => true }));
describe('MCP explicit disconnect', () => {
  it('does not automatically undo a manual disconnect, while allowing explicit reconnection', async () => {
    vi.mocked(invoke).mockClear();
    await disconnectMcpServer('manual-fixture');
    await connectMcpServer('manual-fixture', { automatic: true });
    expect(invoke).toHaveBeenCalledTimes(1);
    await connectMcpServer('manual-fixture');
    expect(invoke).toHaveBeenLastCalledWith('connect_mcp_server', { id: 'manual-fixture' });
  });
  it('shares simultaneous connection requests for the same server', async () => {
    vi.mocked(invoke).mockClear();
    await Promise.all([connectMcpServer('concurrent-fixture', { automatic: true }), connectMcpServer('concurrent-fixture')]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
