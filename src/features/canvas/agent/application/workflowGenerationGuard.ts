import type { TaskRouteV1 } from '../domain/taskRoute';
import type { ProductionPlanV1, ProductionStageV1 } from '../domain/productionPlan';
import { assertStageCanStart, stageReviewsAccepted, STAGED_CONFIRMATION_POLICY } from '../domain/workflowConfirmation';
import { productionPlanRepository } from '../infrastructure/productionPlanRepository';

export function assertWorkflowReviewReady(plan: ProductionPlanV1, stage: ProductionStageV1, reviewId: string, availableRefs?: ReadonlySet<string>): void {
  if (plan.workflow.confirmationPolicy !== STAGED_CONFIRMATION_POLICY) return;
  if (reviewId.endsWith(':beforeExecution')) {
    const videos = stage.workItems.filter((item) => item.kind === 'video');
    if (videos.length && (!stage.executionLocks.modelRef || !stage.executionLocks.aspectRatio || !stage.executionLocks.resolution
        || videos.some((item) => typeof item.payload.prompt !== 'string' || !item.payload.prompt.trim()
          || !(typeof item.payload.durationSeconds === 'number' && item.payload.durationSeconds > 0)
          || typeof item.payload.nodeId !== 'string' || (availableRefs && !availableRefs.has(item.payload.nodeId))))) {
      throw new Error('请先编写完整视频提示词、具体时长、模型/画幅/分辨率，并绑定真实生成节点，再请求生成授权。');
    }
  }
  const first = plan.stageOutline.reduce((a, b) => a.order < b.order ? a : b);
  if (stage.id !== first.id || !reviewId.endsWith(':afterExecution')) return;
  if (!stage.workItems.some((item) => item.kind === 'document'
      && ((typeof item.payload.text === 'string' && item.payload.text.trim())
        || (typeof item.payload.documentNodeId === 'string' && (!availableRefs || availableRefs.has(item.payload.documentNodeId)))))) {
    throw new Error('请先呈现实际的制作方向或脚本文档，再请求用户确认。');
  }
  const intake = stage.workItems.map((item) => item.payload.intake)
    .find((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value));
  if (!intake || !['user', 'agent'].includes(String(intake.contentSource))
      || !['upload', 'existing', 'original'].includes(String(intake.referenceSource))
      || !(typeof intake.durationSeconds === 'number' && intake.durationSeconds > 0)
      || !/^\d+:\d+$/.test(String(intake.aspectRatio))) {
    throw new Error('请先询问并补齐内容来源、参考素材来源、具体时长和画幅，在首阶段工作项 payload.intake 登记后再提交用户确认。');
  }
  if (intake.referenceSource !== 'original' && !stage.workItems.some((item) => item.inputRefs.length > 0)) {
    throw new Error('用户选择使用参考素材，请等待真实素材到达并登记 inputRefs，不能用占位内容继续。');
  }
  if (availableRefs && stage.workItems.some((item) => item.inputRefs.some((id) => !availableRefs.has(id)))) {
    throw new Error('参考素材尚未实际导入当前项目，请等待真实文件并登记有效的节点或素材引用。');
  }
  if (plan.workflow.id === 'mv') {
    if (!['upload', 'existing', 'generate'].includes(String(intake.musicSource))) {
      throw new Error('请先询问用户上传歌曲、使用已有歌曲还是授权作曲。');
    }
    if (intake.musicSource !== 'generate' && !(typeof intake.musicSourceId === 'string' && intake.musicSourceId.trim())) {
      throw new Error('请等待真实歌曲到达并登记 payload.intake.musicSourceId。');
    }
    if (availableRefs && intake.musicSource !== 'generate' && !availableRefs.has(String(intake.musicSourceId))) {
      throw new Error('指定歌曲尚未实际导入当前项目，请等待真实歌曲文件。');
    }
  }
}

