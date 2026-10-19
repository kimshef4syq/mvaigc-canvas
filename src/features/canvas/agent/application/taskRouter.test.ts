import { describe, expect, it } from 'vitest';

import { routeUserTask } from './taskRouter';

describe('Task Router Application Service (T03)', () => {
  it('A01: routes single image creation directly without full workflow orchestration', () => {
    const route = routeUserTask({ text: '生成一张雨夜街景' });
    expect(route.kind).toBe('direct');
    expect(route.requestedDeliverables).toEqual(['image']);
    expect(route.workflow).toBeUndefined();
    expect(route.requiredCapabilities).toContain('generation:image');
  });

  it('A02: routes pure text script analysis directly without media generation capabilities', () => {
    const route = routeUserTask({ text: '只分析剧本节奏' });
    expect(route.kind).toBe('direct');
    expect(route.requestedDeliverables).toEqual(['analysis-report']);
    expect(route.workflow).toBeUndefined();
    expect(route.requiredCapabilities).toHaveLength(0);
  });

  it('A03: routes storyboard splitting as a single stage task without generating media', () => {
    const route = routeUserTask({ text: '只把剧本拆成六个镜头' });
    expect(route.kind).toBe('stage');
    expect(route.stageIntent).toBe('storyboard');
    expect(route.requestedDeliverables).toEqual(['storyboard-document']);
    expect(route.workflow).toBeUndefined();
  });

  it('A05: distinguishes batch independent posters from continuity video series', () => {
    // Independent posters -> direct batch
    const postersRoute = routeUserTask({ text: '批量生成十张互相独立的海报' });
    expect(postersRoute.kind).toBe('direct');
    expect(postersRoute.requestedDeliverables).toEqual(['image-batch']);
    expect(postersRoute.workflow).toBeUndefined();

    // Continuity video series -> full workflow
    const seriesRoute = routeUserTask({ text: '生成五段同一个人物连续讲述的视频' });
    expect(seriesRoute.kind).toBe('workflow');
    expect(seriesRoute.workflow).toBe('general-video');
    expect(seriesRoute.requestedDeliverables).toEqual(['continuity-video-series']);
  });

  it('A06: routes TVC style poster as direct image and full 30s ad as ad-tvc workflow', () => {
    // TVC style poster -> direct image
    const tvcPoster = routeUserTask({ text: 'TVC 风格的一张海报' });
    expect(tvcPoster.kind).toBe('direct');
    expect(tvcPoster.requestedDeliverables).toEqual(['image']);
    expect(tvcPoster.workflow).toBeUndefined();

    // 30s TVC ad campaign -> workflow ad-tvc
    const tvcCampaign = routeUserTask({ text: '做一支 30 秒产品品牌片' });
    expect(tvcCampaign.kind).toBe('workflow');
    expect(tvcCampaign.workflow).toBe('ad-tvc');
    expect(tvcCampaign.requestedDeliverables).toEqual(['commercial-video']);
  });

  it('A07: routes specified drama episode to workflow and clarifies missing episode scope', () => {
    // Specified episode -> workflow with episodeScope
    const ep1Route = routeUserTask({ text: '短剧剧本已上传，请制作第一集成片' });
    expect(ep1Route.kind).toBe('workflow');
    expect(ep1Route.workflow).toBe('drama-series');
    expect(ep1Route.scope.episodeScope).toBe('第1集');

    // Unspecified multi-episode drama -> clarify
    const multiEpRoute = routeUserTask({ text: '这是 50 集多集剧本，帮我做成片' });
    expect(multiEpRoute.kind).toBe('clarify');
    expect(multiEpRoute.missingFacts).toHaveLength(1);
    expect(multiEpRoute.missingFacts[0].key).toBe('episodeScope');
  });

  it('A20: routes deterministic video stitching directly to postprocess capability', () => {
    const stitchRoute = routeUserTask({ text: '把已有两个视频拼起来' });
    expect(stitchRoute.kind).toBe('direct');
    expect(stitchRoute.requestedDeliverables).toEqual(['merged-video']);
    expect(stitchRoute.requiredCapabilities).toEqual(['media:postprocess']);
  });

  it('routes shot-level rework to stage with targeted item scope', () => {
    const rework = routeUserTask({ text: '只重做第 3 个镜头' });
    expect(rework.kind).toBe('stage');
    expect(rework.stageIntent).toBe('rework-shot');
    expect(rework.scope.itemIds).toEqual(['shot-3']);
  });

  it('asks for clarification when request has no specific object or direction', () => {
    const ambiguous = routeUserTask({ text: '帮我弄得更好' });
    expect(ambiguous.kind).toBe('clarify');
    expect(ambiguous.missingFacts.length).toBeGreaterThan(0);
  });
});
