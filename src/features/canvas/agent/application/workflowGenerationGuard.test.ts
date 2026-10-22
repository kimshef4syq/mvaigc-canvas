import { beforeEach, describe, expect, it } from 'vitest';
import { createGeneralVideoPlan } from './generalVideoWorkflow';
import { createMusicVideoPlan } from './musicVideoWorkflow';
import { productionPlanRepository } from '../infrastructure/productionPlanRepository';
import { productionPlanService } from './productionPlanService';
import { assertWorkflowGenerationAllowed, assertWorkflowReviewReady } from './workflowGenerationGuard';
import { routeUserTask } from './taskRouter';
import type { ProductionPlanV1, ProductionStageV1 } from '../domain/productionPlan';

const projectId = 'workflow-confirmation-project';
const route = routeUserTask({ text: '做一个动画短片' });
const nodes = [{ id: 'video-1', type: 'aiVideoNode', data: { prompt: '人物回头后奔跑', modelConfig: { entryId: 'h3', duration: '8', aspectRatio: '16:9', resolution: '2K' } } }];
function intakePlan(): ProductionPlanV1 {
  const plan = createGeneralVideoPlan({ projectId, prompt: '做一个动画短片' });
  plan.stages[0].workItems[0].payload = { text: '已呈现的创意方向和制作方案', intake: {
    contentSource: 'agent', referenceSource: 'original', durationSeconds: 30, aspectRatio: '16:9',
  } };
  plan.stages[0].workItems[0].status = 'succeeded';
  plan.stages[0].status = 'succeeded';
  return productionPlanRepository.savePlan(plan);
}
function accept(plan: ProductionPlanV1, stage: ProductionStageV1, phase: 'beforeExecution' | 'afterExecution') {
  return productionPlanService.recordReview({ projectId, planId: plan.id, expectedRevision: plan.revision,
    stageId: stage.id, reviewId: stage.review[phase][0].id, status: 'passed', userConfirmed: true });
}
function videoStage(plan: ProductionPlanV1): ProductionStageV1 {
  const outline = plan.stageOutline.find((item) => item.id === 'visual-gen')!;
  return { ...outline, goal: '生成已确认的镜头', revision: 1, dependsOn: ['intent-brief'], status: 'ready',
    review: { beforeExecution: [], afterExecution: [] }, executionLocks: { modelRef: 'h3', aspectRatio: '16:9', resolution: '2K' },
    workItems: [{ id: 'shot-1', name: '镜头1', kind: 'video', status: 'pending', attempts: 0,
      inputRefs: [], requiredCapabilities: ['generation:video'], supersededOutputs: [],
      payload: { nodeId: 'video-1', prompt: '人物回头后奔跑', durationSeconds: 8 } }],
    currentOutputs: [], supersededOutputs: [],
  };
}

