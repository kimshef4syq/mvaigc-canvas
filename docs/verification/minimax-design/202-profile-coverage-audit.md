# MiniMax Design 202 份资料覆盖与适配审计报告

> **审计基线**: 基于 `src/generated/profile-catalog.json`、`src/generated/profiles-manifest.json` 与 `resources/agent-profiles/` 源码库  
> **验证工具**: `npm run profiles:verify` (202/202 SHA-256 校验通过)  
> **审计日期**: 2026-10-19  
> **审计状态**: 全部 202 份资料完成系统性映射与适配归属，无遗漏、无孤立挂载。

---

## 1. 架构原则与两级完成定义

1. **资料定位**：
   - 202 份 MiniMax Design Markdown 资料是**设计与工程规约素材库**，并非 202 个运行时独立安装的 Skill 插件。
   - 所有资料通过 `src/features/canvas/agent/infrastructure/profileRepository.ts` 暴露受控读取 (`profile_read`) 与元数据检索 (`profile_search`)，受 12,000 字符分页、SHA-256 哈希校验与白名单约束。

2. **行为映射**：
   - 原资料声明的 54 个遗留工具标识（如 `hub_ffmpeg`、`hub_run_comfyui_workflow`、`design_score` 等）全部映射为宿主真实受控服务（`mediaPostprocessService`、`ComfyUiAdapterService`、`evaluateDesignScore`、`canvasCommandService`）。
   - 单张生图、纯剧本节奏分析、单阶段六分镜拆解走 `direct` 快速通道，不触发多阶段制作计划 DAG。

---

## 2. 目录分布与适配概览

| 目录编号与分类 | 文件数量 | 核心功能定位 | 宿主核心承接模块 | 关联测试套件 |
|---|---|---|---|---|
| **01-Agents-智能体人设与编排** | 7 | 任务分流、角色边界、计划编排、执行协同 | `taskRouter.ts`, `productionRoles.ts`, `productionPlanService.ts` | `taskRouter.test.ts`, `productionRoles.test.ts` |
| **02-Vendors-模型生成提示词与参数** | 27 | 视频/生图/TTS/音乐模型能力卡、提示词模板 | `modelCard.ts`, `agentContracts.ts` (Linter) | `modelCard.test.ts`, `agentContracts.test.ts` |
| **03-DramaSeries-短剧微电影完整流程** | 10 | 短剧制作计划、站位记忆、分镜、15s限制、重做 | `dramaSeries.ts`, `dramaSeriesWorkflow.ts` | `minimaxAcceptanceMatrix.test.ts` (A07, A15) |
| **04-AdTVC-商业广告与品牌大片流程** | 52 | 6大品类、4大创意方向、20项视觉手法(T01-T20) | `adTvc.ts`, `adTvcWorkflow.ts` | `minimaxAcceptanceMatrix.test.ts` (A06, A32) |
| **05-MV-音乐卡点与歌词视频流程** | 14 | 主音乐权威锁、无缝时间切片、卡点节奏 | `musicVideo.ts`, `musicVideoWorkflow.ts` | `musicVideoWorkflow.test.ts`, A21 |
| **06-KOC-短视频与口播种草流程** | 9 | 原生口播口径、5大Hook模板、BGM/字幕隔离 | `kocVideo.ts`, `kocVideoWorkflow.ts` | `minimaxAcceptanceMatrix.test.ts` (A22) |
| **07-GeneralVideo-通用视频分镜与生成方法** | 21 | N/C/S 三阶段骨架、轻量视频生成、单镜头重做 | `generalVideoWorkflow.ts`, `productionPlan.ts` | `productionPlanService.test.ts`, A08, A11 |
| **08-Failures-防翻车与负向避坑知识库** | 19 | 手指比例、塑料感、负向词漂移等风险预检 | `agentContracts.ts` (`lintFailureRisks`), `agentFailurePolicy.ts` | `agentContracts.test.ts`, A09 |
| **09-Contracts-画布纪律与语义契约** | 39 | 视听语言参考、设计评分规则、画布纪律 | `agentContracts.ts` (`validateCanvasDiscipline`, `evaluateDesignScore`) | `agentContracts.test.ts`, A17, A28, A33 |
| **10-Audio-声音设计与音频生成规范** | 4 | 独立音轨混音、TTS配音、人声降噪、BGM自动化 | `mediaPostprocess.ts`, `mediaPostprocessService.ts` | `mediaPostprocess.test.ts`, A19, A20 |
| **总计** | **202** | **全流程生产规范与视听知识库** | **Canvas Agent 核心域与基础设施** | **432 项 Vitest 自动化测试** |

---

## 3. 逐分类资料明细与测试映射

### 3.1 01-Agents 智能体人设与编排 (7 项)
- `01-Agents-智能体人设与编排/README`: 智能体目录与系统提示词规范（测试覆盖: `A25`）。
- `01-Agents-智能体人设与编排/comfyui-agent`: ComfyUI 智能体输入契约（映射模块: `comfyuiAdapter.ts`, 测试: `comfyuiAdapter.test.ts`, `A24`）。
- `01-Agents-智能体人设与编排/executor`: 执行器契约，严格禁止越权修改已确认产物（映射模块: `productionRoles.ts`, 测试: `productionRoles.test.ts`）。
- `01-Agents-智能体人设与编排/media-agent`: 多模态主控分析与分流（映射模块: `taskRouter.ts`, 测试: `taskRouter.test.ts`）。
- `01-Agents-智能体人设与编排/planner`: 策划人设，只编排不提交付费任务（映射模块: `productionRoles.ts`, 测试: `productionRoles.test.ts`, `A26`）。
- `01-Agents-智能体人设与编排/router`: 意图路由分流逻辑（映射模块: `taskRouter.ts`, 测试: `taskRouter.test.ts`）。
- `01-Agents-智能体人设与编排/v3/media-agent`: v3 规范多模态主控（映射模块: `taskRouter.ts`, 测试: `A01-A05`）。

