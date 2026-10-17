import { useEffect, useState } from 'react';
import { connectMcpServer, disconnectMcpServer, listMcpServers, removeMcpServer, saveMcpServer, type McpConfig, type McpServerView } from '@/commands/mcpClient';

const EMPTY: McpConfig = { id: '', label: '', transport: 'stdio', command: '', args: [], url: '', allowedTools: [] };
export function McpServersPanel() {
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [config, setConfig] = useState<McpConfig>(EMPTY);
  const [args, setArgs] = useState('[]');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [grants, setGrants] = useState<Record<string, string[]>>({});
  const reload = async () => {
    const items = await listMcpServers(); setServers(items);
    setGrants(Object.fromEntries(items.map((item) => [item.config.id, item.config.allowedTools])));
  };
  useEffect(() => { void reload().catch((e) => setError(String(e))); }, []);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); await reload(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const save = async () => {
    const parsed: unknown = JSON.parse(args);
    if (!Array.isArray(parsed) || !parsed.every((arg) => typeof arg === 'string')) throw new Error('启动参数须为字符串数组，例如 ["server.py"]');
    await saveMcpServer({ ...config, args: parsed, allowedTools: [] });
    setConfig(EMPTY); setArgs('[]');
  };
  const button = 'rounded border border-border-dark p-2 disabled:opacity-40';
  const input = 'my-1 w-full rounded border border-border-dark bg-transparent p-2';
  return <div className="space-y-3">
    <h3 className="font-semibold">MCP 工具连接</h3>
    <p className="text-text-muted">连接 Blender、达芬奇等软件的 MCP 服务。stdio 会启动你指定的本地程序，请使用可信服务；应用不会自动安装依赖或下载执行代码。连接后勾选允许 Agent 使用的工具。已授权服务会在 Agent 任务开始时按需重连；手动断开后，本次应用运行期间不再自动连接。</p>
    <fieldset disabled={busy} className="space-y-2 rounded-lg border border-border-dark p-3">
      <legend className="px-1">添加 / 修改连接</legend>
      <label className="block">连接 ID<input className={input} value={config.id} placeholder="davinci" onChange={(e) => setConfig({ ...config, id: e.target.value })} /></label>
      <label className="block">显示名称<input className={input} value={config.label} onChange={(e) => setConfig({ ...config, label: e.target.value })} /></label>
      <label className="block">连接方式<select className={input} value={config.transport} onChange={(e) => setConfig({ ...config, transport: e.target.value as McpConfig['transport'] })}><option value="stdio">本地程序（stdio）</option><option value="http">Streamable HTTP</option></select></label>
      {config.transport === 'stdio' ? <><label className="block">程序路径<input className={input} value={config.command} placeholder="/path/to/python" onChange={(e) => setConfig({ ...config, command: e.target.value })} /></label><label className="block">启动参数（JSON 字符串数组）<textarea className={input} value={args} onChange={(e) => setArgs(e.target.value)} /></label></> : <label className="block">MCP 地址<input className={input} value={config.url} placeholder="http://127.0.0.1:8000/mcp" onChange={(e) => setConfig({ ...config, url: e.target.value })} /></label>}
      <button type="button" className={button} disabled={!config.id} onClick={() => void act(save)}>保存连接</button>
      <p className="text-text-muted">修改连接会断开服务并清空授权，需要重新连接和选取工具。暂不支持 OAuth 或需要认证头的 HTTP 服务。</p>
    </fieldset>
    {error && <p role="alert" className="whitespace-pre-wrap text-red-500">{error}</p>}
    <button type="button" disabled={busy} className={button} onClick={() => void act(reload)}>刷新连接状态</button>
    {servers.map((server) => <article key={server.config.id} className="space-y-2 rounded-lg border border-border-dark p-3">
      <div className="flex justify-between"><strong>{server.config.label || server.config.id}</strong><span>{server.connected ? '已连接' : '未连接'}</span></div>
      <p className="text-text-muted">{server.config.id} · {server.config.allowedTools.length} 个已授权工具</p>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className={button} onClick={() => void act(() => server.connected ? disconnectMcpServer(server.config.id) : connectMcpServer(server.config.id))}>{server.connected ? '断开' : '连接并发现工具'}</button><button type="button" disabled={busy} className={button} onClick={() => { setConfig(server.config); setArgs(JSON.stringify(server.config.args)); }}>编辑</button><button type="button" disabled={busy} className={`${button} text-red-500`} onClick={() => void act(() => removeMcpServer(server.config.id))}>移除</button></div>
      {server.connected && <><div className="max-h-52 space-y-2 overflow-y-auto">{server.tools.map((tool) => <label key={tool.name} className="flex items-start gap-2"><input type="checkbox" disabled={busy} checked={(grants[server.config.id] ?? []).includes(tool.name)} onChange={(e) => setGrants((old) => ({ ...old, [server.config.id]: e.target.checked ? [...(old[server.config.id] ?? []), tool.name] : (old[server.config.id] ?? []).filter((name) => name !== tool.name) }))} /><span><strong>{tool.name}</strong><span className="block text-text-muted">{tool.description?.slice(0, 240)}</span></span></label>)}</div><button type="button" disabled={busy} className={button} onClick={() => void act(async () => { await saveMcpServer({ ...server.config, allowedTools: grants[server.config.id] ?? [] }); await connectMcpServer(server.config.id); })}>应用工具授权并重新连接</button></>}
    </article>)}
  </div>;
}
