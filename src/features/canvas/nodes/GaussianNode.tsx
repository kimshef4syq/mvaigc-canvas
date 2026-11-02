import { open as selectFolder } from '@tauri-apps/plugin-dialog';
import { Box } from 'lucide-react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { memo, useEffect, useState } from 'react';
import { Position, type NodeProps } from '@xyflow/react';
import { NodeConnectionHandle } from '@/features/canvas/ui/NodeConnectionHandle';
import { useCustomProvidersStore, customProviderMediaType } from '@/stores/customProvidersStore';
import { resolveImageDisplayUrl } from '../application/imageData';
import { generateGaussian, recoverGaussian, type GaussianGenerationTask } from '../application/gaussianGeneration';
import { useCanvasStore } from '@/stores/canvasStore';
import { persistImageSource } from '@/commands/image';
import { gaussianAssets, type GaussianAsset } from '@/features/supersplat/assets';
import type { CameraView, SavedView } from '@/features/supersplat/protocol';

type Data = { assetId?: string; views?: SavedView[]; previewImageUrl?: string; gaussianProviderId?: string; gaussianGeneration?: GaussianGenerationTask };
export const GaussianNode = memo(({ id, data, width, height }: NodeProps) => {
  const state = data as Data;
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
  return <div className="relative flex h-full w-full min-w-0 overflow-visible flex-col items-center justify-center gap-3 rounded-xl border border-neutral-500 bg-neutral-900 px-6 py-5 text-white">
    <NodeConnectionHandle type="target" id="target" position={Position.Left} isValidConnection={connection => {
      const candidate = nodes.find(n => n.id === connection.source);
      return !!candidate && ['uploadNode', 'exportImageNode', 'imageNode'].includes(candidate.type ?? '') && !edges.some(e => e.target === id);
    }} />
    <div className="text-lg font-medium">3D 高斯</div>
    <div className="w-full space-y-2 rounded border border-neutral-700 p-2 text-sm">
      {source ? <img src={resolveImageDisplayUrl(source)} className="h-16 w-full object-contain" alt="生成输入图片" /> : <p className="text-neutral-400">{inputs.length > 1 ? '请只连接一张输入图片' : '请连接生成图片节点或素材上传节点'}</p>}
      <select aria-label="3DGS 工作流" disabled={generating} className="nodrag w-full rounded bg-neutral-800 p-2" value={providerId} onChange={e => update(id, { gaussianProviderId: e.target.value })}>
        <option value="">选择 3DGS 工作流</option>{providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      {!providers.length && <p className="text-neutral-400">请在设置 → ComfyUI 中添加输出类型为 3DGS 的工作流</p>}
      <button disabled={generating || !source || !providerId} className="nodrag rounded bg-blue-600 px-3 py-1 disabled:opacity-40" onClick={() => void generateGaussian(id, providerId, source)}>{generating ? '生成中…' : '生成 3DGS'}</button>
      <div role="status" aria-live="polite">
        {generating && <p>{task?.phase === 'saving' ? '正在保存模型…' : task?.phase === 'submitting' ? '正在提交任务…' : '排队 / 生成中…'} {Math.max(0, Math.floor((now - (task?.startedAt ?? now)) / 1000))} 秒</p>}
        {task?.phase === 'succeeded' && <p className="text-green-300">3DGS 已就绪，可在 Chrome 中打开编辑</p>}
        {task?.phase === 'failed' && <p className="max-h-20 overflow-y-auto break-words text-red-300">{task.error}</p>}
      </div>
      {task?.phase === 'failed' && task.promptId && <button className="nodrag text-blue-300" onClick={() => void generateGaussian(id, task.providerId, undefined, task)}>{task.resultUrl ? '重新下载模型' : '继续查询任务'}</button>}
    </div>
    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400"><Box size={32} strokeWidth={1.5} aria-label="3D 高斯模型" /></div>
    <select className="nodrag w-full min-w-0 max-w-full truncate rounded bg-neutral-800 p-2" value={state.assetId ?? ''} onChange={e => { update(id, { assetId: e.target.value || undefined, views: [] }); }}><option value="">选择本地资产</option>{assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
    <label className="nodrag cursor-pointer rounded bg-neutral-700 px-3 py-1">导入 3DGS<input type="file" hidden accept=".ply,.splat,.sog,.spz,.ksplat,.ssproj" onChange={e => { const file = e.target.files?.[0]; if (file) void run(() => importFile(file)); e.target.value = ''; }} /></label>
    <button className="nodrag rounded bg-neutral-700 px-3 py-1" disabled={busy} onClick={() => void run(importFolder)}>导入 LCC2 文件夹</button>
    {state.assetId && !asset && <span className="text-amber-300">资产缺失，请重新导入</span>}
    {asset && <div className="flex gap-3 text-sm"><button className="nodrag" onClick={() => void run(async () => { const name = window.prompt('资产名称', asset.name); if (name?.trim()) { const next = { ...asset, name: name.trim() }; await gaussianAssets.put(next); setAsset(next); await reload(); } })}>重命名</button><button className="nodrag text-red-300" onClick={() => void run(async () => { if (window.confirm('删除资产将影响所有引用它的项目，确定删除？')) { await gaussianAssets.remove(asset.id); update(id, { assetId: undefined, views: [] }); setAsset(undefined); await reload(); } })}>删除资产</button></div>}
    <button className="nodrag rounded bg-blue-600 px-4 py-2" disabled={!asset || busy} onClick={() => void run(openChrome)}>在 Chrome 中编辑</button>
    {error && <p className="w-full min-w-0 break-words max-h-16 overflow-y-auto text-center text-sm text-red-300 [overflow-wrap:anywhere]">{error}</p>}
    {session && <p className="w-full min-w-0 break-words text-center text-sm leading-5 text-green-300">Chrome 编辑会话已启动，保存和截图会回传此节点</p>}
  </div>;
});
GaussianNode.displayName = 'GaussianNode';
