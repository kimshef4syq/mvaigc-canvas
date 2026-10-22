# 视频制作任务分流与阶段确认

## 用户可见行为

完整制作请求按交付物进入工作流，不以 15 秒等时长作为直达依据：

| 制作类别 | 使用的工作流 |
|---|---|
| MV、音乐视频、歌词视频、卡点与音乐可视化 | mv |
| TVC、品牌广告、产品广告、品牌大片 | ad-tvc |
| 产品发布、软件/App/SaaS 宣传及演示 | ad-tvc |
| KOC/UGC、种草带货、测评、开箱、试用 | koc-video |
| 短剧、微电影、故事短片、剧情动画 | drama-series |
| 数字人、AI 主播、照片说话 | general-video |
| 科普、教程、解说 | general-video |
| 纪录、采访、旅行/Vlog 成片 | general-video |
| 创意、艺术、动画、氛围短片 | general-video |
| 活动、人物、企业、作品宣传与预告 | general-video |

信息和时长已明确的独立单镜头仍可直达。单张图片、纯分析、只写脚本/分镜、只修改镜头文字及明确的确定性后期处理不因参考材料中出现视频品类词而启动整片生成。多个依赖镜头、同一人物跨片段连续、需要方案/分镜审阅或跨媒体制作的任务进入工作流。

自动模式执行已确认阶段里的操作；素材和创作决定仍等待用户。常用节奏：收集素材 → 确认方向/脚本 → 按需审核人物资产与分镜 → 授权视频生成 → 审阅成果。用户选择上传时等待真实素材，不生成替代歌曲或人物。

## 实现

- `taskRouter.ts` 按交付物识别十类制作请求；修复 MV 措辞、UGC/开箱/测评、数字人、品牌宣传等漏路由，以及“批量/图片”词抢先把视频请求归为图片的问题。参数答复和“继续”延续当前项目最新活跃计划。
- `workflowIntakeInstructions.ts` 注入各类素材接收要求、上传等待与统一阶段契约。工作流工具不再依赖是否碰巧选中了知识库技能。
- 五个计划构造器启用 `staged-v1`。MV 不替用户锁定赛博风格；KOC 不默认选 Hook/Persona；未确认的推荐值不登记为用户选择。
- `workflowConfirmation.ts` 在主机侧补齐确认关卡。Agent 不能通过空审核数组、伪造 passed/confirmedByUser 或 waived 越过关卡。更改提示词、引用或锁项重置确认；重新产出成果重置结果审阅。
- `production_plan.record_review` 进入真实用户审批，自动审批策略保留该操作。主机记录用户确认和实际阶段内容哈希；确认受计划 revision 保护。
- `workflowGenerationGuard.ts` 在内置 SDK 和外接画布桥的生成入口检查阶段：首阶段已接收素材并确认；前置阶段已完成和确认；视频工作项已经授权；生成节点绑定当前工作项；实际提示词、模型、时长、画幅、分辨率与有序参考连线符合已确认计划。
- `productionPlanRepository`/`productionPlanService`/`productionCoordinator` 阻止未经确认的阶段推进。生产结束先进入成果审阅，不能直接宣称用户已接受。
- 自动/手动模式说明同步更新，移除“自动模式只有删除需要确认”的旧说法。

## 工作项约定

首阶段 document 的 `payload.intake` 登记内容来源（user/agent）、参考来源（upload/existing/original）、具体 durationSeconds 与 aspectRatio；MV 另登记 musicSource（upload/existing/generate）和真实 musicSourceId。正文用 payload.text 或真实 documentNodeId 提供，已有素材用 inputRefs 引用。

视频工作项使用 payload.prompt、payload.durationSeconds、payload.nodeId；executionLocks 使用真实模型 modelRef、aspectRatio、resolution。inputRefs 对应真实参考节点/资产，必须与画布参考连线一致。

## 验证范围

新增路由矩阵覆盖十类作品及素材词、短时长、批量任务、独立镜头、图片和文本任务边界。生成边界测试覆盖缺计划、缺歌曲、假素材、未确认方案、越过前置阶段、伪造确认、提示词/连线变更和获批视频提交。SDK 测试验证自动模式仍暂停在阶段审批，且 general-video 能获得制作计划工具。

回归覆盖 Agent application、SDK、阶段领域模型与相关界面；运行 TypeScript 检查及生产构建。没有调用真实付费生成接口，也没有发布安装包。
