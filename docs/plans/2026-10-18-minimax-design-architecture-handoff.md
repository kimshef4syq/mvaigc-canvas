# MiniMax Design 工业级架构与 202 篇提示词资产移植交接指南 (Agent Handoff Spec)

> **目标接收方**：`mvaigc-canvas` 项目工程智能体（Tauri / React / Rust / Agent 开发者）  
> **文档性质**：跨智能体系统交接规范 (Architecture & Asset Migration Protocol)  
> **交接发起方**：DeepMind Antigravity 逆向工程与架构规划智能体  
> **日期**：2026-10-18  

---

## 一、202 篇官方资产的绝对物理位置

全部 202 篇从 MiniMax Design 客户端原生逆向提取的 System Prompts、语义契约与垂直管线资产，已完整保存在本机以下目录：

1. **结构化分类源目录（推荐迁移源）**：
   `/Users/spic007/Downloads/07-项目文件/minimax-design-prompts-extracted/classified/`
   包含 12 大分类目录：
   - `01-Agents-智能体人设与编排/` (Media-Agent, Planner, Executor, Router, ComfyUI-Agent)
   - `02-Vendors-模型生成提示词与参数/` (MiniMax H3 5段式骨架, Seedance 2.0 时序公式, Kling, Wan, Veo 等)
   - `03-DramaSeries-短剧微电影完整流程/` (Stage 0~6 状态机, 3x2六视图, Blocking Memory 180° 防跳轴)
   - `04-AdTVC-商业广告与品牌大片流程/` (汽车、美妆、数码、家电等 52 篇垂直 TVC 规约)
   - `05-MV-音乐卡点与歌词视频流程/` (歌词对齐、节拍跟踪、视听情绪桥接)
   - `06-KOC-带货与口播种草流程/` (口播字数密度、痛点挂钩、CTA 转化)
   - `07-SharedPipelines-共享资产与后期管线/` (Stage Execution Plan JSON 契约, FFmpeg 剪辑, ASS 字幕)
   - `08-Failures-防翻车与负向避坑知识库/` (13 篇负向拦截：畸形手、塑料假脸、风格漂移、否定词、乱码)
   - `09-Contracts-画布纪律与语义契约/` (增量补丁编辑、Auto-grouping 网格成组、Anti-loop 熔断)

2. **完整白皮书与 PDF 技术手册（核心参考依据）**：
   - 📕 **完整版 PDF 手册**：`/Users/spic007/Downloads/07-项目文件/minimax-design-prompts-extracted/MiniMax-Design全流程架构与提示词资产手册.pdf` *(93 页，含全景思维导图与架构图)*
   - 📘 **完整版 Markdown 总册**：`/Users/spic007/Downloads/07-项目文件/minimax-design-prompts-extracted/MiniMax-Design全流程架构与提示词资产手册.md`
   - 📑 **三篇分卷深度研报**：
     - `01-多智能体协作与画布调度架构.md`
     - `02-视频与多模态模型提示词完整手册.md`
     - `03-短剧与影视分镜全流程编排指南.md`

3. **原始未分类完整提取包（备查源）**：
   `/Users/spic007/Downloads/07-项目文件/minimax-design-prompts-extracted/raw/`

---

## 二、资产物理迁移步骤（如何在 mvaigc-canvas 落地）

本项目 `mvaigc-canvas` 是基于 Tauri v2 + React 18 + Zustand + `@xyflow/react` 构建的桌面画布工具。请按以下标准步骤植入：

### 1. 执行一键同步脚本
在 `mvaigc-canvas` 根目录下运行已就绪的同步脚本：
```bash
chmod +x scripts/sync-minimax-profiles.sh
./scripts/sync-minimax-profiles.sh
```
该脚本会自动：
- 在本项目创建 `resources/agent-profiles/` 目录；
- 将 `classified/` 下的所有分类目录完整增量同步过来；
- 运行清单生成器，产出 `src/generated/profiles-manifest.json`，供前端与 Agent 快速索引。

### 2. 打包配置确认
在 `src-tauri/tauri.conf.json` 的 `bundle.resources` 中确认包含：
```json
"bundle": {
  "resources": [
    "resources/agent-profiles/**/*"
  ]
}
```

---

## 三、代码化与工程实施架构（mvaigc-canvas 智能体执行清单）

请 `mvaigc-canvas` 智能体依据以下四个层级逐步推进工程落地：

### 任务 1：实现多模态 Prompt 工业编译器 (`src/features/promptCompiler/`)
不要让模型盲目发散。根据 `02-Vendors/minimax.md` 与 `02-Vendors/seedance.md` 实现机器化装配器：
1. **MiniMax H3 5 段式骨架**：
   - `[全画幅空间基准]` + `[180°机位视角与景别]` + `[主客观光影基准]` + `[逐秒演进 0-2s/2-4s/4-6s]` + `[声音签名与音效]`
2. **豆包 Seedance 2.0 动作时序公式**：
   - 槽位映射：强制依赖 `@图片1`（角色资产卡）与 `@音频1`（对白音轨）
   - 时长律：4~6s 单动作 / 7~10s 双动作 / 11~15s 三动作时序。

### 任务 2：实现 13 篇 Failures 自动化前置质检网关 (`PromptLinter.ts`)
在任务派发给 `mvaigc-proxy`（消耗积分）之前，自动运行正则与规则拦截：
- **否定词陷阱 (constraint-negation.md)**：拦截“不要/无/禁止”，自动改写为正向客观描述。
- **生图文字乱码 (on-image-text.md)**：剥离 Prompt 中的引号文字，交由后期 ASS 字幕轨道渲染。
- **塑料假脸 (plastic-skin.md)**：人脸特写时强制追加毛孔肌理与自然反光词。
- **肢体畸变 (anatomy-traps.md)**：高危手指微动作替换为自然握持道具。
- **音色样本检查**：参考音频时长超过 3 秒时强制截断或告警。

### 任务 3：实现滑动窗口并发派单队列 (`ExecutorQueue.ts`)
对接现有的本地 `mvaigc-proxy`（`http://127.0.0.1:8787`）：
- 严格限制 MiniMax H3 **最大 10 路并发**；
- 队列式动态消费，收到一个视频成功回调，再放行下一个分镜，防止触发 API 速率熔断；
- 单个工单连续重试达 3 次触发熔断挂起（Anti-loop 契约）。

### 任务 4：画布呈现与底层资产解耦（Canvas vs SQLite）
- 前端 React Flow (`@xyflow/react`) 节点只保存 `nodeId`、坐标和 `assetId` 引用；
- 真实数据与派生血统存入本地 SQLite（`assets` 表与 `asset_dependencies` 表）；
- 单轮生成镜头 ≥ 2 时触发 Auto-grouping 网格自动排版（Label ≤ 40 字）。

---

## 四、快速指令（用户在 mvaigc-canvas 呼叫智能体时使用）

> 💡 **用户操作指引**：在 `mvaigc-canvas` 的对话窗口中，直接发送：
> `请阅读 docs/plans/2026-10-18-minimax-design-architecture-handoff.md，执行其中的迁移脚本，并开始实现 PromptCompiler 和 PromptLinter。`