/** Check both the route and node bindings; a canvas write approval is not creative approval. */
export function assertWorkflowGenerationAllowed(input: {
  projectId: string;
  route?: TaskRouteV1;
  planId?: string;
  nodeIds: string[];
  nodes: ReadonlyArray<{ id: string; type: string; data?: unknown }>;
  edges?: ReadonlyArray<{ source: string; target: string }>;
  references?: ReadonlyArray<{ id: string; nodeId: string }>;
}): void {
  if (input.route?.kind === 'clarify') throw new Error('请先等待用户回答当前资料或制作范围问题。');
  const videoRequested = input.nodeIds.some((id) => input.nodes.some((node) => node.id === id && node.type === 'aiVideoNode'));
  if (videoRequested && input.route && input.route.kind !== 'workflow'
      && !input.route.requiredCapabilities.includes('generation:video')) {
    throw new Error('当前请求未授权视频生成，不能将图片、分析或分镜文字修改转为视频生成。');
  }
  const plans = productionPlanRepository.listPlans(input.projectId);
  const boundPlans = plans.filter((plan) => plan.stages.some((stage) => stage.workItems.some((item) =>
    input.nodeIds.some((id) => item.payload.nodeId === id || (Array.isArray(item.payload.nodeIds) && item.payload.nodeIds.includes(id))))));
  const routeNeedsWorkflow = input.route?.kind === 'workflow' || (input.route?.kind === 'stage' && !!input.route.workflow);
  const requestedPlanId = input.planId ?? input.route?.activePlanId;
  const plan = requestedPlanId ? plans.find((candidate) => candidate.id === requestedPlanId)
    : boundPlans[0] ?? (routeNeedsWorkflow ? plans.find((candidate) => candidate.workflow.id === input.route?.workflow && candidate.status === 'active') : undefined);
  if (!plan && !routeNeedsWorkflow) return;
  if (!plan) throw new Error('本任务需要分阶段制作。请先收集素材并建立制作计划，不能直接提交生成。');
  if (plan.workflow.confirmationPolicy !== STAGED_CONFIRMATION_POLICY) {
    throw new Error('旧制作计划缺少阶段确认，请先建立带 staged-v1 确认规则的计划。');
  }
  if (!['active', 'waiting-user'].includes(plan.status)) throw new Error('制作计划当前不可执行，请先恢复当前计划。');
  const first = plan.stageOutline.reduce((a, b) => a.order < b.order ? a : b);
  const intakeStage = plan.stages.find((stage) => stage.id === first.id);
  if (!intakeStage || !stageReviewsAccepted(intakeStage, 'afterExecution')) {
    throw new Error('请先完成素材收集并由用户确认制作方案，再开始媒体生成。');
  }
  for (const nodeId of input.nodeIds) {
    const stage = plan.stages.find((candidate) => candidate.workItems.some((item) => item.payload.nodeId === nodeId
      || (Array.isArray(item.payload.nodeIds) && item.payload.nodeIds.includes(nodeId))));
    if (!stage) throw new Error('生成节点尚未绑定当前阶段 workItems[].payload.nodeId，不能绕过制作计划提交。');
    if (!['ready', 'running', 'failed', 'recoverable'].includes(stage.status)) throw new Error(`“${stage.name}”尚不可执行，请先确认当前阶段。`);
    assertStageCanStart(plan, stage);
    const node = input.nodes.find((candidate) => candidate.id === nodeId);
    if (node?.type === 'aiVideoNode') {
      const item = stage.workItems.find((item) => item.kind === 'video'
        && (item.payload.nodeId === nodeId || (Array.isArray(item.payload.nodeIds) && item.payload.nodeIds.includes(nodeId))));
      if (!item) throw new Error('视频节点必须绑定已确认的视频工作项。');
      const data = node.data as { prompt?: string; modelConfig?: { entryId?: string; duration?: string; resolution?: string; aspectRatio?: string } } | undefined;
      if (data?.prompt !== item.payload.prompt || data?.modelConfig?.entryId !== stage.executionLocks.modelRef
          || Number(data?.modelConfig?.duration) !== item.payload.durationSeconds
          || data?.modelConfig?.aspectRatio !== stage.executionLocks.aspectRatio
          || data?.modelConfig?.resolution !== stage.executionLocks.resolution) {
        throw new Error('画布视频节点的提示词或生成参数与已确认计划不一致，请同步计划并重新确认。');
      }
      if (input.edges) {
        const approved = item.inputRefs.map((ref) => input.nodes.find((node) => node.id === ref)?.id
          ?? input.references?.find((asset) => asset.id === ref)?.nodeId);
        const connected = input.edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source);
        if (approved.length !== connected.length || approved.some((ref, index) => !ref || ref !== connected[index])) {
          throw new Error('视频实际连接的参考素材与已确认计划不一致，请同步引用后重新确认。');
        }
      }
    }
  }
}
