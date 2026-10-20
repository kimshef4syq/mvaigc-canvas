import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { X } from 'lucide-react';
import { listInstalledSkills, installLocalSkill, installSkillZip, removeSkill, rollbackSkill, setSkillEnabled, type InstalledSkillPackage } from '@/commands/extensions';
import { parseInstalledSkill, refreshInstalledAgentSkills } from '../application/installedSkills';
import { McpServersPanel } from './McpServersPanel';

export function AgentExtensionsPanel({ onClose, onUse }: { onClose: () => void; onUse: (id: string) => void }) {
  const [packages, setPackages] = useState<InstalledSkillPackage[]>([]);
  const [id, setId] = useState('');
  const [url, setUrl] = useState('');
  const [sha, setSha] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = async () => { setPackages(await listInstalledSkills()); await refreshInstalledAgentSkills(true); };
  useEffect(() => { void reload().catch((e) => setError(String(e))); }, []);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); await reload(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const selectLocal = async (directory: boolean) => {
    const source = await open({ directory, multiple: false, ...(directory ? {} : { filters: [{ name: '技能包', extensions: ['zip'] }] }) });
    if (typeof source === 'string') await act(() => installLocalSkill(id.trim(), source));
  };
  const button = 'rounded border border-border-dark p-2 disabled:opacity-40';
  const input = 'my-1 w-full rounded border border-border-dark bg-transparent p-2';
  return <div className="absolute inset-0 z-[75] flex items-center justify-center bg-black/35 p-3" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
    <section role="dialog" aria-modal="true" aria-label="技能与插件" className="flex max-h-[calc(100vh-60px)] w-full max-w-xl flex-col rounded-xl border border-border-dark bg-[var(--ui-surface-panel)] text-text-dark shadow-xl">
      <header className="flex items-center justify-between border-b border-border-dark p-3"><h2 className="text-sm font-semibold">技能与插件</h2><button autoFocus type="button" aria-label="关闭扩展管理" className="rounded p-2" onClick={onClose}><X className="h-4 w-4" /></button></header>
      <div className="ui-scrollbar space-y-4 overflow-y-auto p-4 text-xs">
        <McpServersPanel />
        <p className="text-text-muted">安装 SKILL.md 及附带资源。技能提供任务指导，脚本不会自动执行，也不会自动获得工具权限。同名安装会更新技能。</p>
        <div className="space-y-2 rounded-lg border border-border-dark p-3">
          <label className="block">安装 ID（小写字母、数字、连字符）<input value={id} onChange={(e) => setId(e.target.value)} placeholder="storyboard-director" className={input} /></label>
          <div className="flex gap-2"><button disabled={busy || !id.trim()} type="button" onClick={() => void selectLocal(true).catch((e) => setError(String(e)))} className={button}>从文件夹安装</button><button disabled={busy || !id.trim()} type="button" onClick={() => void selectLocal(false).catch((e) => setError(String(e)))} className={button}>从 ZIP 安装</button></div>
          <details><summary className="cursor-pointer py-2">从 HTTPS 地址安装</summary><label className="block">ZIP 直链<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/skill.zip" className={input} /></label><label className="block">SHA256（可选）<input value={sha} onChange={(e) => setSha(e.target.value)} placeholder="64 位十六进制，留空则跳过校验" className={input} /></label>{sha.trim() === '' && <p className="text-amber-600">未填写 SHA256：将跳过完整性校验，请确认下载来源可信。</p>}<button disabled={busy || !id.trim() || !url} type="button" onClick={() => void act(() => installSkillZip(id.trim(), url.trim(), sha.trim() || undefined))} className={button}>下载并安装</button></details>
        </div>
        {error && <p role="alert" className="whitespace-pre-wrap text-red-500">{error}</p>}
        <div className="flex items-center justify-between"><h3 className="font-semibold">已安装技能（{packages.length}）</h3><button disabled={busy} type="button" onClick={() => void act(reload)} className="p-2">刷新</button></div>
        {!packages.length && <p className="text-text-muted">选择包含 SKILL.md 的单个技能文件夹即可导入。</p>}
        {packages.map((pkg) => {
          let summary = ''; let parseError = ''; let missing: string[] = [];
          try { const skill = parseInstalledSkill(pkg); summary = skill.summary; missing = skill.missingTools; } catch (e) { parseError = String(e); }
          return <article key={pkg.id} className="space-y-2 rounded-lg border border-border-dark p-3"><div className="flex items-center justify-between"><strong>{pkg.id}</strong><span>{pkg.enabled ? '已启用' : '已禁用'}</span></div><p className="text-text-muted">{summary || parseError}</p>{missing.length > 0 && <p className="text-amber-600">尚未适配的工具要求：{missing.join('、')}</p>}<p className="text-text-muted">{pkg.resources.length} 个资源 · 版本 {pkg.revision.slice(0, 10)}</p><div className="flex flex-wrap gap-2"><button disabled={busy || !pkg.enabled || !!parseError} type="button" className={button} onClick={() => onUse(pkg.id)}>使用此技能</button><button disabled={busy} type="button" className={button} onClick={() => void act(() => setSkillEnabled(pkg.id, !pkg.enabled))}>{pkg.enabled ? '禁用' : '启用'}</button><button disabled={busy} type="button" className={button} onClick={() => void act(() => rollbackSkill(pkg.id))}>恢复上一版本</button><button disabled={busy} type="button" className={`${button} text-red-500`} onClick={() => void act(() => removeSkill(pkg.id))}>卸载</button></div></article>;
        })}
      </div>
    </section>
  </div>;
}
