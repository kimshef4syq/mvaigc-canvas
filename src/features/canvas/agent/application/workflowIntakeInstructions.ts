import type { TaskRouteV1 } from '../domain/taskRoute';

const INTAKE: Record<string, string> = {
  'music-video': 'MV：先问上传歌曲、沿用已有歌曲还是授权作曲，并问是否上传歌手/人物照片、歌词和视觉参考。选择上传后立即等待真实文件，不能先生成替代歌曲或人物。确认歌曲使用范围、视觉方向、时长和画幅。',
  commercial: 'TVC/广告：先收集品牌、产品真实图片和事实、受众与卖点，再给创意提案；不得自行虚构产品身份。',
  'product-launch': '产品发布/软件宣传：先收集产品链接、真实界面截图/录屏、品牌资产和重点功能；确认脚本与演示顺序。',
  ugc: 'KOC/UGC：先收集产品资料，确认出镜形式、用户人物素材或授权创建人物；列出 Hook/Persona 候选，让用户选择，不能默认选第一项。',
  drama: '短剧/微电影：先确定剧本来源与集数范围；无剧本先确认大纲，再写剧本。收集人物场景资料，确认制作模式与分镜。',
  presenter: '数字人/AI 主播：先询问人像/已有数字人、文案或音频来源、声音与背景；不要把未提供的人像当成允许随机创建人物。',
  explainer: '科普/教程/解说：先确定主题和事实来源、讲解稿由用户提供还是授权编写、配音与画面方案。',
  documentary: '纪录/采访/Vlog：先收集用户素材，确定使用范围、叙事结构、原声、音乐和字幕需求；不要把剪辑需求改成生成替代素材。',
  creative: '创意/艺术/动画短片：先确定创意方向、主体、视觉风格、已有参考、时长与画面发展，再出分镜。',
  promotion: '活动/人物/作品宣传：先收集宣传资料、人物/活动事实与已有素材，确认核心信息和脚本结构。',
};

export function workflowIntakeInstructions(route?: TaskRouteV1): string {
  if (!route) return '';
  if (route.kind === 'stage') return `本次只处理 ${route.stageIntent}，保持当前计划和镜头范围。修改分镜文字不授权重新生成视频。需要重新生成时先呈现修改后的镜头提示词、素材与参数供用户确认。不得以 workflow: undefined 创建新计划。`;
  if (route.kind !== 'workflow') return '';
  const categories: Record<string, string> = { mv: 'music-video', 'ad-tvc': 'commercial', 'drama-series': 'drama', 'koc-video': 'ugc' };
  const category = route.productionCategory ?? categories[route.workflow ?? ''] ?? 'creative';
  return [
    '【制作流程的素材接收与阶段确认，自动/手动模式均必须遵守】',
    route.activePlanId ? `继续已有计划 ${route.activePlanId}，先 get 读取当前阶段；不要重新创建计划，不要重复询问已回答事项。` : `先建立 ${route.workflow} 制作计划，只编写当前阶段。`,
    INTAKE[category],
    '把同轮可回答的缺失事项一次问清，给用户上传或授权原创的选择。已明确提供的事实和已确认资料直接沿用；建议、默认值和自动模式均不等于用户选择。用户选择上传后停下来等待文件，不能用占位 ref 继续。',
    '确认节奏：收集资料 → 确认方案/脚本 → 按需确认人物资产和分镜 → 授权生成视频 → 审阅成片。只自动执行已确认阶段内部的工具调用，不跨越待确认阶段。',
    '首阶段编写完成时，在 document 工作项 payload.intake 登记 {contentSource:"user"|"agent", referenceSource:"upload"|"existing"|"original", durationSeconds:具体正数, aspectRatio:"16:9"等}；MV 另登记 musicSource:"upload"|"existing"|"generate"，使用真实歌曲时登记 musicSourceId。上传/已有素材写入 inputRefs，不能伪造。方向正文写入 payload.text 或实际文档节点，并向用户呈现。',
    'author_stage 后读取主机返回的 review。每个待确认项先展示真实方案/脚本/资产；调用 production_plan(action:"record_review", planId, expectedRevision, recordReviewInput:{stageId,reviewId,status:"passed"})，应用会显示用户确认卡。不得自行填写 confirmedByUser、删除审核项、使用 waived 或用之前的批准替代当前确认。用户未批准时结束并等待。',
    '前阶段成果完成并确认后才编写下一阶段。视频工作项 inputRefs 登记真实参考节点/资产，payload.prompt 写完整提示词、payload.durationSeconds 写具体秒数；阶段 executionLocks 写 modelRef（当前模型真实 modelId）、aspectRatio 和 resolution。创建生成节点并建立参考连线后，将真实 nodeId 写入 workItems[].payload.nodeId，再请求 beforeExecution 的确认。节点配置和参考连线必须与已确认计划一致，变更后重新确认，确认后才能 generation.submit。',
  ].join('\n');
}
