import { connectMcpServer, listMcpAgentTools, listMcpServers } from '@/commands/mcpClient';
import { redactSensitiveValue } from './agentRedaction';

export async function prepareAgentMcpConnections() {
  const servers = await listMcpServers();
  const errors = new Map<string, string>();
  await Promise.all(servers.filter((server) => !server.connected && server.config.allowedTools.length > 0).map(async (server) => {
    try { await connectMcpServer(server.config.id, { automatic: true }); }
    catch (error) { errors.set(server.config.id, redactSensitiveValue(String(error))); }
  }));
  const [current, tools] = await Promise.all([listMcpServers(), listMcpAgentTools()]);
  return {
    tools,
    status: current.map((server) => ({ serverId: server.config.id, connected: server.connected, authorizedToolCount: server.config.allowedTools.length, ...(errors.has(server.config.id) ? { error: errors.get(server.config.id) } : {}) })),
  };
}
