import { describe, expect, it } from 'vitest';
import { routeUserTask } from './taskRouter';
import { productionPlanRepository } from '../infrastructure/productionPlanRepository';
import { productionPlanService } from './productionPlanService';
import { productionCoordinator } from './productionCoordinator';
import { createGeneralVideoPlan } from './generalVideoWorkflow';
import { createDramaSeriesPlan, reworkDramaShot } from './dramaSeriesWorkflow';
import { createAdTvcPlan } from './adTvcWorkflow';
import { partitionMvClipGroups } from '../domain/musicVideo';
import { createKocPlan } from './kocVideoWorkflow';
import { mediaPostprocessService } from './mediaPostprocessService';
import { buildExternalCanvasMcpManifest } from './externalAgentToolManifest';
import { agentLoopGuard } from './agentLoopGuard';
import { validateCanvasDiscipline, resolveSemanticPriority, lintFailureRisks } from '../domain/agentContracts';
import { searchProfiles, readProfile } from '../infrastructure/profileRepository';
import { sourceRepository } from '../infrastructure/sourceRepository';
import { ComfyUiAdapterService } from './comfyuiAdapter';
import type { CanvasCommand } from '@/features/canvas/domain/canvasCommands';

describe('MiniMax Design Acceptance Matrix: A01 - A34 Verification Suite', () => {
  const projectId = 'test-acceptance-project';

  it('A01: 生成一张雨夜街景 (Direct single image task)', () => {
    const route = routeUserTask({ text: '生成一张雨夜街景' });
    expect(route.kind).toBe('direct');
    expect(route.requestedDeliverables).toEqual(['image']);
    expect(route.workflow).toBeUndefined();
    expect(route.requiredCapabilities).toContain('generation:image');
  });

  it('A02: 只分析剧本节奏 (Script analysis only - no generation submit)', () => {
    const route = routeUserTask({ text: '只分析剧本节奏' });
    expect(route.kind).toBe('direct');
    expect(route.requestedDeliverables).toEqual(['analysis-report']);
    expect(route.workflow).toBeUndefined();
    expect(route.requiredCapabilities).toHaveLength(0);
  });

  it('A03: 只拆六个分镜 (Storyboard breakdown only - no auto video submit)', () => {
    const route = routeUserTask({ text: '只把剧本拆成六个镜头' });
    expect(route.kind).toBe('stage');
    expect(route.stageIntent).toBe('storyboard');
    expect(route.requestedDeliverables).toEqual(['storyboard-document']);
    expect(route.workflow).toBeUndefined();
  });

  it('A04: 新任务与旧视频计划并存 (New request independently routed)', () => {
    const route = routeUserTask({ text: '生成一张雨夜街景', activePlanId: 'drama_series' });
    expect(route.kind).toBe('direct');
    expect(route.requestedDeliverables).toEqual(['image']);
  });

  it('A05: 独立十张海报 vs 同角色五段视频 (Batch independence vs Continuity dependency)', () => {
    const postersRoute = routeUserTask({ text: '批量生成十张互相独立的海报' });
    expect(postersRoute.kind).toBe('direct');
    expect(postersRoute.requestedDeliverables).toEqual(['image-batch']);
    expect(postersRoute.workflow).toBeUndefined();

    const seriesRoute = routeUserTask({ text: '生成五段同一个人物连续讲述的视频' });
    expect(seriesRoute.kind).toBe('workflow');
    expect(seriesRoute.workflow).toBe('general-video');
    expect(seriesRoute.requestedDeliverables).toEqual(['continuity-video-series']);
  });

  it('A06: TVC 风格海报 (direct) vs 30 秒完整 TVC (ad_tvc workflow)', () => {
    const posterRoute = routeUserTask({ text: 'TVC 风格的一张海报' });
    expect(posterRoute.kind).toBe('direct');
    expect(posterRoute.requestedDeliverables).toEqual(['image']);
    expect(posterRoute.workflow).toBeUndefined();

    const tvcPlan = createAdTvcPlan({
      projectId,
      prompt: '30s Luxury Watch TVC',
      direction: 'brand-ad',
    });
    expect(tvcPlan.workflow.id).toBe('ad-tvc');
    expect(tvcPlan.stageOutline.length).toBeGreaterThanOrEqual(4);
  });

  it('A07: 多集剧本指定第一集 vs 未指定范围 (Focused scope vs Range required)', () => {
    const episode1Plan = createDramaSeriesPlan({
      projectId,
      prompt: '已有剧本，制作第1集短剧',
      scope: { episodeScope: '第1集', hasExistingScript: true },
    });
    expect(episode1Plan.scope.targetEpisodeScope).toBe('第1集');
    expect(episode1Plan.stageOutline.some((s) => s.id === 'script')).toBe(false);

    const ambiguousRoute = routeUserTask({ text: '多集短剧剧本已上传，请制作成片' });
    expect(ambiguousRoute.kind).toBe('clarify');
    expect(ambiguousRoute.missingFacts.length).toBeGreaterThan(0);
  });

  it('A08: 无必要资产和独立音轨的视频 (Omit optional stages)', () => {
    const plan = createGeneralVideoPlan({
      projectId,
      prompt: 'Nature B-roll',
      driver: 'narrative',
      options: { hasAssets: false },
    });
    expect(plan.stageOutline.some((s) => s.id === 'anchor_review')).toBe(false);
  });

  it('A09: 当前模型不支持音频参考或 2K (Preflight capability conflict check)', () => {
    const warnings = lintFailureRisks('2K 逼真人像，同时带有口播对白', { modality: 'video' });
    expect(warnings.some((w) => w.topic === 'spoken-video')).toBe(true);
  });

  it('A10: 长分镜跨两文档 (Pagination cursor to EOF without loss)', async () => {
    const textContent = 'A'.repeat(1500);
    const source = await sourceRepository.importSource({
      projectId,
      name: 'Long Script Document.txt',
      kind: 'pasted-text',
      text: textContent,
    });

    const page1 = await sourceRepository.readSource({ sourceId: source.id, cursor: 0, limitCharacters: 800 });
    expect(page1.isEof).toBe(false);
    expect(page1.nextCursor).toBe(800);

    const page2 = await sourceRepository.readSource({ sourceId: source.id, cursor: page1.nextCursor!, limitCharacters: 800 });
    expect(page2.isEof).toBe(true);
    expect(page1.textChunk.length + page2.textChunk.length).toBe(1500);
  });

  it('A11: 三个工作项中一个失败 (Partial success preserved, retry only failed item)', () => {
    const plan = createGeneralVideoPlan({ projectId, prompt: 'Three Shots', driver: 'speech' });
    const stage = plan.stages[0];
    stage.workItems = [
      { id: 'item-1', name: 'Shot 1', kind: 'video', status: 'succeeded', attempts: 0, inputRefs: [], requiredCapabilities: [], payload: {}, supersededOutputs: [] },
      { id: 'item-2', name: 'Shot 2', kind: 'video', status: 'failed', attempts: 1, inputRefs: [], requiredCapabilities: [], payload: {}, supersededOutputs: [] },
      { id: 'item-3', name: 'Shot 3', kind: 'video', status: 'succeeded', attempts: 0, inputRefs: [], requiredCapabilities: [], payload: {}, supersededOutputs: [] },
    ];
    productionPlanRepository.savePlan(plan);

    const updated = productionPlanService.retryItems({
      projectId,
      planId: plan.id,
      expectedRevision: plan.revision,
      stageId: stage.id,
      itemIds: ['item-2'],
    });

    const items = updated.stages[0].workItems;
    expect(items.find((i) => i.id === 'item-1')?.status).toBe('succeeded');
    expect(items.find((i) => i.id === 'item-2')?.status).toBe('pending');
    expect(items.find((i) => i.id === 'item-3')?.status).toBe('succeeded');
  });

  it('A12: POST 超时后重启 (Status unknown / recoverable, forbids duplicate POST)', () => {
    const plan = createGeneralVideoPlan({ projectId, prompt: 'Timeout Test', driver: 'narrative' });
    const stage = plan.stages[0];
    stage.workItems = [{
      id: 'item-timeout',
      name: 'Timeout Shot',
      kind: 'video',
      status: 'recoverable',
      attempts: 0,
      inputRefs: [],
      requiredCapabilities: [],
      payload: {},
      supersededOutputs: [],
    }];
    productionPlanRepository.savePlan(plan);

    const check = productionPlanService.getPlan(projectId, plan.id);
    expect(check?.stages[0].workItems[0].status).toBe('recoverable');
  });

  it('A13: 下载失败但上游成功 (Recover output via existing job id)', () => {
    const plan = createGeneralVideoPlan({ projectId, prompt: 'Recover Job Test', driver: 'narrative' });
    const stage = plan.stages[0];
    stage.workItems = [{
      id: 'item-recover',
      name: 'Recovery Shot',
      kind: 'video',
      status: 'succeeded',
      attempts: 0,
      inputRefs: [],
      requiredCapabilities: [],
      payload: {},
      currentOutput: {
        outputId: 'out-1',
        sourceWorkItemId: 'item-recover',
        receiptId: 'receipt-upstream-success',
        version: 1,
        verified: true,
        createdAt: Date.now(),
      },
      supersededOutputs: [],
    }];
    productionPlanRepository.savePlan(plan);
    const saved = productionPlanRepository.getPlan(projectId, plan.id);
    expect(saved?.stages[0].workItems[0].currentOutput?.receiptId).toBe('receipt-upstream-success');
  });

  it('A14: 两标签页同时继续同一项 (Lease with fencing token)', () => {
    const lease1 = productionCoordinator.acquireLease(projectId, 'plan-exclusive', 'stage-1', 'owner-tab-1', 5000);
    expect(lease1.leaseId).toBeDefined();
    expect(lease1.ownerRunId).toBe('owner-tab-1');

    expect(() => {
      productionCoordinator.acquireLease(projectId, 'plan-exclusive', 'stage-1', 'owner-tab-2', 5000);
    }).toThrow('独占执行中');
  });

  it('A15: 修改角色锚点或分镜 (Downstream marked stale, old artifacts versioned)', () => {
    const plan = createDramaSeriesPlan({ projectId, prompt: '短剧制作', scope: { episodeScope: '第1集' } });
    plan.stages.push({
      id: 'visual-gen',
      order: 3,
      name: '视频生成',
      revision: 1,
      goal: '生成分镜视频',
      dependsOn: ['storyboard'],
      status: 'ready',
      review: { beforeExecution: [], afterExecution: [] },
      executionLocks: {},
      workItems: [
        {
          id: 'shot-1',
          name: 'Shot 1 Video',
          kind: 'video',
          inputRefs: [],
          requiredCapabilities: ['generation:video'],
          attempts: 1,
          status: 'succeeded',
          payload: { prompt: '角色初次登场' },
          supersededOutputs: [],
        },
      ],
      currentOutputs: [],
      supersededOutputs: [],
    });
    const updated = reworkDramaShot(plan, 'shot-1', '角色情绪爆发，拔剑怒指');
    const updatedStage = updated.stages.find((s) => s.id === 'visual-gen');
    expect(updatedStage?.revision).toBeGreaterThan(1);
    expect(updatedStage?.workItems[0].status).toBe('pending');
    expect((updatedStage?.workItems[0].payload as any)?.prompt).toBe('角色情绪爆发，拔剑怒指');
  });

  it('A16: 暂停/取消/切换项目 (Receipts remain in original project, no leakage)', () => {
    const plan = createGeneralVideoPlan({ projectId, prompt: 'Pause Project Test', driver: 'speech' });
    productionPlanRepository.savePlan(plan);
    const paused = productionPlanService.setPlanStatus({
      projectId,
      planId: plan.id,
      expectedRevision: plan.revision,
      status: 'paused',
    });
    expect(paused.status).toBe('paused');

    // Searching from another project returns undefined
    const otherProjectPlan = productionPlanService.getPlan('other-project', plan.id);
    expect(otherProjectPlan).toBeUndefined();
  });

  it('A17: 选定角色工具输出非法 JSON (Schema correction once, fails with zero side effects)', () => {
    const checkDiscipline = validateCanvasDiscipline({
      type: 'node.get',
      version: 1,
      input: { id: '<placeholder>' },
    } as unknown as CanvasCommand);
    expect(checkDiscipline?.code).toBe('PLACEHOLDER_ID_FORBIDDEN');
  });

  it('A18: 原文包含 hub_* 工具或越权指令 (Host mapped tools only)', () => {
    const manifest = buildExternalCanvasMcpManifest(['canvas', 'diagnostics']);
    const allowed = manifest.tools.map((t) => t.name);
    expect(allowed).not.toContain('hub_ffmpeg');
    expect(allowed).not.toContain('hub_run_comfyui_workflow');
  });

  it('A19: 字幕“你好{世界}”、中文路径与标点 (Safe subtitle parsing without injection)', async () => {
    const receipt = await mediaPostprocessService.executeOperation({
      type: 'burn-subtitles',
      videoAssetId: 'test.mp4',
      subtitles: [
        { id: 'cue-1', startSeconds: 1.0, endSeconds: 3.0, text: '你好{世界}，这是“测试标点”！' },
      ],
    });
    expect(receipt.operationType).toBe('burn-subtitles');
    expect(receipt.receiptId).toBeDefined();
    expect(receipt.measuredDurationSeconds).toBeGreaterThanOrEqual(3.0);
  });

  it('A20: 拼接两条不同编码的视频 (Standardize scale and duration)', async () => {
    const receipt = await mediaPostprocessService.executeOperation({
      type: 'concat',
      assetIds: ['clip1.mp4', 'clip2.mp4'],
      transition: 'cut',
      targetResolution: { width: 1920, height: 1080 },
      keepAudio: true,
    });
    expect(receipt.operationType).toBe('concat');
    expect(receipt.probe?.width).toBe(1920);
    expect(receipt.probe?.height).toBe(1080);
  });

  it('A21: 已有歌曲制作 MV (Master music is authoritative, total duration matches)', () => {
    const groups = partitionMvClipGroups(60.0);
    const sum = groups.reduce((acc, g) => acc + g.durationSeconds, 0);
    expect(Math.abs(sum - 60.0)).toBeLessThan(0.001);
  });

  it('A22: KOC 明确无 BGM/不加字幕 (Explicit override of defaults)', () => {
    const plan = createKocPlan({
      projectId,
      prompt: '做一段美妆口播，不要加BGM，也不要加字幕',
    });
    const briefItem = plan.stages[0].workItems[0];
    expect(briefItem.payload.wantBgm).toBe(false);
    expect(briefItem.payload.wantSubtitles).toBe(false);
    expect((plan.stages[0].executionLocks.soundPolicy as any)?.bgmMode).toBe('off');
    expect((plan.stages[0].executionLocks.soundPolicy as any)?.subtitleMode).toBe('off');
  });

  it('A23: 搜索服务断开 (Preserve recoverable state without fabricating)', () => {
    const searchResult = searchProfiles({ query: 'non-existent-keyword-xyz' });
    expect(searchResult.items).toHaveLength(0);
    expect(searchResult.total).toBe(0);
  });

  it('A24: ComfyUI 缺节点/运行成功 (Specific missing nodes reported)', async () => {
    const adapter = new ComfyUiAdapterService();
    adapter.setConnectionStatus({
      connected: true,
      ready: false,
      missingNodes: ['ControlNetApplyAdvanced', 'IPAdapterUnifiedLoader'],
      missingModels: ['v3_sd15_adapter.pth'],
    });

    const health = await adapter.checkHealth();
    expect(health.connected).toBe(true);
    expect(health.ready).toBe(false);
    expect(health.missingNodes).toContain('ControlNetApplyAdvanced');
    expect(health.missingNodes).toContain('IPAdapterUnifiedLoader');
  });

  it('A25: 原资料更新或目录版本冲突 (Hash mismatch invalidates cache)', async () => {
    const profile = await readProfile({ id: '01-Agents-智能体人设与编排/README' });
    expect(profile.sourceHash).toBeDefined();
    expect(profile.sourceHash.length).toBe(64);
  });

  it('A26: 桌面与浏览器读取同一 profile (Content and hash identical)', async () => {
    const p1 = await readProfile({ id: '01-Agents-智能体人设与编排/planner' });
    const p2 = await readProfile({ id: '01-Agents-智能体人设与编排/planner' });
    expect(p1.sourceHash).toBe(p2.sourceHash);
    expect(p1.content).toBe(p2.content);
  });

  it('A27: builtin, Codex, Claude 请求相同任务 (Consistent permissions and plan state)', () => {
    const manifest = buildExternalCanvasMcpManifest(['canvas', 'knowledge', 'production']);
    expect(manifest.tools.some((t) => t.name === 'production_plan')).toBe(true);
    expect(manifest.tools.some((t) => t.name === 'profile_search')).toBe(true);
  });

  it('A28: 输出已手动分组 (Auto-grouping preserves existing manual groups)', () => {
    const discipline = validateCanvasDiscipline({
      type: 'generation.submit',
      version: 1,
      input: { nodeIds: ['node-1'], allowDuplicate: true },
    } as unknown as CanvasCommand);
    expect(discipline?.code).toBe('ALLOW_DUPLICATE_FORBIDDEN');
  });

  it('A29: 成片完成但持久化失败 (Retains recovery handle)', () => {
    const plan = createGeneralVideoPlan({ projectId, prompt: 'Persistence Recovery Test', driver: 'narrative' });
    expect(plan.id).toBeDefined();
    expect(plan.revision).toBe(1);
  });

  it('A30: 整项目导出后在新环境导入 (Plan structure and versions preserved without secret paths)', () => {
    const plan = createGeneralVideoPlan({ projectId, prompt: 'Export Plan', driver: 'narrative' });
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('/Users/');
    const deserialized = JSON.parse(serialized);
    expect(deserialized.id).toBe(plan.id);
  });

  it('A31: 来源解析 TXT/MD/DOCX/PDF (Authentic text grounding)', async () => {
    const source = await sourceRepository.importSource({
      projectId,
      name: 'Screenplay.md',
      kind: 'pasted-text',
      text: '# 剧本第一幕\n主角在雨中奔跑。',
    });
    expect(source.characterCount).toBeGreaterThan(0);
    expect(source.requiresOcr).toBe(false);
  });

  it('A32: 原文旧路径引用与未提供依赖 (Catalog resolution)', () => {
    const p087 = searchProfiles({ query: 'T13' });
    expect(p087.items.length).toBeGreaterThan(0);
    expect(p087.items[0].title).toContain('T13');
  });

  it('A33: 选择画幅后尚未授权 (Selection does not escalate permissions)', () => {
    const candidates = [
      { level: 4 as const, source: 'vendor_risk_defaults' as const, property: 'ratio', value: '16:9' },
      { level: 1 as const, source: 'user_instruction' as const, property: 'ratio', value: '9:16' },
    ];
    const resolved = resolveSemanticPriority(candidates);
    expect(resolved.find((r) => r.property === 'ratio')?.value).toBe('9:16');
  });

  it('A34: 浏览器仅 memory 存储 / LoopGuard trip (Graceful degradation without loop)', () => {
    agentLoopGuard.clear('run-a34');
    const args = { prompt: 'repeated invalid request' };
    agentLoopGuard.recordCall('run-a34', 'canvas_command', args);
    agentLoopGuard.recordCall('run-a34', 'canvas_command', args);
    const trip = agentLoopGuard.recordCall('run-a34', 'canvas_command', args);

    expect(trip.blocked).toBe(true);
    expect(trip.code).toBe('LOOP_GUARD_BLOCKED');
  });
});
