import { invoke, isTauri } from '@tauri-apps/api/core';

export interface McpConfig { id: string; label: string; transport: 'stdio' | 'http'; command: string; args: string[]; url: string; allowedTools: string[] }
export interface McpToolDefinition { name: string; description?: string; inputSchema: Record<string, unknown> }
export interface McpServerView { config: McpConfig; connected: boolean; tools: McpToolDefinition[] }
export interface McpAgentTool { agentName: string; serverId: string; revision: string; tool: McpToolDefinition }
export const listMcpServers = (): Promise<McpServerView[]> => isTauri() ? invoke('list_mcp_servers') : Promise.resolve([]);
export const saveMcpServer = (config: McpConfig) => invoke<void>('save_mcp_server', { config });
export const removeMcpServer = (id: string) => invoke<void>('remove_mcp_server', { id });
const manuallyDisconnected = new Set<string>();
const connecting = new Map<string, Promise<void>>();
export function connectMcpServer(id: string, options?: { automatic: boolean }): Promise<void> {
  if (options?.automatic && manuallyDisconnected.has(id)) return Promise.resolve();
  if (!options?.automatic) manuallyDisconnected.delete(id);
  const pending = connecting.get(id);
  if (pending) return pending;
  const task = invoke<void>('connect_mcp_server', { id }).finally(() => { connecting.delete(id); });
  connecting.set(id, task);
  return task;
}
export async function disconnectMcpServer(id: string): Promise<void> {
  manuallyDisconnected.add(id);
  await connecting.get(id)?.catch(() => {});
  await invoke<void>('disconnect_mcp_server', { id });
}
export const listMcpAgentTools = (): Promise<McpAgentTool[]> => isTauri() ? invoke('list_mcp_agent_tools') : Promise.resolve([]);
export const callMcpTool = (serverId: string, toolName: string, revision: string, args: Record<string, unknown>) => invoke<Record<string, unknown>>('call_mcp_tool', { serverId, toolName, revision, arguments: args });
