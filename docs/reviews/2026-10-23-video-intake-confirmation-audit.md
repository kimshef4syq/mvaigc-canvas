# 画布 Agent 视频制作前问询与确认审计

审计日期：2026-10-23。范围：当前工作区内置技能、任务路由、五个视频工作流构造器、SDK 提示词、阶段审核与 generation.submit 执行入口。以静态代码与技能正文为证据，没有发起媒体生成，没有运行测试，没有修改实现。

## 结论及证据边界

当前实现存在“尚未收集必要资料、尚未确认制作方案，Agent 就能提交视频生成”的完整执行通道。不是只有 MV；所有走 generation.submit 的视频流程都没有统一的素材接收和方案确认校验。

下面的请求例子是依照 routeUserTask 的条件逐项判定的路由结果，不表示已经实测这些请求一定产生视频。模型是否选择立即提交取决于当次回答；确定的缺陷是系统给出了直达指令、没有必经问询或确认门，并在自动模式自动批准提交。

此次没有读取用户刚才那次会话的实际工具轨迹，因此不将其中某个分支断言为那次事故的唯一原因。

## 1. 共用执行链：所有视频路径受影响

### 1.1 自动模式明确指示不要先询问批准

- `src/features/canvas/agent/infrastructure/sdkRuntime.ts:1972`：自动模式注入“只有删除节点会等待用户确认。不要先要求用户回复‘继续’或批准”。没有排除素材来源、人物身份、制作方案等业务决策。
- `src/features/canvas/agent/application/agentAutoApprovalPolicy.ts:20`：注释和实现都把删除节点作为唯一产品级确认例外；有效的 generation.submit 审批默认允许自动通过。
- `src/features/canvas/agent/application/canvasAgentController.ts:788`：自动模式循环调用审批恢复，传入 `approve: true`。

这说明“自动执行工具”与“用户确认创作资料/方案”没有明确分开。它不证明当前用户会话一定开着自动模式。手动模式仍会显示工具确认卡，但这张卡不等于已经完成歌曲、人物素材、脚本和方案的接收确认。

### 1.2 视频提交入口不核对业务确认

- `src/features/canvas/application/canvasCommandRegistry.ts:1541`：generation.submit 只检查节点存在、节点支持生成，随后调用 generation.submit 依赖。
- 该分支没有核对 active plan、stage、已接受的脚本/分镜、音乐来源、人物参考图或用户确认记录。
- 因此，就算资料库写了必须等待确认，Agent 绕过计划直接提交视频节点时，执行入口也不会因为缺少业务确认拒绝提交。

### 1.3 阶段审核不是强制前置条件

- `src/features/canvas/agent/domain/productionPlan.ts:123`：前后审核列表缺省均为空。
- 同文件 `:181`：ready 可以直接进入 running；waiting-user 也可以直接进入 running。
- `src/features/canvas/agent/infrastructure/productionPlanRepository.ts:110`：只验证状态转换合法，没有检查 beforeExecution 已批准、前置阶段已接受或资料齐全。
- `src/features/canvas/agent/application/productionCoordinator.ts` 的 executeStage 读取计划/阶段后直接将阶段设为 running，没有前置审核检查。它不是本审计认定实际付费提交发生的证据；实际媒体入口的缺口见 1.2。
- `production_plan` 工具将 record_review 暴露给模型执行；记录审核的仓库方法没有核对本次状态变更是否源于用户确认事件。

## 2. 确定被归为快速直达视频的请求

共同依据：`src/features/canvas/agent/application/taskRouter.ts:215` 的兜底只检测“视频”等词，就返回 direct/video，没有生成时长、素材来源或创作方案的 missingFacts。`agentSkills.ts:290` 随后注入“单步快速直达，严禁盲目创建多阶段制作大纲或流程文档”。

