import {
  taskRouteSchema,
  type TaskRouteV1,
} from '../domain/taskRoute';

export interface TaskRouterInput {
  text: string;
  activePlanId?: string;
  selectedNodeIds?: string[];
  attachments?: Array<{ id: string; name: string; kind: string }>;
}

export function routeUserTask(input: TaskRouterInput): TaskRouteV1 {
  const text = input.text.trim();
  const targetNodeIds = input.selectedNodeIds ?? [];

  // 1. Extreme ambiguity check: "帮我弄得更好" without any object or direction
  if (/^(?:帮我)?(?:弄|改|做)?(?:得)?(?:更好|优化下|完善下)[！!。.\s]*$/i.test(text)) {
    return taskRouteSchema.parse({
      version: 1,
      kind: 'clarify',
      requestedDeliverables: [],
      scope: { targetNodeIds },
      missingFacts: [
        {
          key: 'optimizationTarget',
          question: '请问您希望优化哪个具体内容？（例如：分析剧本节奏、修改指定镜头提示词、或调整画面风格）',
          affects: '处理范围与执行工具',
        },
      ],
      evidence: [{ source: 'user', referenceId: 'prompt', excerpt: text }],
    });
  }

  // 2. Explicit Analysis / Direct Text tasks (never triggers generation.submit)
  const isPureAnalysis =
    /(?:只(?:是|需)?分析|仅分析|分析一下|分析这个|分析剧本|分析分镜|解释|讲讲|评估|review)/i.test(text) &&
    !/(?:做成片|制作成片|完整制作|全流程)/i.test(text);

  if (isPureAnalysis) {
    return taskRouteSchema.parse({
      version: 1,
      kind: 'direct',
      requestedDeliverables: ['analysis-report'],
      scope: { targetNodeIds },
      requiredCapabilities: [],
      evidence: [{ source: 'user', referenceId: 'prompt', excerpt: text }],
    });
  }

  // 3. Deterministic video merge / stitching (postprocess only, no re-generation)
  if (/(?:拼起来|拼接|合并两个视频|合并视频|剪辑合成)/i.test(text)) {
    return taskRouteSchema.parse({
      version: 1,
      kind: 'direct',
      requestedDeliverables: ['merged-video'],
      scope: { targetNodeIds },
      requiredCapabilities: ['media:postprocess'],
      evidence: [{ source: 'user', referenceId: 'prompt', excerpt: text }],
    });
  }

  // 4. Single Stage only: "只拆分镜" / "只做分镜" / "拆成六个镜头"
  if (/(?:只把剧本拆|只做分镜|只拆分镜|拆成\d+个镜头|写分镜脚本)/i.test(text)) {
    return taskRouteSchema.parse({
      version: 1,
      kind: 'stage',
      stageIntent: 'storyboard',
      requestedDeliverables: ['storyboard-document'],
      scope: { targetNodeIds },
      requiredCapabilities: [],
      evidence: [{ source: 'user', referenceId: 'prompt', excerpt: text }],
    });
  }

  // 5. Continuation / Rework specific shot: "重做第三个镜头" / "只重做第3个镜头"
  const shotReworkMatch = text.match(/(?:重做|重新生成|修改)第\s*([0-9一二三四五六七八九十]+)\s*个?(?:镜头|分镜)/i);
  if (shotReworkMatch) {
    const shotNum = shotReworkMatch[1];
    return taskRouteSchema.parse({
      version: 1,
      kind: 'stage',
      stageIntent: 'rework-shot',
      requestedDeliverables: [`shot-${shotNum}`],
      scope: { targetNodeIds, itemIds: [`shot-${shotNum}`] },
      requiredCapabilities: ['generation:video'],
      evidence: [{ source: 'user', referenceId: 'prompt', excerpt: text }],
    });
  }

  function normalizeEpisode(raw: string): string {
    const cnMap: Record<string, string> = {
      '一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
      '六': '6', '七': '7', '八': '8', '九': '9', '十': '10',
    };
    return `第${cnMap[raw] || raw}集`;
  }

  // 6. Batch independent posters
  if (/(?:批量|生成\d+张|互相独立的海报)/i.test(text)) {
    return taskRouteSchema.parse({
      version: 1,
      kind: 'direct',
      requestedDeliverables: ['image-batch'],
      scope: { targetNodeIds },
      requiredCapabilities: ['generation:image'],
      evidence: [{ source: 'user', referenceId: 'prompt', excerpt: text }],
    });
  }

  // 7. TVC single poster vs TVC full campaign
  const isPosterOrSingleImage = /(?:一张海报|一张图|海报|主视觉|kv|生图|雨夜街景|图片)/i.test(text);
  const isMultiEpisodeOrDrama = /(?:短剧|微电影|剧本)/i.test(text);
  const isTVC = /(?:tvc|品牌片|产品广告|商业广告)/i.test(text);
  const isMV = /(?:mv|音乐卡点|歌词视频|这首歌)/i.test(text);
  const isKOC = /(?:koc|种草|口播|带货)/i.test(text);

  // TVC Campaign (must check before single poster if it explicitly requests 30s / campaign)
  if (isTVC && /(?:30\s*秒|成片|完整|视频|广告片|品牌大片)/i.test(text)) {
    return taskRouteSchema.parse({
      version: 1,
      kind: 'workflow',
      workflow: 'ad-tvc',
      requestedDeliverables: ['commercial-video'],
      scope: { targetNodeIds },
      requiredCapabilities: ['generation:video', 'generation:image', 'media:postprocess'],
      evidence: [{ source: 'user', referenceId: 'prompt', excerpt: text }],
    });
  }

  if (isPosterOrSingleImage && !/(?:完整tvc|30\s*秒|视频流程|做成片)/i.test(text)) {
    // Single image generation, direct!
    return taskRouteSchema.parse({
      version: 1,
      kind: 'direct',
      requestedDeliverables: ['image'],
      scope: { targetNodeIds },
      requiredCapabilities: ['generation:image'],
      evidence: [{ source: 'user', referenceId: 'prompt', excerpt: text }],
    });
  }

  if (isMV && /(?:做完整mv|做mv|制作mv|成片)/i.test(text)) {
    return taskRouteSchema.parse({
      version: 1,
      kind: 'workflow',
      workflow: 'mv',
      requestedDeliverables: ['music-video'],
      scope: { targetNodeIds },
      requiredCapabilities: ['generation:video', 'generation:audio', 'media:postprocess'],
      evidence: [{ source: 'user', referenceId: 'prompt', excerpt: text }],
    });
  }

  if (isMultiEpisodeOrDrama) {
    const episodeMatch = text.match(/第\s*([0-9一二三四五六七八九十]+)\s*集/i);
    const hasMultiEpisodesWord = /(?:多集|\d+集|全集)/i.test(text);

    if (hasMultiEpisodesWord && !episodeMatch) {
      return taskRouteSchema.parse({
        version: 1,
        kind: 'clarify',
        requestedDeliverables: [],
        scope: { targetNodeIds },
        workflow: 'drama-series',
        missingFacts: [
          {
            key: 'episodeScope',
            question: '检测到多集剧本内容，请明确本次需要制作哪一集？（例如：第 1 集）',
            affects: '制作范围与消耗预算',
          },
        ],
        evidence: [{ source: 'user', referenceId: 'prompt', excerpt: text }],
      });
    }

    if (episodeMatch || /(?:成片|完整视频|短剧流程)/i.test(text)) {
      const ep = episodeMatch ? normalizeEpisode(episodeMatch[1]) : '第1集';
      return taskRouteSchema.parse({
        version: 1,
        kind: 'workflow',
        workflow: 'drama-series',
        requestedDeliverables: ['drama-episode-video'],
        scope: { targetNodeIds, episodeScope: ep },
        requiredCapabilities: ['generation:video', 'generation:image', 'media:postprocess'],
        evidence: [{ source: 'user', referenceId: 'prompt', excerpt: text }],
      });
    }
  }

  if (isKOC && /(?:成片|视频|全流程)/i.test(text)) {
    return taskRouteSchema.parse({
      version: 1,
      kind: 'workflow',
      workflow: 'koc-video',
      requestedDeliverables: ['koc-video'],
      scope: { targetNodeIds },
      requiredCapabilities: ['generation:video', 'generation:audio', 'media:postprocess'],
      evidence: [{ source: 'user', referenceId: 'prompt', excerpt: text }],
    });
  }

  if (/(?:五段同一个人物|人物连续讲述|连续性)/i.test(text)) {
    return taskRouteSchema.parse({
      version: 1,
      kind: 'workflow',
      workflow: 'general-video',
      requestedDeliverables: ['continuity-video-series'],
      scope: { targetNodeIds },
      requiredCapabilities: ['generation:video', 'media:postprocess'],
      evidence: [{ source: 'user', referenceId: 'prompt', excerpt: text }],
    });
  }

  // 8. Default fallback: direct single video or image request
  const isVideoAction = /(?:生视频|生成视频|录制视频|视频)/i.test(text);
  return taskRouteSchema.parse({
    version: 1,
    kind: 'direct',
    requestedDeliverables: [isVideoAction ? 'video' : 'image'],
    scope: { targetNodeIds },
    requiredCapabilities: [isVideoAction ? 'generation:video' : 'generation:image'],
    evidence: [{ source: 'user', referenceId: 'prompt', excerpt: text }],
  });
}
