import { open as selectFolder } from '@tauri-apps/plugin-dialog';
import { Box, CheckCircle2, ChevronDown, Chrome, ExternalLink, FileText, FolderOpen, ImageIcon, Pencil, Trash2 } from 'lucide-react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { memo, useEffect, useRef, useState } from 'react';
import { Position, type NodeProps } from '@xyflow/react';
import { NodeConnectionHandle } from '@/features/canvas/ui/NodeConnectionHandle';
import { GenerationProgressOverlay } from '@/features/canvas/ui/GenerationProgressOverlay';
import { GenerationJobStatus } from '@/features/canvas/ui/GenerationJobStatus';
import { formatGenerationElapsedMs } from '@/features/canvas/ui/generationElapsed';
import { useCustomProvidersStore, customProviderMediaType } from '@/stores/customProvidersStore';
import { resolveImageDisplayUrl } from '../application/imageData';
import { generateGaussian, recoverGaussian, type GaussianGenerationTask } from '../application/gaussianGeneration';
import { useCanvasStore } from '@/stores/canvasStore';
import { persistImageSource } from '@/commands/image';
import { gaussianAssets, type GaussianAsset } from '@/features/supersplat/assets';
import type { CameraView, SavedView } from '@/features/supersplat/protocol';

type Data = { assetId?: string; views?: SavedView[]; previewImageUrl?: string; gaussianProviderId?: string; gaussianGeneration?: GaussianGenerationTask };
export const GaussianNode = memo(({ id, data, width, height, selected }: NodeProps) => {
  const state = data as Data;
  const fileInput = useRef<HTMLInputElement>(null);
  const fieldClass = 'nodrag min-w-0 w-full appearance-none rounded-lg border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-field-bg)] py-2.5 pl-10 pr-8 text-sm text-text-dark outline-none focus:border-accent';
  const secondaryClass = 'nodrag flex min-w-0 items-center justify-center gap-2 rounded-lg border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-field-bg)] px-2 py-3 text-sm text-text-dark transition-colors hover:bg-[var(--canvas-node-menu-hover)] disabled:opacity-40';
  const nodes = useCanvasStore(s => s.nodes);
  const edges = useCanvasStore(s => s.edges);
  const providers = useCustomProvidersStore(s => s.providers).filter(p => p.apiStyle === 'comfyui' && customProviderMediaType(p) === 'gaussian');
  const inputs = edges.filter(e => e.target === id).map(e => nodes.find(n => n.id === e.source)).filter(n => n && ['uploadNode', 'exportImageNode', 'imageNode'].includes(n.type ?? ''));
  const source = inputs.length === 1 && typeof inputs[0]?.data.imageUrl === 'string' ? inputs[0].data.imageUrl : undefined;
  const providerId = state.gaussianProviderId ?? providers[0]?.id ?? '';
  const task = state.gaussianGeneration;
  const generating = !!task && ['submitting', 'running', 'saving'].includes(task.phase);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!generating || !task) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    recoverGaussian(id, task);
    return () => clearInterval(timer);
  }, [id, task?.id, generating]);
  const onNodesChange = useCanvasStore(s => s.onNodesChange);
  useEffect(() => {
    if ((width ?? 0) < 440 || (height ?? 0) < 680) {
      onNodesChange([{ id, type: 'dimensions', dimensions: { width: Math.max(440, width ?? 0), height: Math.max(680, height ?? 0) }, setAttributes: true }]);
    }
  }, [id, width, height, onNodesChange]);
  const update = useCanvasStore(s => s.updateNodeData);
  const addDerived = useCanvasStore(s => s.addDerivedExportNode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [assets, setAssets] = useState<GaussianAsset[]>([]);
  const [asset, setAsset] = useState<GaussianAsset>();
  const [session, setSession] = useState<string>();
  useEffect(() => { setSession(undefined); }, [state.assetId]);
  const reload = async () => setAssets(await gaussianAssets.list());
  useEffect(() => { void reload().catch(e => setError(String(e))); }, []);
  useEffect(() => { if (state.assetId) void gaussianAssets.get(state.assetId).then(value => { setAsset(value); void reload(); }).catch(e => setError(String(e))); else setAsset(undefined); }, [state.assetId]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const openChrome = async () => {
    if (!asset) return;
    if (!isTauri()) throw new Error('请在桌面 App 中使用 Chrome 编辑入口');
    const file = asset.document ?? asset.source;
    const contents = asset.folderPath && !asset.document ? '' : await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve((reader.result as string).split(',')[1]); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
    const token = await invoke<string>('supersplat_open', { name: asset.document ? 'scene.ssproj' : asset.sourceName ?? asset.name, contents, folderPath: asset.document ? null : asset.folderPath ?? null, views: state.views ?? [] });
    setSession(token);
  };
  useEffect(() => {
    if (!session || !asset) return;
    let polling = false;
    const timer = setInterval(async () => {
      if (polling) return; polling = true;
      try {
        const results = await invoke<Array<{ type: string; data: string | CameraView }>>('supersplat_results', { token: session });
        for (const result of results) {
          if (result.type === 'save' && typeof result.data === 'string') {
            const bytes = Uint8Array.from(atob(result.data), c => c.charCodeAt(0));
            const next = { ...asset, document: new Blob([bytes], { type: 'application/x-supersplat' }), updatedAt: Date.now() };
            await gaussianAssets.put(next); setAsset(next);
          } else if (result.type === 'capture' && typeof result.data === 'string') {
            const url = await persistImageSource('data:image/png;base64,' + result.data);
            update(id, { previewImageUrl: url });
            addDerived(id, url, '16:9', url, { defaultTitle: '3D 高斯视角', resultKind: 'generic', aspectRatioStrategy: 'provided', sizeStrategy: 'autoMinEdge' });
          } else if (result.type === 'view' && typeof result.data !== 'string') {
            const current = useCanvasStore.getState().nodes.find(n => n.id === id)?.data as Data | undefined;
            const views = current?.views ?? [];
            update(id, { views: [...views, { id: crypto.randomUUID(), name: `视角 ${views.length + 1}`, camera: result.data }] });
          }
        }
      } catch (e) { setError(String(e)); } finally { polling = false; }
    }, 1000);
    return () => clearInterval(timer);
  }, [session, asset, id, update, addDerived]);
  const importFolder = async () => {
    const path = await selectFolder({ directory: true, multiple: false, title: '选择完整 LCC2 文件夹' });
    if (typeof path !== 'string') return;
    const result = await invoke<{ folderPath: string; sourceName: string; name: string }>('supersplat_import_folder', { path });
    const item: GaussianAsset = { ...result, id: crypto.randomUUID(), source: new Blob(), updatedAt: Date.now() };
    await gaussianAssets.put(item); await reload(); setAsset(item); update(id, { assetId: item.id, views: [] });
  };
  const importFile = async (file: File) => {
    if (!/\.(ply|splat|sog|spz|ksplat|ssproj)$/i.test(file.name)) throw new Error('不支持的文件格式');
    const item: GaussianAsset = { id: crypto.randomUUID(), name: file.name, sourceName: file.name, source: file, updatedAt: Date.now() };
    await gaussianAssets.put(item); await reload(); setAsset(item); update(id, { assetId: item.id, views: [] });
  };
  return <div className={`relative flex h-full w-full min-w-0 flex-col gap-5 overflow-visible rounded-[var(--node-radius)] border bg-[var(--canvas-node-bg)] p-5 text-text-dark shadow-[var(--canvas-node-shadow)] ${selected ? 'border-accent' : 'border-[var(--canvas-node-border)]'}`}>
    <NodeConnectionHandle type="target" id="target" position={Position.Left} isValidConnection={connection => {
      const candidate = nodes.find(n => n.id === connection.source);
      return !!candidate && ['uploadNode', 'exportImageNode', 'imageNode'].includes(candidate.type ?? '') && !edges.some(e => e.target === id);
    }} />
    <header className="flex items-center gap-3">
      <Box className="h-12 w-12 shrink-0 text-accent" strokeWidth={1.7} aria-hidden="true" />
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold tracking-wide">3D 高斯</h2>
        <p className="mt-1 text-xs text-text-muted">图片生成 · 本地资产 · 观察与编辑</p>
      </div>
    </header>
    <div className="flex min-h-0 flex-1 flex-col gap-4 rounded-xl border border-[var(--canvas-node-field-border)] p-4">
      <section className="flex items-start gap-3" aria-label="图片生成 3DGS">
        <div className="flex h-28 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--canvas-node-field-border)] bg-[var(--canvas-node-field-bg)]">
          {source ? <img src={resolveImageDisplayUrl(source)} className="h-full w-full object-cover" alt="生成输入图片" draggable={false} /> : <ImageIcon className="h-7 w-7 text-text-muted" aria-hidden="true" />}
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="relative">
            <FileText className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-text-muted" aria-hidden="true" />
            <select aria-label="3DGS 工作流" disabled={generating} className={fieldClass} value={providerId} onChange={e => update(id, { gaussianProviderId: e.target.value })}>
              <option value="">选择 3DGS 工作流</option>{providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-3 h-4 w-4 text-text-muted" aria-hidden="true" />
          </div>
          <button disabled={generating || !source || !providerId} className="nodrag rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40" onClick={() => void generateGaussian(id, providerId, source)}>{generating ? '生成中…' : '生成 3DGS'}</button>
          {!source && <p className="text-xs leading-5 text-text-muted">{inputs.length > 1 ? '请只连接一张输入图片' : '请连接生成图片节点或素材上传节点'}</p>}
          {!providers.length && <p className="text-xs leading-5 text-text-muted">请在设置 → ComfyUI 中添加 3DGS 工作流</p>}
          <div role="status" aria-live="polite">
            {task?.phase === 'succeeded' && <p className="flex items-start gap-1.5 text-xs leading-5 text-emerald-500"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />3DGS 已就绪，可在 Chrome 中打开编辑</p>}
            {task?.phase === 'failed' && <p className="max-h-20 overflow-y-auto break-words text-xs text-red-400">{task.error}</p>}
          </div>
          {task?.phase === 'failed' && task.promptId && <button className="nodrag text-xs text-accent" onClick={() => void generateGaussian(id, task.providerId, undefined, task)}>{task.resultUrl ? '重新下载模型' : '继续查询任务'}</button>}
        </div>
      </section>
      <div className="border-t border-[var(--canvas-node-divider)]" />
      <section className="space-y-3" aria-label="本地高斯资产">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--canvas-node-field-bg)] text-accent"><Box size={30} strokeWidth={1.7} aria-label="3D 高斯模型" /></div>
          <div className="relative min-w-0 flex-1">
            <select aria-label="本地高斯资产" className={`${fieldClass} !pl-3`} value={state.assetId ?? ''} onChange={e => update(id, { assetId: e.target.value || undefined, views: [] })}><option value="">选择本地资产</option>{assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-3 h-4 w-4 text-text-muted" aria-hidden="true" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className={secondaryClass} disabled={busy} onClick={() => fileInput.current?.click()}><FileText className="h-5 w-5 shrink-0" aria-hidden="true" /><span>导入 3DGS</span></button>
          <button className={secondaryClass} disabled={busy} onClick={() => void run(importFolder)}><FolderOpen className="h-5 w-5 shrink-0" aria-hidden="true" /><span>导入 LCC2 文件夹</span></button>
        </div>
        <input ref={fileInput} type="file" hidden accept=".ply,.splat,.sog,.spz,.ksplat,.ssproj" onChange={e => { const file = e.target.files?.[0]; if (file) void run(() => importFile(file)); e.target.value = ''; }} />
        {state.assetId && !asset && <p className="text-xs text-amber-500">资产缺失，请重新导入</p>}
        {asset && <div className="flex items-center justify-center gap-3 py-1 text-sm">
          <button disabled={busy} className="nodrag flex items-center gap-1.5 rounded-md px-2 py-1.5 text-text-muted hover:bg-[var(--canvas-node-menu-hover)] hover:text-text-dark" onClick={() => void run(async () => { const name = window.prompt('资产名称', asset.name); if (name?.trim()) { const next = { ...asset, name: name.trim() }; await gaussianAssets.put(next); setAsset(next); await reload(); } })}><Pencil size={15} />重命名</button>
          <button disabled={busy} className="nodrag flex items-center gap-1.5 rounded-md px-2 py-1.5 text-red-400 hover:bg-[var(--canvas-node-menu-hover)]" onClick={() => void run(async () => { if (window.confirm('删除资产将影响所有引用它的项目，确定删除？')) { await gaussianAssets.remove(asset.id); update(id, { assetId: undefined, views: [] }); setAsset(undefined); await reload(); } })}><Trash2 size={15} />删除资产</button>
        </div>}
      </section>
      <div className="mt-auto space-y-3 pt-1">
        <button className="nodrag flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-base font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40" disabled={!asset || busy} onClick={() => void run(openChrome)}><Chrome size={22} />在 Chrome 中编辑<ExternalLink size={16} className="ml-1" /></button>
        {error && <p role="alert" className="max-h-16 overflow-y-auto break-words text-center text-xs text-red-400 [overflow-wrap:anywhere]">{error}</p>}
        {session && <p className="flex items-start justify-center gap-1.5 text-xs leading-5 text-emerald-500"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />Chrome 编辑会话已启动，保存和截图会回传此节点</p>}
      </div>
    </div>
    {generating && task && <>
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-[inherit]">
        <GenerationProgressOverlay startedAt={task.startedAt} />
      </div>
      <GenerationJobStatus
        state={task.phase === 'saving' ? 'materializing' : task.phase === 'submitting' ? 'submitting' : 'running'}
        phase={`${task.phase === 'saving' ? '正在保存模型' : task.phase === 'submitting' ? '正在提交任务' : '生成 3DGS'} · ${formatGenerationElapsedMs(Math.max(0, now - task.startedAt))}`}
      />
    </>}
  </div>;
});
GaussianNode.displayName = 'GaussianNode';