| 用户可见流程 | 请求例子 | 当前确定的路由及原因 | 缺少的必经决策 |
|---|---|---|---|
| 音乐视频、给歌曲配画面、歌词视频 | “帮我制作一个音乐视频”；“给这首歌做一个MV视频”；“帮我做歌词视频” | direct/video。MV workflow 还要求命中连续字符串“做mv/制作mv/做完整mv/成片”，上述写法不满足 | 歌曲上传或生成的来源选择、参考人物/歌手资料、视觉方向、时长与画幅 |
| UGC、开箱、测评、产品试用 | “帮我做UGC视频”；“帮我做开箱视频”；“帮我做产品测评视频” | direct/video。KOC 判断只识别 koc、种草、口播、带货，未覆盖 UGC/开箱/测评/试用 | 产品真实资料、素材用途、出镜人物、脚本与时长确认 |
| 短剧、微电影 | “帮我制作一个短剧视频”；“帮我做一部微电影视频” | direct/video。识别到短剧/微电影后，仍要求集号或“成片/完整视频/短剧流程”才返回 workflow | 剧本/大纲、人物与场景资产、制作模式、分镜确认 |
| 数字人、AI 主播、虚拟讲者 | “帮我做数字人讲解视频”；“帮我做一个AI主播视频” | direct/video。没有数字人专项入口，也不满足 KOC 关键词 | 出镜人像、文本或音频来源、人物与声音的选择 |
| 品牌宣传、产品发布、软件宣传 | “帮我做品牌宣传视频”；“帮我做产品发布视频”；“帮我做软件宣传视频”；“帮我做品牌大片视频” | direct/video。TVC 检测不覆盖这些写法；“品牌大片”也不匹配“品牌片” | 产品与品牌素材、核心信息、脚本和视觉方案 |
| 通用叙事、Vlog、旅游、科普、教程、动画、氛围视频 | “帮我做旅行Vlog视频”；“帮我做科普视频”；“帮我做动画视频”；“帮我做氛围视频” | direct/video。general-video workflow 仅由“五段同一个人物/人物连续讲述/连续性”等狭窄词触发 | 作品范围、用户素材、脚本/旁白来源、时长与方案 |
| 直接视频创作 | “帮我生成视频” | direct/video，路由不报资料缺失 | 连主体内容和时长也没有结构化的阻塞检查 |

其它漏路由情况：

- “做一个MV”“制作一首 MV”还可能被归为 direct/image，因为 MV workflow 不匹配且请求中没有“视频”。这是另一项确定的路由错误，不能把它说成路由代码必然提交视频。
- “批量”分支位于视频分类之前；带“批量”的视频请求会先被归为 image-batch。也属于分类错误，不计为确定的视频直达分支。
- 图片词分支位于 MV/KOC/短剧之前。某些带“图片”的视频制作请求会提前被归为 image，造成视频工作流问询被绕开。

## 3. 实际内置技能正文的问题

### video-prompt-director

- `src/features/canvas/agent/application/agentSkills.ts:90`。
- 正文要求“提交前明确首尾帧、时长、比例、分辨率和模型”，没有要求这些选择必须先呈现给用户并得到确认，也没有要求先询问现有素材。
- `examples` 虽然写“确认后执行”，但 buildSkillContext 注入的是 `skill.instructions`，没有注入这些 examples。不能把示例当作实际执行的确认规则。
- 配合自动模式及 direct 路由，Agent 可以自行补齐参数后立即提交。

### minimax-design-profiles

- `agentSkills.ts:137` 附近定义的是资料库检索技能；实际正文要求按需 profile_search/profile_read，没有在视频制作前强制读取对应 workflow 的 Intake 和确认规则。
- 因此 `resources/agent-profiles` 中的 MV/TVC 等流程规范不是所有视频任务都会自动加载的系统规则。此前仅据资料库判断“必须确认”不足以描述实际画布行为。

### director-studio（视频录制，单列说明）

- `agentSkills.ts:99`。
- 正文只要求先确认导演台节点和项目，录制前检查关键帧、时长、FPS、分辨率和格式能力，没有要求用户先批准摄影机/动作方案。
- 自动模式可以连续修改场景再录制。它产出视频，但属于 3D 场景录制，不属于 AI 视频模型生成。

## 4. 五个已识别视频工作流的明确缺口

