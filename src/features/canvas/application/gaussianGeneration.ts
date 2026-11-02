import { invoke, isTauri } from '@tauri-apps/api/core';
import { useCanvasStore } from '@/stores/canvasStore';
import { useCustomProvidersStore, customProviderMediaType } from '@/stores/customProvidersStore';
import { gaussianAssets } from '@/features/supersplat/assets';
import { createComfyUITransport, comfyUIModelDownloadRequest } from '../infrastructure/customProviderGateway';
import { parseComfyUIConfig, submitComfyUIWorkflow, pollComfyUIWorkflow } from '../infrastructure/comfyuiGateway';
import { imageUrlToDataUrl } from './imageData';

export interface GaussianGenerationTask {
  id: string;
  providerId: string;
  promptId?: string;
  resultUrl?: string;
  startedAt: number;
  phase: 'submitting' | 'running' | 'saving' | 'succeeded' | 'failed';
  error?: string;
}
const active = new Set<string>();
export async function generateGaussian(nodeId: string, providerId: string, source?: string, resume?: GaussianGenerationTask) {
  if (active.has(nodeId)) return;
  active.add(nodeId);
  let task: GaussianGenerationTask = resume ? { ...resume, error: undefined } : {
    id: crypto.randomUUID(), providerId, startedAt: Date.now(), phase: 'submitting',
  };
  const current = () => useCanvasStore.getState().nodes.find(n => n.id === nodeId);
  const publish = () => { if (current()) useCanvasStore.getState().updateNodeData(nodeId, { gaussianGeneration: { ...task } }); };
  try {
    if (!isTauri()) throw new Error('请在桌面 App 中生成 3DGS');
    const provider = useCustomProvidersStore.getState().providers.find(p => p.id === providerId);
    if (!provider || provider.apiStyle !== 'comfyui' || customProviderMediaType(provider) !== 'gaussian') throw new Error('请选择有效的 3DGS ComfyUI 工作流');
    const config = parseComfyUIConfig(provider);
    const transport = createComfyUITransport(provider);
    publish();
    if (!task.promptId) {
      if (!source) throw new Error('请连接生成图片节点或素材上传节点');
      const image = await imageUrlToDataUrl(source);
      const result = await submitComfyUIWorkflow(config, {
        prompt: '', model: provider.models[0] ?? 'workflow', size: 'workflow', aspect_ratio: 'auto',
        reference_images: [image], extra_params: { seed: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) },
      }, transport);
      task.promptId = result.prompt_id;
    }
    task.phase = 'running'; publish();
    task.resultUrl ??= await pollComfyUIWorkflow(config, task.promptId, 'gaussian', transport);
    task.phase = 'saving'; publish();
    const encoded = await invoke<string>('supersplat_download_ply', comfyUIModelDownloadRequest(provider, task.resultUrl));
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    // A stable asset ID makes retry/recovery idempotent.
    const assetId = `generated-${task.id}`;
    if (!await gaussianAssets.get(assetId)) {
      await gaussianAssets.put({ id: assetId, name: `3DGS ${new Date(task.startedAt).toLocaleString()}`, sourceName: new URL(task.resultUrl).searchParams.get('filename') ?? 'generated.ply', source: new Blob([bytes]), updatedAt: Date.now() });
    }
    if (current()) useCanvasStore.getState().updateNodeData(nodeId, { assetId, views: [] });
    task.phase = 'succeeded'; publish();
  } catch (error) {
    task.phase = 'failed'; task.error = error instanceof Error ? error.message : String(error); publish();
  } finally { active.delete(nodeId); }
}

export function recoverGaussian(nodeId: string, task: GaussianGenerationTask) {
  if (active.has(nodeId)) return;
  if (task.promptId) { void generateGaussian(nodeId, task.providerId, undefined, task); return; }
  useCanvasStore.getState().updateNodeData(nodeId, { gaussianGeneration: {
    ...task, phase: 'failed', error: '提交过程已中断，尚未取得任务 ID。请先检查 ComfyUI 队列，再决定是否重新生成。',
  } });
}