describe('staged creative confirmation at the generation boundary', () => {
  beforeEach(() => productionPlanRepository.clearAll());
  it('refuses to generate a workflow without a plan, and refuses unfinished intake', () => {
    expect(() => assertWorkflowGenerationAllowed({ projectId, route, nodes, nodeIds: ['video-1'] })).toThrow('收集素材');
    const plan = intakePlan();
    expect(plan.stages[0].status).toBe('waiting-user');
    expect(() => assertWorkflowGenerationAllowed({ projectId, route, planId: plan.id, nodes, nodeIds: ['video-1'] })).toThrow('确认制作方案');
    expect(() => productionPlanService.authorStage({ projectId, planId: plan.id, expectedRevision: plan.revision, stage: videoStage(plan) })).toThrow('先完成');
  });

  it('requires actual user review, then permits only approved bound video work', () => {
    let plan = intakePlan();
    assertWorkflowReviewReady(plan, plan.stages[0], plan.stages[0].review.afterExecution[0].id);
    expect(() => productionPlanService.recordReview({ projectId, planId: plan.id, expectedRevision: plan.revision,
      stageId: plan.stages[0].id, reviewId: plan.stages[0].review.afterExecution[0].id, status: 'passed' })).toThrow('不能代替用户');
    plan = accept(plan, plan.stages[0], 'afterExecution');
    expect(plan.stages[0].status).toBe('succeeded');
    plan = productionPlanService.authorStage({ projectId, planId: plan.id, expectedRevision: plan.revision, stage: videoStage(plan) });
    const generate = () => assertWorkflowGenerationAllowed({ projectId, route, planId: plan.id, nodes, nodeIds: ['video-1'] });
    expect(generate).toThrow('生成前确认');
    let stage = plan.stages[1];
    assertWorkflowReviewReady(plan, stage, stage.review.beforeExecution[0].id, new Set(['video-1']));
    plan = accept(plan, stage, 'beforeExecution');
    expect(generate).not.toThrow();
    expect(() => assertWorkflowGenerationAllowed({ projectId, route, planId: plan.id,
      nodeIds: ['video-1'], nodes: [{ ...nodes[0], data: { ...nodes[0].data, prompt: '未经确认的新提示词' } }],
    })).toThrow('与已确认计划不一致');
    expect(() => assertWorkflowGenerationAllowed({ projectId, route, planId: plan.id,
      nodeIds: ['video-1'], nodes, edges: [{ source: 'unapproved-reference', target: 'video-1' }],
    })).toThrow('参考素材与已确认计划不一致');
    expect(() => assertWorkflowGenerationAllowed({ projectId, route, planId: plan.id, nodes, nodeIds: ['unbound-video'] })).toThrow('尚未绑定');

    stage = structuredClone(plan.stages[1]);
    stage.workItems[0].payload.prompt = '修改后的新镜头，必须重审';
    stage.review.beforeExecution[0].confirmedByUser = true;
    stage.review.beforeExecution[0].status = 'passed';
    plan = productionPlanService.authorStage({ projectId, planId: plan.id, expectedRevision: plan.revision, stage });
    expect(generate).toThrow('生成前确认');
  });

  it('does not permit deleting or forging confirmation gates', () => {
    let plan = intakePlan();
    const stage = structuredClone(plan.stages[0]);
    stage.review.afterExecution = [];
    stage.status = 'succeeded';
    plan = productionPlanService.authorStage({ projectId, planId: plan.id, expectedRevision: plan.revision, stage });
    expect(plan.stages[0].review.afterExecution[0]).toMatchObject({ status: 'pending', confirmedByUser: false });
    expect(plan.stages[0].status).toBe('waiting-user');
  });

  it('waits for an actual uploaded song and refuses missing specs or placeholder sources', () => {
    const plan = createMusicVideoPlan({ projectId, prompt: '制作MV' });
    const stage = plan.stages[0];
    const review = stage.review.afterExecution[0].id;
    expect(() => assertWorkflowReviewReady(plan, stage, review)).toThrow('实际的制作方向');
    stage.workItems[0].payload.text = '已呈现的MV方向';
    stage.workItems[0].payload.intake = { contentSource: 'agent', referenceSource: 'original', durationSeconds: 30, aspectRatio: '16:9', musicSource: 'upload' };
    expect(() => assertWorkflowReviewReady(plan, stage, review)).toThrow('真实歌曲');
    (stage.workItems[0].payload.intake as Record<string, unknown>).musicSourceId = 'invented-song';
    expect(() => assertWorkflowReviewReady(plan, stage, review, new Set())).toThrow('尚未实际导入');
    expect(() => assertWorkflowReviewReady(plan, stage, review, new Set(['invented-song']))).not.toThrow();
  });

  it('blocks clarified or text-only requests from submitting video', () => {
    for (const text of ['帮我生成视频', '只分析剧本节奏', '修改第3个镜头的提示词']) {
      expect(() => assertWorkflowGenerationAllowed({ projectId, route: routeUserTask({ text }), nodes, nodeIds: ['video-1'] })).toThrow();
    }
    expect(() => assertWorkflowGenerationAllowed({ projectId, route: routeUserTask({ text: '用这张图生成8秒缓慢推镜视频' }), nodes, nodeIds: ['video-1'] })).not.toThrow();
  });
});