### 3.2 02-Vendors 模型生成提示词与参数 (27 项)
- 模型后端卡片（MiniMax H3, Kling, Seedance, Veo, Wan 3.0, Banana, Midjourney, Seedream, Moss, SeedAudio, Official-Music 及其 v3 对应卡片）：
  - 映射模块: `src/features/canvas/agent/domain/modelCard.ts` 提供参数范围、比例约束、模态能力校验。
  - 测试覆盖: `modelCard.test.ts`, `A09`。

### 3.3 03-DramaSeries 短剧微电影完整流程 (10 项)
- 流程与参考文档（制作计划、资产站位记忆、分镜列表、关键帧宫格、H3片段Prompt、后期剪辑）：
  - 映射模块: `dramaSeries.ts`, `dramaSeriesWorkflow.ts`。
  - 核心约束: 单片段 `<= 15.0s` 硬上限拆解、站位记忆联合审阅、`reworkDramaShot` 局部更新。
  - 测试覆盖: `minimaxAcceptanceMatrix.test.ts` (A07, A15)。

### 3.4 04-AdTVC 商业广告与品牌大片流程 (52 项)
- 6大品类（汽车、美妆、服装、食品、家电、3C数码）：`category/*.md`。
- 4大创意方向（品牌广告、产品广告、剧情广告、病毒广告）：`direction/*.md`。
- 20项视觉手法（T01 极速微距流转 ~ T20 感官母题互译链）：`reference/visual-techniques/*.md`。
- 品牌约束（Brand Logo Guard）：`reference/_internal/brand-logo-guard.md`。
- 映射模块: `adTvc.ts`, `adTvcWorkflow.ts`。
- 测试覆盖: `minimaxAcceptanceMatrix.test.ts` (A06, A32)。

### 3.5 05-MV 音乐卡点与歌词视频流程 (14 项)
- 流程与参考文档（主音乐测量、分镜排版、字体视觉包装、视听卡点契约）：
  - 映射模块: `musicVideo.ts`, `musicVideoWorkflow.ts`。
  - 核心约束: 实测主音频长度为绝对权威、`partitionMvClipGroups` 无缝切片时长无浮点累积误差。
  - 测试覆盖: `musicVideoWorkflow.test.ts`, `minimaxAcceptanceMatrix.test.ts` (A21)。

### 3.6 06-KOC 短视频与口播种草流程 (9 项)
- 流程与参考文档（5大Hook候选模版、博主Persona候选库、原生口播音频策略）：
  - 映射模块: `kocVideo.ts`, `kocVideoWorkflow.ts`。
  - 核心约束: 原生口播优先、默认关闭 BGM 与烧录字幕、支持显式 override。
  - 测试覆盖: `minimaxAcceptanceMatrix.test.ts` (A22)。

### 3.7 07-GeneralVideo 通用视频分镜与生成方法 (21 项)
- 包含通用分镜模板、N/C/S 三阶段状态机骨架、轻量成片工作流：
  - 映射模块: `generalVideoWorkflow.ts`, `productionPlan.ts`, `productionPlanService.ts`。
  - 核心约束: 乐观并发 revision 锁、部分成功重试、租赁锁 (`fencingToken`)。
  - 测试覆盖: `productionPlanService.test.ts`, `productionCoordinator.test.ts`, `A08`, `A11`, `A12`, `A13`, `A14`, `A16`。

### 3.8 08-Failures 防翻车与负向避坑知识库 (19 项)
- 涵盖人体解剖（P180）、品牌侵权（P181）、否定约束失效（P183）、塑料假人感（P192）、口播未同步（P193）、条漫比例漂移（P194）：
  - 映射模块: `src/features/canvas/agent/domain/agentContracts.ts` (`lintFailureRisks`) 与 `agentFailurePolicy.ts`。
  - 核心约束: 提交前轻量风险预检，不直接阻断用户明确请求，给出可落地修改建议。
  - 测试覆盖: `agentContracts.test.ts`, `agentFailurePolicy.test.ts`, `A09`。

### 3.9 09-Contracts 画布纪律与语义契约 (39 项)
- 视听语法与排版包装参考、画布操作纪律、多模态语义优先级、客观设计评分：
  - 映射模块: `agentContracts.ts` (`validateCanvasDiscipline`, `resolveSemanticPriority`, `evaluateDesignScore`)。
  - 核心约束: 禁止 `allowDuplicate: true`、禁止占位符 ID、禁止重复读取；4级优先级裁决。
  - 测试覆盖: `agentContracts.test.ts`, `A17`, `A28`, `A33`。

### 3.10 10-Audio 声音设计与音频生成规范 (4 项)
- 包含声音规范、多轨道混音、响度平衡、精确字幕烧录：
  - 映射模块: `mediaPostprocess.ts`, `mediaPostprocessService.ts`。
  - 核心约束: 结构化受控执行（trim, concat, mix, burn-subtitles）、防注入解析、幂等回执与回滚 token。
  - 测试覆盖: `mediaPostprocess.test.ts`, `A19`, `A20`。

---

## 4. 自动化验证汇总

1. **行尾规范检查**:
   `npm run check:line-endings` -> 全部文件确保 LF 统一换行。
2. **资料元数据与哈希校验**:
   `npm run profiles:verify` -> 202 个资料全部匹配 `profiles-manifest.json` SHA-256 校验。
3. **单元与集成测试套件**:
   `npx vitest run src/features/canvas/agent/` -> **60 个测试套件，432 项用例 100% 通过**。
