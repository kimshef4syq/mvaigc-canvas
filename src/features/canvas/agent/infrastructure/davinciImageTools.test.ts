import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunContext } from '@openai/agents';
import { callMcpTool, listMcpServers, type McpServerView } from '@/commands/mcpClient';
import { prepareExternalImageSource, prepareExternalVideoSource } from '@/commands/image';
import { useCanvasStore } from '@/stores/canvasStore';
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import { canvasAgentApprovalStore, createAgentRequestFingerprint, createApprovalId, createApprovalRecord } from '../application/agentApproval';
import { buildDavinciAppendImagesScript, buildDavinciAppendVideosScript, createDavinciVideoTool, DAVINCI_APPEND_VIDEOS_TOOL, decodeDavinciAppendResult, createDavinciImageTool, DAVINCI_APPEND_IMAGES_TOOL } from './davinciImageTools';

vi.mock('@/commands/mcpClient', () => ({ callMcpTool: vi.fn(), listMcpServers: vi.fn() }));
vi.mock('@/commands/image', () => ({ prepareExternalImageSource: vi.fn(), prepareExternalVideoSource: vi.fn() }));

const definition = { agentName: 'mcp_resolve_script', serverId: 'davinci', revision: 'v1', tool: { name: 'run_script', inputSchema: { type: 'object' } } };
const server: McpServerView = { config: { id: 'davinci', label: 'Resolve', transport: 'stdio', command: '/Applications/DaVinci Resolve/ResolveMCP', args: [], url: '', allowedTools: ['run_script'] }, connected: true, tools: [] };