| 工作流 | 实际代码行为 | 与“先资料、再确认、后生成”的差距 |
|---|---|---|
| MV | musicVideoWorkflow.ts 默认 visual_aesthetic、cyberpunk-neon，允许没有 musicSourceId；初始 intent 前后 review 均为空 | 没有在构造器强制音乐来源选择、真实歌曲到达和参考素材来源确认；运行时 MV 仅得到通用流水线指令，未注入资料库中的七张 Intake 卡 |
| KOC/种草/口播/带货 | kocVideoWorkflow.ts 在 Brief 中直接写 selectedHookId='hook-1'、selectedPersonaId='persona-1'，默认真人出镜、小红书、9:16，初始 review 为空 | 默认选项已经被写成 selected，但没有对应用户选择；无需通过初始 Brief 的代码审核门。运行时只要求列出 5 Hook/3 Persona，没有要求此处等待用户拍板 |
| 短剧 | dramaSeriesWorkflow.ts 默认第1集、真人、9:16、关闭配乐/字幕；无剧本时初始 script 前后 review 为空 | 无强制大纲确认；已有剧本分支同样没有初始制作计划确认门。运行时文字要求先剧本分镜，但没有落实资料库中的逐项入口问询 |
| general-video | generalVideoWorkflow.ts 自动检测 driver，写默认视觉母题；初始制作简案前后 review 为空 | 没有强制先确定素材/讲解稿/人物来源或接受简案；后续通用“分镜确认”只靠模型执行文字规则 |
| TVC | adTvcWorkflow.ts 初始 intake review 为空；但 agentSkills.ts:304 明确注入首轮提案等待、锚点审核和生成前授权 | 对话约束比其它流程完整，不能说它被明确设计为无确认直出；但没有落实为统一提交拦截，自动模式指令与该要求相冲突，generation.submit 仍不检查是否已确认 |

五个构造器对应文件均位于 `src/features/canvas/agent/application/`。

特别是 MV：`resources/agent-profiles/05-MV-音乐卡点与歌词视频流程/reference/creative-and-plan.md:26` 本来要求未决事项先提问，选择上传后等待真实文件。当前实际 skill context 和计划构造器没有把这条规则落实为前置条件。不是该资料文件允许忽略歌曲上传。

## 5. 修改/重做与上下文延续

- `taskRouter.ts:76` 将“修改第3个镜头”与“重新生成第3个镜头”一起归为 generation:video 的 rework-shot，没有区分只修改分镜文字和付费重新生成。
- stage 类型没有专门的注入分支，`agentSkills.ts:312` 会落入带 `workflow: undefined` 的通用工作流文字。这是明确的分类/指令拼接缺陷，不将它宣称为确定的直接生成行为。
- `canvasAgentController.ts:448` 调用路由只传本轮 text，没有传 router 输入接口支持的 activePlanId、selectedNodeIds 和 attachments。因此“继续/重做”的路由不能靠这些输入检查现有待确认阶段或素材。
- SDK 的 `production_plan create` 对 MV 仅传 projectId/prompt；没有把 createInput 中的 musicSourceId 传入构造器。对其它工作流也没有完整传入构造器支持的 sourceIds、productSourceIds、creatorImageSourceId、targetNodeIds 等资料字段。已上传资料不会仅因出现在 createInput 中就自动绑定到这些计划。

## 6. 已排除或需要区分的情况

- 图片生成、音乐生成和确定性后期并非本次“直接生成视频”清单的主体；此前将这些混入回答会模糊问题。
- 只有工具审批卡，没有作品资料/方案确认，仍不满足用户想要的交互。
- 自动模式没有取消所有业务问询的合理性；当前系统文字却未明确保留这些问询，是已确认的冲突。
- 资料库提到 cool-music-video，但当前仓库没有该技能正文；本机该应用标准扩展目录未发现已安装技能包。因此没有将该名称列为已经分析正文并确认直出的技能。
- 本次没有声称每条正常视频请求都必须重新询问已给出的信息。缺陷在于缺少必要资料和确认时，仍存在被直接提交的通道。

## 建议修复顺序

1. 将资料收集和方案确认独立于 manual/auto 工具执行模式；自动模式仍等待资料和创作决策。
2. 修复 direct 路由兜底：以上视频品类不能只凭出现“视频”就判定可执行；缺失关键来源/规格时返回 Intake。
3. 在 generation.submit 对工作流视频强制校验当前阶段、素材绑定和用户确认记录，不能只依赖模型读提示词。
4. MV/KOC/短剧/general-video 初始化不得将未问过的偏好写为已选；空 review 不得代表用户接受。
5. 修复 createInput 的真实素材转交及路由续接上下文，明确“修改提示词”与“重新生成”。
