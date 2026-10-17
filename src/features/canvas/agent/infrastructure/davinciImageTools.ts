import { tool } from '@openai/agents';
import type { JsonObjectSchemaNonStrict } from '@openai/agents-core/types';
import { z } from 'zod';
import { callMcpTool, listMcpServers, type McpAgentTool } from '@/commands/mcpClient';
import { prepareExternalImageSource } from '@/commands/image';
import { imageUrlToDataUrl } from '@/features/canvas/application/imageData';
import { buildCanvasAssetCatalog } from '@/features/canvas/application/canvasAssetCatalog';
import { useCanvasStore } from '@/stores/canvasStore';
import { canvasAgentApprovalExecution, canvasAgentApprovalStore, createAgentToolRequestFingerprint, createApprovalId } from '../application/agentApproval';
import { redactSensitiveValue } from '../application/agentRedaction';
import type { CanvasAgentContext } from './sdkRuntime';

export const DAVINCI_APPEND_IMAGES_TOOL = 'mcp_davinci_append_images';

// Paths enter Python only as JSON data, never as generated Python expressions.
export function buildDavinciAppendImagesScript(paths: string[], durationSeconds: number, dryRun = false): string {
  return `import json
_canvas_paths = json.loads(${JSON.stringify(JSON.stringify(paths))})
result = {"canvas_append_images": True, "ok": False, "outcome": "failed", "stage": "resolve-project", "requested": len(_canvas_paths), "imported": 0, "appended": 0, "timelineWriteAttempted": False, "durationSeconds": ${durationSeconds}}
try:
    _canvas_project = resolve.GetProjectManager().GetCurrentProject()
    if not _canvas_project:
        raise RuntimeError("No current DaVinci project")
    result["stage"] = "resolve-timeline"
    _canvas_timeline = _canvas_project.GetCurrentTimeline()
    if not _canvas_timeline:
        raise RuntimeError("No current DaVinci timeline")
    result["timeline"] = _canvas_timeline.GetName()
    _canvas_timeline_id = _canvas_timeline.GetUniqueId()
    _canvas_pool = _canvas_project.GetMediaPool()
    if not _canvas_pool:
        raise RuntimeError("No media pool")
    _canvas_rate = str(_canvas_timeline.GetSetting("timelineFrameRate")).split()[0].split("/")
    _canvas_fps = float(_canvas_rate[0]) / (float(_canvas_rate[1]) if len(_canvas_rate) == 2 else 1)
    _canvas_duration = max(1, round(_canvas_fps * ${durationSeconds}))
    _canvas_record = _canvas_timeline.GetEndFrame()
    if ${dryRun ? 'True' : 'False'}:
        result.update({"ok": True, "stage": "preflight", "outcome": "succeeded", "dryRun": True})
    else:
        result["stage"] = "media-pool-import"
        _canvas_items = []
        for _canvas_path in _canvas_paths:
            _canvas_imported = _canvas_pool.ImportMedia([_canvas_path])
            if not _canvas_imported or len(_canvas_imported) != 1:
                raise RuntimeError("MediaPool.ImportMedia did not return one image; no timeline append attempted")
            _canvas_items.append(_canvas_imported[0])
            result["imported"] = len(_canvas_items)
        result["stage"] = "timeline-check"
        _canvas_current = _canvas_project.GetCurrentTimeline()
        if not _canvas_current or _canvas_current.GetUniqueId() != _canvas_timeline_id:
            raise RuntimeError("Current timeline changed; no timeline append attempted")
        _canvas_track = _canvas_timeline.GetTrackCount("video")
        if _canvas_track == 0:
            result["stage"] = "create-video-track"
            if not _canvas_timeline.AddTrack("video"):
                raise RuntimeError("Timeline.AddTrack failed")
            _canvas_track = 1
        result["trackIndex"] = _canvas_track
        _canvas_clips = []
        for _canvas_item in _canvas_items:
            _canvas_clips.append({"mediaPoolItem": _canvas_item, "startFrame": 0, "endFrame": _canvas_duration - 1, "mediaType": 1, "trackIndex": _canvas_track, "recordFrame": _canvas_record})
            _canvas_record += _canvas_duration
        result["stage"] = "timeline-append"
        result["timelineWriteAttempted"] = True
        result["appended"] = None
        _canvas_appended = _canvas_pool.AppendToTimeline(_canvas_clips) or []
        result["appended"] = len(_canvas_appended)
        result["ok"] = len(_canvas_appended) == len(_canvas_paths)
        result["outcome"] = "succeeded" if result["ok"] else "partial" if _canvas_appended else "failed"
        if not result["ok"]:
            result["error"] = {"type": "AppendCountMismatch", "message": "MediaPool.AppendToTimeline returned fewer items than requested"}
except Exception as _canvas_error:
    result["error"] = {"type": type(_canvas_error).__name__, "message": str(_canvas_error)}
    result["outcome"] = "unknown" if result["timelineWriteAttempted"] else "failed"
`;
}