describe('canvas images to current DaVinci timeline', () => {
  beforeEach(() => {
    vi.mocked(prepareExternalVideoSource).mockReset().mockImplementation(async (source) => ({ path: source, bytes: 4096 }));
    vi.mocked(listMcpServers).mockReset().mockResolvedValue([server]);
    vi.mocked(prepareExternalImageSource).mockReset().mockImplementation(async (source) => ({ path: `/tmp/${source.endsWith('one.png') ? 'one' : 'two'}.png`, width: 100, height: 100, bytes: 1234 }));
    vi.mocked(callMcpTool).mockReset().mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ result: { canvas_append_images: true, ok: true, stage: 'timeline-append', outcome: 'succeeded', imported: 2, timeline: 'Existing timeline', requested: 2, appended: 2 } }) }] });
  });
  async function prepared(runId: string, assetIds = ['one:image', 'two:image'], videos = false) {
    const name = videos ? DAVINCI_APPEND_VIDEOS_TOOL : DAVINCI_APPEND_IMAGES_TOOL;
    const args = { serverId: 'davinci', assetIds };
    const adapter = (videos ? createDavinciVideoTool : createDavinciImageTool)([definition], { projectId: 'project', runId, getActiveProjectId: () => 'project' });
    if (!adapter) throw new Error('Missing adapter');
    const callId = 'append';
    const record = createApprovalRecord({ id: createApprovalId(runId, name, callId), runId, projectId: 'project', interruptionId: callId, toolName: name, arguments: args, requestFingerprint: await createAgentRequestFingerprint(name, args), baseRevision: 0, impact: { effect: 'external-submit', title: 'Append images', summary: 'Append to current timeline', affectedNodeCount: assetIds.length, affectedEdgeCount: 0, externalSideEffect: true } });
    canvasAgentApprovalStore.put(record);
    return { record, invoke: () => adapter.invoke(new RunContext(), JSON.stringify(args), { toolCall: { type: 'function_call', name: name, callId, arguments: JSON.stringify(args) } }) };
  }
  it('requires approval, passes original files internally, and never replays a completed append', async () => {
    const previous = useCanvasStore.getState().nodes;
    useCanvasStore.setState({ nodes: ['one', 'two'].map((id) => ({ id, type: CANVAS_NODE_TYPES.imageEdit, position: { x: 0, y: 0 }, data: { imageUrl: `https://media.example/${id}.png`, previewImageUrl: `https://media.example/${id}-preview.png`, aspectRatio: '16:9' } })) });
    try {
      const { record, invoke } = await prepared('image-append-success');
      await invoke();
      expect(prepareExternalImageSource).not.toHaveBeenCalled();
      expect(callMcpTool).not.toHaveBeenCalled();
      canvasAgentApprovalStore.update(record.id, { status: 'approved' });
      const result = await invoke();
      await invoke();
      expect(vi.mocked(prepareExternalImageSource).mock.calls.map(([source]) => source)).toEqual(['https://media.example/one.png', 'https://media.example/two.png']);
      expect(callMcpTool).toHaveBeenCalledTimes(1);
      expect(callMcpTool).toHaveBeenCalledWith('davinci', 'run_script', 'v1', { script: buildDavinciAppendImagesScript(['/tmp/one.png', '/tmp/two.png'], 5) });
      expect(result).toMatchObject({ ok: true, appended: 2, timeline: 'Existing timeline' });
      expect(JSON.stringify(result)).not.toContain('/tmp/');
    } finally { useCanvasStore.setState({ nodes: previous }); }
  });
  it('rejects remote servers and missing assets before writing any files or calling MCP', async () => {
    const remote = await prepared('image-append-remote');
    canvasAgentApprovalStore.update(remote.record.id, { status: 'approved' });
    vi.mocked(listMcpServers).mockResolvedValue([{ ...server, config: { ...server.config, transport: 'http' } }]);
    expect(await remote.invoke()).toMatchObject({ ok: false });
    vi.mocked(listMcpServers).mockResolvedValue([server]);
    const missing = await prepared('image-append-missing', ['missing:image']);
    canvasAgentApprovalStore.update(missing.record.id, { status: 'approved' });
    expect(await missing.invoke()).toMatchObject({ ok: false });
    expect(prepareExternalImageSource).not.toHaveBeenCalled();
    expect(callMcpTool).not.toHaveBeenCalled();
  });
  it('excludes missing intermediate screenshots and passes only the selected finished images', async () => {
    const previous = useCanvasStore.getState().nodes;
    useCanvasStore.setState({ nodes: [
      { id: 'screenshot', type: CANVAS_NODE_TYPES.exportImage, position: { x: 0, y: 0 }, data: { imageUrl: '/missing/screenshot.png', aspectRatio: '16:9', assetPurpose: 'intermediate', displayName: '导演台截图' } },
      { id: 'one', type: CANVAS_NODE_TYPES.exportImage, position: { x: 0, y: 0 }, data: { imageUrl: 'https://media.example/one.png', aspectRatio: '16:9', generatedFileName: 'final-one.png', sourcePrompt: 'Finished shot' } },
    ] });
    vi.mocked(callMcpTool).mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ result: { canvas_append_images: true, ok: true, stage: 'timeline-append', outcome: 'succeeded', requested: 1, imported: 1, appended: 1 } }) }] });
    try {
      const { record, invoke } = await prepared('final-only', ['screenshot:image', 'one:image']);
      canvasAgentApprovalStore.update(record.id, { status: 'approved' });
      expect(await invoke()).toMatchObject({ ok: true, appended: 1, assetIds: ['one:image'], skippedAssets: [{ assetId: 'screenshot:image' }] });
      expect(prepareExternalImageSource).toHaveBeenCalledExactlyOnceWith('https://media.example/one.png');
      expect(callMcpTool).toHaveBeenCalledExactlyOnceWith('davinci', 'run_script', 'v1', { script: buildDavinciAppendImagesScript(['/tmp/one.png'], 5) });
    } finally { useCanvasStore.setState({ nodes: previous }); }
  });
  it('classifies a missing original as a definite local failure and does not call DaVinci', async () => {
    const previous = useCanvasStore.getState().nodes;
    useCanvasStore.setState({ nodes: [{ id: 'one', type: CANVAS_NODE_TYPES.imageEdit, position: { x: 0, y: 0 }, data: { imageUrl: '/missing/final.png', aspectRatio: '16:9' } }] });
    vi.mocked(prepareExternalImageSource).mockRejectedValue(new Error('Failed to read local image source: No such file or directory (os error 2)'));
    try {
      const { record, invoke } = await prepared('missing-final-file', ['one:image']);
      canvasAgentApprovalStore.update(record.id, { status: 'approved' });
      expect(await invoke()).toMatchObject({ ok: false, outcome: 'failed', stage: 'file-preparation', assetId: 'one:image', appended: 0, error: { message: expect.stringContaining('No such file') } });
      expect(canvasAgentApprovalStore.get(record.id)?.status).toBe('failed');
      expect(callMcpTool).not.toHaveBeenCalled();
    } finally { useCanvasStore.setState({ nodes: previous }); }
  });
  it('imports five generated videos in selection order without using the image pipeline or replaying', async () => {
    const previous = useCanvasStore.getState().nodes;
    const ids = ['v1', 'v2', 'v3', 'v4', 'v5'];
    useCanvasStore.setState({ nodes: [
      ...ids.map((id) => ({ id, type: CANVAS_NODE_TYPES.video, position: { x: 0, y: 0 }, data: { localVideoUrl: `/tmp/${id}.mp4`, videoUrl: null, aspectRatio: '16:9', sourcePrompt: 'Generated shot' } })),
      { id: 'ref', type: CANVAS_NODE_TYPES.video, position: { x: 0, y: 0 }, data: { videoUrl: '/tmp/reference.mp4', aspectRatio: '16:9', assetPurpose: 'reference' } },
    ] });
    vi.mocked(callMcpTool).mockResolvedValue({ result: { canvas_append_videos: true, ok: true, outcome: 'succeeded', stage: 'timeline-append', requested: 5, imported: 5, appended: 5 } });
    try {
      const { record, invoke } = await prepared('five-videos', [...ids.map((id) => `${id}:video`), 'ref:video'], true);
      canvasAgentApprovalStore.update(record.id, { status: 'approved' });
      expect(await invoke()).toMatchObject({ ok: true, imported: 5, appended: 5, skippedAssets: [{ assetId: 'ref:video' }] });
      await invoke();
      expect(prepareExternalImageSource).not.toHaveBeenCalled();
      expect(vi.mocked(prepareExternalVideoSource).mock.calls.map(([source]) => source)).toEqual(ids.map((id) => `/tmp/${id}.mp4`));
      expect(callMcpTool).toHaveBeenCalledExactlyOnceWith('davinci', 'run_script', 'v1', { script: buildDavinciAppendVideosScript(ids.map((id) => `/tmp/${id}.mp4`)) });
    } finally { useCanvasStore.setState({ nodes: previous }); }
  });

  it('does not invoke Resolve when a selected video file cannot be prepared', async () => {
    const previous = useCanvasStore.getState().nodes;
    useCanvasStore.setState({ nodes: [{ id: 'missing', type: CANVAS_NODE_TYPES.video, position: { x: 0, y: 0 }, data: { videoUrl: '/missing.mp4', aspectRatio: '16:9', sourcePrompt: 'Generated shot' } }] });
    vi.mocked(prepareExternalVideoSource).mockRejectedValue(new Error('Video file missing'));
    try {
      const { record, invoke } = await prepared('missing-video', ['missing:video'], true);
      canvasAgentApprovalStore.update(record.id, { status: 'approved' });
      expect(await invoke()).toMatchObject({ ok: false, stage: 'file-preparation', appended: 0 });
      expect(callMcpTool).not.toHaveBeenCalled();
    } finally { useCanvasStore.setState({ nodes: previous }); }
  });

  it('retains structured API failures and raw Python error details instead of replacing them with a generic message', () => {
    const report = { canvas_append_images: true, ok: false, outcome: 'failed', stage: 'media-pool-import', requested: 1, imported: 0, appended: 0, error: { type: 'RuntimeError', message: 'MediaPool.ImportMedia returned no image' } };
    expect(decodeDavinciAppendResult({ content: [{ type: 'text', text: JSON.stringify({ result: report }) }] }, 1)).toMatchObject(report);
    expect(decodeDavinciAppendResult({ content: [{ type: 'text', text: JSON.stringify({ error: 'Traceback:\nTypeError: invalid ImportMedia argument' }) }] }, 1)).toMatchObject({ stage: 'script-execution', outcome: 'unknown', error: { type: 'TypeError', message: 'TypeError: invalid ImportMedia argument' } });
    expect(decodeDavinciAppendResult({ content: [] }, 1)).toMatchObject({ ok: false, outcome: 'unknown', appended: null });
  });
  it('does not retry partial or unknown results and never reports them as completed', async () => {
    const previous = useCanvasStore.getState().nodes;
    useCanvasStore.setState({ nodes: [{ id: 'one', type: CANVAS_NODE_TYPES.imageEdit, position: { x: 0, y: 0 }, data: { imageUrl: 'https://media.example/one.png', aspectRatio: '16:9' } }] });
    try {
      vi.mocked(callMcpTool).mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ result: { canvas_append_images: true, ok: false, stage: 'timeline-append', outcome: 'failed', imported: 1, requested: 1, appended: 0, timeline: 'Existing timeline' } }) }] });
      const partial = await prepared('image-append-partial', ['one:image']);
      canvasAgentApprovalStore.update(partial.record.id, { status: 'approved' });
      expect(await partial.invoke()).toMatchObject({ ok: false, appended: 0 });
      await partial.invoke();
      expect(callMcpTool).toHaveBeenCalledTimes(1);
      vi.mocked(callMcpTool).mockReset().mockRejectedValue(new Error('Disconnected after send'));
      const unknown = await prepared('image-append-unknown', ['one:image']);
      canvasAgentApprovalStore.update(unknown.record.id, { status: 'approved' });
      expect(await unknown.invoke()).toMatchObject({ ok: false, outcome: 'unknown' });
      expect(await unknown.invoke()).toMatchObject({ ok: false, outcome: 'unknown' });
      expect(callMcpTool).toHaveBeenCalledTimes(1);
    } finally { useCanvasStore.setState({ nodes: previous }); }
  });
  it('executes the generated Python with quoted paths and appends in order to the existing timeline end', () => {
    const paths = ['/tmp/引号"和\\字符.png', '/tmp/two.png'];
    const fixture = `import json, sys
paths = json.loads(sys.stdin.read())
class Timeline:
    def GetSetting(self, key): return "24000/1001"
    def GetEndFrame(self): return 1200
    def GetTrackCount(self, kind): return 2
    def GetUniqueId(self): return "timeline-original"
    def GetName(self): return "Existing timeline"
class Pool:
    def __init__(self): self.paths = []
    def ImportMedia(self, clips):
        self.paths.append(clips[0])
        return [len(self.paths)]
    def AppendToTimeline(self, clips):
        assert self.paths == paths
        assert [c["recordFrame"] for c in clips] == [1200, 1320]
        assert all(c["endFrame"] == 119 and c["trackIndex"] == 2 for c in clips)
        return clips
class Project:
    def __init__(self): self.pool = Pool(); self.timeline = Timeline()
    def GetCurrentTimeline(self): return self.timeline
    def GetMediaPool(self): return self.pool
class Manager:
    def GetCurrentProject(self): return project
class Resolve:
    def GetProjectManager(self): return Manager()
project = Project()
resolve = Resolve()
`;
    const script = fixture + buildDavinciAppendImagesScript(paths, 5) + '\nprint(json.dumps(result))';
    const output = execFileSync('python3', ['-c', script], { input: JSON.stringify(paths), encoding: 'utf8' });
    expect(JSON.parse(output)).toMatchObject({ ok: true, appended: 2, timeline: 'Existing timeline', trackIndex: 2 });
    const videoFixture = fixture + `
def append_videos(clips):
    assert clips == [1, 2], "Pass full media pool items, not fixed still-image frame ranges"
    assert project.pool.paths == paths
    return clips
project.pool.AppendToTimeline = append_videos
`;
    const videoOutput = execFileSync('python3', ['-c', videoFixture + buildDavinciAppendVideosScript(paths) + '\nprint(json.dumps(result))'], { input: JSON.stringify(paths), encoding: 'utf8' });
    expect(JSON.parse(videoOutput)).toMatchObject({ canvas_append_videos: true, ok: true, imported: 2, appended: 2 });
    const failed = execFileSync('python3', ['-c', fixture + '\nproject = None\n' + buildDavinciAppendImagesScript(paths, 5) + '\nprint(json.dumps(result))'], { input: JSON.stringify(paths), encoding: 'utf8' });
    expect(JSON.parse(failed)).toMatchObject({ ok: false, stage: 'resolve-project', outcome: 'failed', appended: 0, error: { type: 'RuntimeError' } });
    const dryRun = execFileSync('python3', ['-c', fixture + '\nproject.pool.ImportMedia = lambda clips: (_ for _ in ()).throw(RuntimeError("must not import"))\n' + buildDavinciAppendImagesScript(paths, 5, true) + '\nprint(json.dumps(result))'], { input: JSON.stringify(paths), encoding: 'utf8' });
    expect(JSON.parse(dryRun)).toMatchObject({ ok: true, stage: 'preflight', appended: 0, imported: 0 });
    const importFailure = execFileSync('python3', ['-c', fixture + '\nproject.pool.ImportMedia = lambda clips: []\n' + buildDavinciAppendImagesScript(paths, 5) + '\nprint(json.dumps(result))'], { input: JSON.stringify(paths), encoding: 'utf8' });
    expect(JSON.parse(importFailure)).toMatchObject({ ok: false, outcome: 'failed', stage: 'media-pool-import', appended: 0, imported: 0, error: { message: expect.stringContaining('ImportMedia') } });
    const appendFailure = execFileSync('python3', ['-c', fixture + '\nproject.pool.AppendToTimeline = lambda clips: (_ for _ in ()).throw(RuntimeError("append interrupted"))\n' + buildDavinciAppendImagesScript(paths, 5) + '\nprint(json.dumps(result))'], { input: JSON.stringify(paths), encoding: 'utf8' });
    expect(JSON.parse(appendFailure)).toMatchObject({ ok: false, outcome: 'unknown', stage: 'timeline-append', appended: null, imported: 2, error: { message: 'append interrupted' } });
  });
});
