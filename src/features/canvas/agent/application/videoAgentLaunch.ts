import { invoke } from '@tauri-apps/api/core';
import { createExternalAgentConnection, inspectExternalAgentConnection, launchVideoAgent, revokeExternalAgentConnection, type ExternalAgentRuntime } from '@/commands/externalAgent';
import { useProjectStore } from '@/stores/projectStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { buildCanvasAssetCatalog } from '@/features/canvas/application/canvasAssetCatalog';
import { saveVideoSourceToPath } from '@/commands/image';
import { buildExternalCanvasMcpManifest } from './externalAgentToolManifest';
import { setExternalAgentConnection } from '../ui/useExternalAgentApprovals';

let launching = false;
export type VideoAgentLaunchPhase = 'checking' | 'connecting' | 'reference' | 'preparing';

export async function openVideoAgent(options: {
  nodeId?: string;
  runtime: ExternalAgentRuntime;
  fullProduction?: boolean;
  upgradeEnvironment?: boolean;
  onPhase?: (phase: VideoAgentLaunchPhase) => void;
}) {
  if (launching) throw new Error('另一个智能体正在准备，请稍候');
  launching = true;
  try {
    options.onPhase?.('checking');
    const { currentProjectId, currentProject } = useProjectStore.getState();
    if (!currentProjectId || !currentProject || currentProject.id !== currentProjectId) throw new Error('请先打开一个画布工程');
    const node = options.nodeId ? useCanvasStore.getState().nodes.find(node => node.id === options.nodeId) : undefined;
    if (options.nodeId && (!node || node.data.isGenerating)) throw new Error('视频尚未就绪，请等待生成完成');
    // Snapshot the selected history version before the first await.
    const asset = options.nodeId ? buildCanvasAssetCatalog(useCanvasStore.getState().nodes)
      .find(asset => asset.nodeId === options.nodeId && asset.kind === 'video') : undefined;
    if (options.nodeId && !asset) throw new Error('这个节点没有可用视频，请重新上传或切换到已生成的视频');
    const ensureCurrent = () => {
      if (useProjectStore.getState().currentProjectId !== currentProjectId) throw new Error('准备期间画布已切换，请从当前画布重新打开');
    };
    const settings = useSettingsStore.getState();
    if (!settings.mvaigcAccount || !settings.mvaigcPassword) throw new Error('请先在设置中登录 mvaigc；只需配置一次');
    await invoke('mvaigc_set_credentials', {
      account: settings.mvaigcAccount,
      password: settings.mvaigcPassword,
      port: settings.mvaigcPort,
      tenantId: settings.mvaigcTenantId ?? null,
      tenantName: settings.mvaigcTenantName ?? null,
    });
    ensureCurrent();
    options.onPhase?.('connecting');
    let connection = await inspectExternalAgentConnection();
    const requiredTools = ['canvas_command', 'asset_read', 'diagnostics', 'assets_import'];
    if (connection.project?.id !== currentProjectId || !['ready', 'connected'].includes(connection.status)
      || !connection.expiresAt || connection.expiresAt <= Date.now() || requiredTools.some(name => !connection.scope.includes(name))) {
      ensureCurrent();
      connection = await createExternalAgentConnection({
        projectId: currentProjectId, projectName: currentProject.name,
        permissionMode: connection.project?.id === currentProjectId ? connection.permissionMode : 'collaboration', writeClaudeConfig: false,
        tools: buildExternalCanvasMcpManifest(['canvas', 'asset-read', 'diagnostics', 'media-import']).tools
          .map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, requiresApproval: true })),
      });
    }
    setExternalAgentConnection(connection);
    ensureCurrent();
    if (!connection.connectionId || !connection.hypitProjectDir) throw new Error('无法准备画布工程连接');
    options.onPhase?.('reference');
    let referencePath: string | undefined;
    if (asset) {
      // Source URL participates in the filename, so switching a node's history
      // never overwrites the reference of a terminal that is already running.
      const bytes = new TextEncoder().encode(asset.url);
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('').slice(0, 20);
      const ext = asset.url.split('?')[0].match(/\.(mp4|mov|webm|m4v|mkv)$/i)?.[1]?.toLowerCase() ?? 'mp4';
      referencePath = await saveVideoSourceToPath(asset.url, `${connection.hypitProjectDir}/imports/${encodeURIComponent(asset.id)}-${hash}.${ext}`, true);
    }
    ensureCurrent();
    options.onPhase?.('preparing');
    const connectionId = connection.connectionId;
    const unsubscribe = useProjectStore.subscribe(state => {
      if (state.currentProjectId !== currentProjectId) {
        // Revocation also cancels the backend's final pre-launch check and its
        // short-lived service grant, including while npm is preparing.
        void revokeExternalAgentConnection(connectionId).catch(() => undefined);
      }
    });
    try {
      const result = await launchVideoAgent({ connectionId, projectId: currentProjectId,
        runtime: options.runtime, nodeId: options.nodeId, assetId: asset?.id, referencePath,
        fullProduction: options.fullProduction, upgradeEnvironment: options.upgradeEnvironment });
      ensureCurrent();
      return result;
    } finally { unsubscribe(); }
  } finally { launching = false; }
}
