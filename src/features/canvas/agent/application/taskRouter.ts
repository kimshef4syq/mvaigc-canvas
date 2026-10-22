import { taskRouteSchema, type TaskRouteV1, type TaskWorkflowKind } from '../domain/taskRoute';

export interface TaskRouterInput {
  text: string;
  activePlanId?: string;
  activeWorkflow?: TaskWorkflowKind;
  selectedNodeIds?: string[];
  attachments?: Array<{ id: string; name: string; kind: string }>;
}

/** Route the requested deliverable before inspecting references or choosing production defaults. */
export function routeUserTask(input: TaskRouterInput): TaskRouteV1 {
  const text = input.text.trim();
  const scope = { targetNodeIds: input.selectedNodeIds ?? [] };
  const evidence = [{ source: 'user' as const, referenceId: 'prompt', excerpt: text.slice(0, 1000) }];
  const result = (fields: Partial<TaskRouteV1>) => taskRouteSchema.parse({ version: 1, scope, evidence, ...fields });
  const clarify = (key: string, question: string, affects: string) => result({
    kind: 'clarify', requestedDeliverables: [], missingFacts: [{ key, question, affects }],
  });
  const workflow = (id: TaskWorkflowKind, deliverable: string, category: NonNullable<TaskRouteV1['productionCategory']>) => result({
    kind: 'workflow', workflow: id, productionCategory: category,
    requestedDeliverables: [deliverable],
    sourceIds: input.attachments?.map((item) => item.id) ?? [],
    requiredCapabilities: ['generation:video', 'generation:image', 'media:postprocess'],
  });

  if (/^(?:帮我)?(?:弄|改|做)?(?:得)?(?:更好|优化下|完善下)[！!。.\s]*$/i.test(text)) {
    return clarify('optimizationTarget', '请问您希望优化哪个内容？例如剧本、分镜或指定画面。', '处理范围与执行工具');
  }
  const continuation = /^(?:继续|确认|可以|好的?|行|执行|开始|默认|就这样|按这个|同意|批准|yes|ok|okay|continue)[！!。.\s]*$/i.test(text)
    || (text.length <= 200 && !/(?:帮我|制作|做一个|生成视频|生成图片|分析|解释)/i.test(text)
      && /(?:\d+\s*[:比]\s*\d+|\d+\s*秒|已上传|上传了|我来上传|我有音乐|用上传|选择|第[一二三四五六七八九十\d]+[项个]|原创|中文|英文|2D|3D|真人|你来构思|你来生成)/i.test(text));
  if (input.activePlanId && input.activeWorkflow && continuation) {
    return result({ kind: 'workflow', workflow: input.activeWorkflow, activePlanId: input.activePlanId, requestedDeliverables: ['continue-production'] });
  }

  const requestsProduction = /(?:做成片|制作成片|完整制作|全流程|制作.*(?:视频|短片|广告|MV)|生成视频)/i.test(text);
  if (/(?:只(?:是|需)?分析|仅分析|分析一下|分析这个|分析剧本|分析分镜|解释|讲讲|评估|review)/i.test(text) && !requestsProduction) {
    return result({ kind: 'direct', requestedDeliverables: ['analysis-report'], requiredCapabilities: [] });
  }
  if (/(?:只把剧本拆|只做分镜|只拆分镜|拆成[0-9一二三四五六七八九十]+个镜头|写分镜脚本)/i.test(text)) {
    return result({ kind: 'stage', stageIntent: 'storyboard', requestedDeliverables: ['storyboard-document'] });
  }
  if (!requestsProduction && !/(?:然后|再|确认后).*(?:生成|制作|成片)/.test(text)
      && /(?:写|编写|创作|做).{0,20}(?:剧本|脚本|大纲)[。！!？?\s]*$/.test(text)) {
    return result({ kind: 'stage', stageIntent: 'script', requestedDeliverables: ['script-document'] });
  }
  const rework = text.match(/(?:重做|重新生成|修改)第\s*([0-9一二三四五六七八九十]+)\s*个?(?:镜头|分镜)/i);
  if (rework) {
    const regenerate = /(?:重做|重新生成)/.test(rework[0]);
    return result({ kind: 'stage', stageIntent: regenerate ? 'rework-shot' : 'edit-shot',
      activePlanId: input.activePlanId, workflow: input.activeWorkflow,
      requestedDeliverables: [`shot-${rework[1]}`], scope: { ...scope, itemIds: [`shot-${rework[1]}`] },
      requiredCapabilities: regenerate ? ['generation:video'] : [],
    });
  }

  const video = /(?:视频|短片|成片|影片|宣传片|预告片|纪录片|微电影|短剧|动画片|\bvideo\b|\bfilm\b|\bM\s*V\b|TVC|UGC|Vlog)/i.test(text);
  const image = /(?:海报|主视觉|\bKV\b|生图|图片|一张图|画一张|生成.*张|poster|image)/i.test(text);
  // A named single shot with duration/motion is executable even if its style mentions a genre.
  const duration = /(?:\d+(?:\.\d+)?\s*(?:秒|s\b|seconds?\b)|\b\d+-second\b)/i.test(text);
  const motion = /(?:推镜|拉镜|运镜|镜头|回头|奔跑|走动|转身|旋转|摇镜|平移|缓慢推|camera|pan\b|zoom|tracking|motion)/i.test(text);
  const singleShot = /(?:只|仅)(?:要|做|生成|制作)?.{0,8}(?:单镜头|单个镜头|一个镜头|一条片段|视频片段)|(?:独立|单条|单镜头|单个镜头).{0,6}(?:视频|片段)|image.to.video|图生视频/i.test(text);
  const continuity = /(?:五段同一个人物|人物连续讲述|连续性|(?:多[个段条]|[两三四五六七八九十\d]+[个段条]).*(?:视频|镜头|片段)|同[一个]+(?:人物|角色|产品|场景).*(?:视频|镜头|片段))/i.test(text);
  const assembly = /(?:全流程|完整(?:成片|视频)|做成片|分阶段|先.*(?:方案|脚本|分镜)|确认.*(?:生成|制作)|配音.*(?:音乐|字幕)|旁白.*画面|多素材|音画合成)/i.test(text);
  const categorySignals = /(?:\bM\s*V\b|音乐视频|给.*歌.*配.*画面|歌词视频|音乐可视化|卡点视频|音乐卡点|TVC|广告|品牌片|品牌大片|商业宣传片|产品发布|功能介绍|软件演示|App|SaaS|KOC|UGC|种草|带货|测评|开箱|产品试用|短剧|微电影|故事短片|剧情动画|数字人|AI主播|AI.*讲者|虚拟.*(?:讲者|主播)|照片.*说话|科普|教程|解说|企业讲解|纪录|采访|Vlog|旅行|概念片|氛围片|实验短片|动画短片|视觉展示片|活动预告|人物介绍|企业宣传|作品集|预告片|混剪)/i.test(text);

  // Explicit still-image deliverables must not be hijacked by style/source words such as “TVC”.
  const namedProduction = /(?:制作|生成|做).{0,10}(?:M\s*V|TVC|广告|品牌大片|品牌宣传|短剧|微电影|KOC|UGC|数字人)(?!\s*(?:风格|样式|海报|图片|主视觉|参考图|照片|头像))/i.test(text);
  const explicitVideoDelivery = namedProduction || /(?:制作|生成|做|剪辑).{0,30}(?:视频|成片|短片|影片|广告片)/i.test(text);
  if (image && !explicitVideoDelivery && !assembly && !/(?:视频流程|完整TVC)/i.test(text)) {
    return result({ kind: 'direct', requestedDeliverables: [/(?:批量|生成\s*(?:[2-9]\d*|1\d+|[二两三四五六七八九十]+)\s*张)/.test(text) ? 'image-batch' : 'image'], requiredCapabilities: ['generation:image'] });
  }
  if (/(?:拼起来|拼接|合并两个视频|合并视频|剪辑合成|裁切|裁剪|转码|静音)/i.test(text)
      && !assembly && !categorySignals) {
    return result({ kind: 'direct', requestedDeliverables: ['merged-video'], requiredCapabilities: ['media:postprocess'] });
  }
  if (!continuity && !assembly && duration && motion && (singleShot || !categorySignals)) {
    return result({ kind: 'direct', requestedDeliverables: ['video'], requiredCapabilities: ['generation:video'] });
  }

  if (/(?:\bM\s*V\b|音乐视频|歌词视频|音乐可视化|卡点视频|音乐卡点|给.*歌.*配.*画面|这首歌.*(?:视频|画面)|music video|lyric video|music visualizer)/i.test(text)) {
    return workflow('mv', 'music-video', 'music-video');
  }
  if (/(?:短剧|微电影|故事短片|剧情动画|故事改编|剧本|drama|short film)/i.test(text)) {
    const episode = text.match(/第\s*([0-9一二三四五六七八九十]+)\s*集/i);
    if (/(?:多集|\d+\s*集|全集)/.test(text) && !episode && !/(?:制作|做|生成).{0,8}全集/.test(text)) {
      return result({ kind: 'clarify', workflow: 'drama-series', requestedDeliverables: [], missingFacts: [{
        key: 'episodeScope', question: '本次制作哪一集、哪些集或全部剧集？', affects: '制作范围与消耗预算',
      }] });
    }
    const cn: Record<string, string> = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10' };
    return { ...workflow('drama-series', 'drama-episode-video', 'drama'), scope: { ...scope,
      ...(episode ? { episodeScope: `第${cn[episode[1]] ?? episode[1]}集` } : {}),
    } };
  }
  if (/(?:数字人|AI\s*主播|虚拟(?:人|讲者|主播)|AI.*讲者|照片.*(?:说话|开口)|avatar|presenter)/i.test(text)) {
    return workflow('general-video', 'presenter-video', 'presenter');
  }
  if (/(?:KOC|UGC|种草|带货|测评|开箱|产品试用|体验分享|口播)/i.test(text)) {
    return workflow('koc-video', 'koc-video', 'ugc');
  }
  if (/(?:产品发布|功能介绍|软件演示|(?:App|SaaS|软件|应用).*(?:宣传|推广|演示|发布)|product launch|software demo)/i.test(text)) {
    return workflow('ad-tvc', 'product-launch-video', 'product-launch');
  }
  if (/(?:TVC|广告|品牌片|品牌大片|商业宣传片|品牌宣传|commercial)/i.test(text)) {
    return workflow('ad-tvc', 'commercial-video', 'commercial');
  }
  if (/(?:科普|教程|解说|教学视频|企业讲解|explainer|tutorial)/i.test(text)) {
    return workflow('general-video', 'explainer-video', 'explainer');
  }
  if (/(?:纪录|采访|Vlog|旅行|生活记录|多素材剪辑|documentary|interview)/i.test(text)) {
    return workflow('general-video', 'documentary-video', 'documentary');
  }
  if (/(?:活动预告|人物介绍|企业宣传|作品集|预告片|混剪|trailer|portfolio)/i.test(text)) {
    return workflow('general-video', 'promotional-video', 'promotion');
  }
  if (continuity || assembly || /(?:概念片|氛围片|实验短片|动画短片|动画视频|视觉展示片|艺术短片|创意短片|montage)/i.test(text)) {
    return workflow('general-video', continuity ? 'continuity-video-series' : 'creative-video', 'creative');
  }
  if (video) {
    if (/^(?:帮我)?(?:做|制作|生成|生|录制)(?:一个|一段|一条|个)?视频[吧！!。?？\s]*$/i.test(text)) {
      return clarify('videoBrief', '这段视频要表现什么？您要制作完整作品，还是内容和时长已明确的单镜头？', '制作范围、素材与执行方式');
    }
    return workflow('general-video', 'general-video', 'creative');
  }
  return result({ kind: 'direct', requestedDeliverables: ['image'], requiredCapabilities: ['generation:image'] });
}