function appendReport(output: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 16) return null;
  if (typeof output === 'string') {
    try { return appendReport(JSON.parse(output), depth + 1); } catch { return null; }
  }
  if (!output || typeof output !== 'object') return null;
  const value = output as Record<string, unknown>;
  if (value.canvas_append_images === true) return value;
  for (const child of Object.values(value)) {
    const report = appendReport(child, depth + 1);
    if (report) return report;
  }
  return null;
}

const reportSchema = z.object({
  canvas_append_images: z.literal(true), ok: z.boolean(), stage: z.string(), outcome: z.enum(['succeeded', 'failed', 'partial', 'unknown']),
  requested: z.number().int().min(0), imported: z.number().int().min(0), appended: z.number().int().min(0).nullable(),
  timeline: z.string().optional(), error: z.object({ type: z.string(), message: z.string() }).optional(),
}).passthrough();

function remoteErrorMessage(value: unknown, depth = 0): string | null {
  if (depth > 16) return null;
  if (typeof value === 'string') {
    try { return remoteErrorMessage(JSON.parse(value), depth + 1); } catch { return value.trim().split('\n').filter(Boolean).slice(-1)[0] ?? null; }
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const children = Array.isArray(value) ? value : ['error', 'content', 'text', 'result', 'message'].map((key) => record[key]);
  for (const child of children) { const message = remoteErrorMessage(child, depth + 1); if (message) return message; }
  return null;
}

export function decodeDavinciAppendResult(output: unknown, requested: number) {
  const report = reportSchema.safeParse(appendReport(output));
  const isError = Boolean(output && typeof output === 'object' && 'isError' in output && output.isError);
  if (report.success && !isError && report.data.requested === requested && (!report.data.ok || report.data.appended === requested)) return report.data;
  const message = remoteErrorMessage(output) ?? 'ResolveMCP did not return the expected structured image-import report';
  return { canvas_append_images: true as const, ok: false, stage: 'script-execution', outcome: 'unknown' as const, requested, imported: 0, appended: null, error: { type: message.match(/^([A-Za-z]+(?:Error|Exception)):/)?.[1] ?? 'InvalidMcpReport', message } };
}

export function createDavinciImageTool(definitions: McpAgentTool[], context: CanvasAgentContext) {
  const scripts = definitions.filter((item) => item.tool.name === 'run_script');
  if (!scripts.length) return null;
  return tool({
    name: DAVINCI_APPEND_IMAGES_TOOL,
    description: '仅将画布生成的成品图追加到 DaVinci 当前时间线末尾；自动排除导演台截图、来源图和参考素材。先用 asset.list 的 generatedOnly=true 查询真实 assetIds。宿主验证原图并保存独立 PNG，不需要提供文件路径。默认每图 5 秒，使用最上方视频轨道，不创建或切换时间线。仅支持本机官方 ResolveMCP 且已授权 run_script。',
    parameters: { type: 'object', properties: { serverId: { type: 'string' }, assetIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 32 }, durationSeconds: { type: 'number', minimum: 0.1, maximum: 600 } }, required: ['serverId', 'assetIds'], additionalProperties: false } as unknown as JsonObjectSchemaNonStrict<Record<string, Record<string, unknown>>>,
    strict: false,
    needsApproval: true,
    execute: async (raw, _runContext, details) => {
      const input = z.object({ serverId: z.string(), assetIds: z.array(z.string().min(1)).min(1).max(32), durationSeconds: z.number().min(0.1).max(600).optional() }).parse(raw);
      const callId = details?.toolCall?.callId;
      if (!callId) throw new Error('DaVinci 导入调用缺少 callId');
      const approvalId = createApprovalId(context.runId, DAVINCI_APPEND_IMAGES_TOOL, callId);
      const event = (status: 'executing' | 'succeeded' | 'failed' | 'unknown', output?: unknown) => context.onToolEvent?.({ toolName: DAVINCI_APPEND_IMAGES_TOOL, callId, status, input, output });
      event('executing');
      try {
        const execution = await canvasAgentApprovalExecution.executeOnce({
          approvalId, runId: context.runId, projectId: context.projectId, toolName: DAVINCI_APPEND_IMAGES_TOOL, callId,
          requestFingerprint: await createAgentToolRequestFingerprint(DAVINCI_APPEND_IMAGES_TOOL, input, details), activeProjectId: context.getActiveProjectId?.(),
          execute: async () => {
            let stage = 'connection-check';
            let rpcStarted = false;
            let currentAssetId: string | undefined;
            const skippedAssets: Array<{ assetId: string; reason: string }> = [];
            try {
            const definition = scripts.find((candidate) => candidate.serverId === input.serverId);
            const server = (await listMcpServers()).find((candidate) => candidate.config.id === input.serverId);
            if (!definition || !server?.connected || server.config.transport !== 'stdio' || !/(?:^|[/\\])ResolveMCP(?:\.exe)?$/i.test(server.config.command) || !server.config.allowedTools.includes('run_script')) {
              throw new Error('需要连接本机官方 ResolveMCP，并授权 run_script；不会向远程 MCP 发送本地文件。');
            }
            if (new Set(input.assetIds).size !== input.assetIds.length) throw new Error('资产 ID 重复，请勿重复导入。');
            stage = 'asset-selection';
            const catalog = buildCanvasAssetCatalog(useCanvasStore.getState().nodes);
            // Validate the entire selection before creating any local files.
            const assets = input.assetIds.map((id) => {
              currentAssetId = id;
              const asset = catalog.find((candidate) => candidate.id === id && candidate.kind === 'image');
              if (!asset) throw new Error(`画布图片不存在：${id}`);
              return asset;
            }).filter((asset) => {
              if (asset.purpose === 'generated-result') return true;
              skippedAssets.push({ assetId: asset.id, reason: '非生成成品图：已排除中间截图、来源图或参考素材' });
              return false;
            });
            if (!assets.length) throw new Error('所选素材中没有生成成品图；截图和参考图不会导入。');
            const paths: string[] = [];
            stage = 'file-preparation';
            for (const asset of assets) {
              currentAssetId = asset.id;
              const source = /^(?:blob:|asset:|tauri:|https?:\/\/(?:asset|tauri)\.localhost)/i.test(asset.url) ? await imageUrlToDataUrl(asset.url) : asset.url;
              const file = await prepareExternalImageSource(source);
              if (!/^(?:\/|[A-Za-z]:[\\/])/.test(file.path) || !file.bytes || !file.width || !file.height) throw new Error('图片未通过本机文件及尺寸预检；请使用桌面版。');
              paths.push(file.path);
            }
            currentAssetId = undefined;
            stage = 'project-check';
            if (context.getActiveProjectId && context.getActiveProjectId() !== context.projectId) throw new Error('当前画布项目已切换，未导入。');
            stage = 'mcp-call';
            rpcStarted = true;
            const output = await callMcpTool(definition.serverId, 'run_script', definition.revision, { script: buildDavinciAppendImagesScript(paths, input.durationSeconds ?? 5) });
            const report = decodeDavinciAppendResult(output, paths.length);
            return redactSensitiveValue({ ...report, assetIds: assets.map((asset) => asset.id), skippedAssets, instruction: report.ok ? '仅成品图已追加到返回名称的时间线；报告实际数量和已排除的素材。' : '按 stage 和 error 说明具体失败；imported 表示媒体池已导入数量。部分成功或结果未知时不要重复整批导入。' });
            } catch (error) {
              return redactSensitiveValue({ ok: false, outcome: rpcStarted ? 'unknown' as const : 'failed' as const, stage, assetId: currentAssetId, skippedAssets, requested: input.assetIds.length, imported: 0, appended: rpcStarted ? null : 0, error: { type: error instanceof Error ? error.name : 'HostError', message: String(error) }, instruction: rpcStarted ? '外部调用结果未知，先核查媒体池和时间线，禁止自动重放。' : '本次尚未调用达芬奇；按具体阶段修复后再发起导入，无需检查时间线是否重复。' });
            }
          },
          isSuccess: (output) => output.ok === true,
          isUnknownOutcome: (output) => output.outcome === 'unknown',
        });
        event(execution.output.ok === true ? 'succeeded' : execution.output.outcome === 'unknown' ? 'unknown' : 'failed', execution.output);
        return execution.output;
      } catch (error) {
        const unknown = canvasAgentApprovalStore.get(approvalId)?.status === 'unknown';
        const output = { ok: false, outcome: unknown ? 'unknown' : 'failed', error: redactSensitiveValue(String(error)), instruction: '先检查错误和达芬奇当前时间线；结果未知或部分成功时禁止自动重放整批导入。' };
        event(unknown ? 'unknown' : 'failed', output);
        return output;
      }
    },
  });
}
