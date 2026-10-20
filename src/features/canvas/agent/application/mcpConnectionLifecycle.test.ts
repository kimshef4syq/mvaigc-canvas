import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectMcpServer, listMcpAgentTools, listMcpServers, type McpServerView } from '@/commands/mcpClient';
import { prepareAgentMcpConnections } from './mcpConnectionLifecycle';

vi.mock('@/commands/mcpClient', () => ({ connectMcpServer: vi.fn(), listMcpAgentTools: vi.fn(), listMcpServers: vi.fn() }));
const server = (id: string, granted: boolean, connected = false): McpServerView => ({ config: { id, label: id, transport: 'stdio', command: '/app/ResolveMCP', args: [], url: '', allowedTools: granted ? ['run_script'] : [] }, connected, tools: [] });
describe('MCP connection lifecycle', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(listMcpAgentTools).mockResolvedValue([]); });
  it('reconnects previously authorized servers before reading the tools for the new turn', async () => {
    const connected = new Set<string>();
    vi.mocked(listMcpServers).mockImplementation(async () => [server('davinci', true, connected.has('davinci')), server('unapproved', false)]);
    vi.mocked(connectMcpServer).mockImplementation(async (id) => { connected.add(id); });
    vi.mocked(listMcpAgentTools).mockImplementation(async () => { expect(connected.has('davinci')).toBe(true); return []; });
    const result = await prepareAgentMcpConnections();
    expect(connectMcpServer).toHaveBeenCalledExactlyOnceWith('davinci', { automatic: true });
    expect(result.status).toEqual([{ serverId: 'davinci', connected: true, authorizedToolCount: 1 }, { serverId: 'unapproved', connected: false, authorizedToolCount: 0 }]);
  });
  it('keeps canvas tasks available when a server fails and sends only redacted error evidence', async () => {
    vi.mocked(listMcpServers).mockResolvedValue([server('davinci', true)]);
    vi.mocked(connectMcpServer).mockRejectedValue(new Error('Missing /Applications/ResolveMCP'));
    const result = await prepareAgentMcpConnections();
    expect(result.tools).toEqual([]);
    expect(result.status).toMatchObject([{ serverId: 'davinci', connected: false, error: '[redacted-path]' }]);
  });
});
