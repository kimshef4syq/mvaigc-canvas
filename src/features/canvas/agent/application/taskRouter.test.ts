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

    // Sneaker commercial -> workflow ad-tvc
    const sneakerAd = routeUserTask({ text: '一支球鞋的广告' });
    expect(sneakerAd.kind).toBe('workflow');
    expect(sneakerAd.workflow).toBe('ad-tvc');
    expect(sneakerAd.requestedDeliverables).toEqual(['commercial-video']);

    // Electric SUV 30s TVC (Scenario 4) -> workflow ad-tvc
    const suvTvc = routeUserTask({ text: '为全新智能电动SUV制作一段30秒广告TVC' });
    expect(suvTvc.kind).toBe('workflow');
    expect(suvTvc.workflow).toBe('ad-tvc');
    expect(suvTvc.requestedDeliverables).toEqual(['commercial-video']);
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

describe('production intent and direct-shot boundary', () => {
  it.each([
    ['制作一首 MV', 'mv'], ['制作一个音乐视频', 'mv'], ['给这首歌做一个MV视频', 'mv'],
    ['制作一个MV，我有歌手图片', 'mv'], ['制作一首M V，我有歌曲和人物图片', 'mv'],
    ['做15秒歌词视频', 'mv'], ['做卡点视频', 'mv'],
    ['制作xxTVC广告', 'ad-tvc'], ['制作一支TVC广告，我有产品图片', 'ad-tvc'], ['做品牌大片视频', 'ad-tvc'], ['做品牌宣传视频', 'ad-tvc'],
    ['做产品发布视频', 'ad-tvc'], ['做App功能介绍视频', 'ad-tvc'], ['做软件演示视频', 'ad-tvc'],
    ['做UGC视频', 'koc-video'], ['做开箱视频', 'koc-video'], ['做产品测评视频', 'koc-video'], ['做口播视频', 'koc-video'],
    ['制作一个短剧视频', 'drama-series'], ['做一部微电影', 'drama-series'], ['做剧情动画', 'drama-series'],
    ['做数字人讲解视频', 'general-video'], ['做AI主播视频', 'general-video'], ['做照片说话视频', 'general-video'],
    ['做科普视频', 'general-video'], ['做教程视频', 'general-video'], ['做故事解说视频', 'general-video'],
    ['做旅行Vlog视频', 'general-video'], ['剪辑一部采访成片', 'general-video'],
    ['做动画短片', 'general-video'], ['做氛围片', 'general-video'], ['做活动预告片', 'general-video'],
    ['做人物介绍视频', 'general-video'], ['做作品集视频', 'general-video'],
    ['批量制作开箱视频', 'koc-video'], ['用产品图片制作一个宣传视频', 'general-video'],
    ['制作多段同一个人物的视频', 'general-video'],
    ['先出分镜确认后生成8秒视频', 'general-video'],
  ])('routes %s to %s before generating', (text, expected) => {
    expect(routeUserTask({ text })).toMatchObject({ kind: 'workflow', workflow: expected });
  });

  it.each(['用这张图生成8秒缓慢推镜视频', '做一个8秒推镜，角色回头后奔跑', '只做一个镜头：8秒TVC风格的产品旋转视频'])('keeps the specified independent shot direct: %s', (text) => {
    expect(routeUserTask({ text })).toMatchObject({ kind: 'direct', requestedDeliverables: ['video'] });
  });

  it.each(['TVC风格的一张海报', '批量生成十张互相独立的海报', '根据MV参考视频生成一张图片'])('keeps still-image deliverables direct: %s', (text) => {
    expect(routeUserTask({ text })).toMatchObject({ kind: 'direct' });
    expect(routeUserTask({ text }).requiredCapabilities).not.toContain('generation:video');
  });

  it('asks about a video with no subject, instead of submitting', () => {
    expect(routeUserTask({ text: '帮我生成视频' })).toMatchObject({ kind: 'clarify', missingFacts: [{ key: 'videoBrief' }] });
  });

  it('continues the same plan for a parameter answer and does not hijack an independent task', () => {
    const context = { activePlanId: 'plan-mv', activeWorkflow: 'mv' as const };
    expect(routeUserTask({ ...context, text: '16:9，30秒' })).toMatchObject({ kind: 'workflow', workflow: 'mv', activePlanId: 'plan-mv' });
    expect(routeUserTask({ ...context, text: '生成一张海报' })).toMatchObject({ kind: 'direct', requestedDeliverables: ['image'] });
  });

  it('does not treat a shot text edit as permission to regenerate', () => {
    const route = routeUserTask({ text: '修改第3个镜头的提示词' });
    expect(route.stageIntent).toBe('edit-shot');
    expect(route.requiredCapabilities).toEqual([]);
  });
});
