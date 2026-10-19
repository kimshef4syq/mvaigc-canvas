# MiniMax Design 移植全能力端到端测试与验收执行方案

本文档面向测试工程师、开发人员及协同智能体，提供 **MiniMax Design 202 份资料移植成果** 的全量测试指南，涵盖 **自动化分层测试**、**专项模块验证**、**UI 界面交互实测** 以及 **异常熔断与安全边界验证**。

---

## 一、自动化分层测试（快速检验代码健康度）

### 1.1 基础质量门禁测试
验证项目所有文件的换行规范（LF-only）以及 202 份原始 Markdown 资料与 Catalog Manifest 的 SHA-256 哈希完整性：
```bash
# 1. 检查文件换行符规范（全量 959 个文件必须严格为 LF）
npm run check:line-endings

# 2. 检查 202 份资料哈希与 Manifest 一致性（防止资料被静默篡改或缺失）
npm run profiles:verify
```
- **预期结果**：
  - `check:line-endings` 输出：`Checked 959 tracked files: text line endings are LF-only.`
  - `profiles:verify` 输出：`Verified 202 MiniMax Design profile files, manifest entries, semantic catalog, and adaptation records.`

---

### 1.2 核心业务验收矩阵测试 (A01 - A34)
该测试集覆盖方案中规划的全部 34 项端到端关键验收用例：
```bash
npx vitest run src/features/canvas/agent/application/minimaxAcceptanceMatrix.test.ts
```
- **测试涵盖**：
  - `A01~A05`：直达生图、剧本节奏纯分析、分镜拆解、上下文隔离与批量独立性
  - `A06~A09`：TVC/海报分流、多集范围澄清、空镜阶段精简、2K/口播能力冲突预检
  - `A10~A16`：长文档游标翻页、工作项失败局部重试、POST超时幂等恢复、并发租约锁、镜头局部重做、项目隔离
  - `A17~A22`：非法占位符拦截、越权工具过滤、特殊标点字幕烧录、视频拼接转码、MV音频绝对权威、KOC显式音轨策略
  - `A23~A28`：搜索断网兜底、ComfyUI缺失节点发现、资料缓存哈希防窜改、跨端一致性、多运行时权限对齐、手动分组保护
  - `A29~A34`：持久化对账句柄、脱敏导出安全、文本文件解析OCR判定、旧路径别名解析、语义优先级裁决、LoopGuard死循环熔断
- **预期结果**：**34 passed (34)**，执行时间约 1.5s。

---

### 1.3 全量自动化测试套件
```bash
# 运行画布 Agent 模块全部 60 个测试文件
npx vitest run src/features/canvas/agent/
```
- **预期结果**：**60 passed, 432 passed (432)**，零报错。

---

## 二、专项模块针对性测试命令

如果针对某个具体专项进行修改或排错，可直接运行对应的独立测试：

| 测试对象 | 目标功能 | 专用测试命令 |
|---|---|---|
| **任务分流器** | Direct / Clarify / Workflow 路由决策 | `npx vitest run src/features/canvas/agent/application/taskRouter.test.ts` |
| **短剧微电影** | 15s 硬上限拆解、站位记忆、镜头重做 | `npx vitest run src/features/canvas/agent/application/minimaxAcceptanceMatrix.test.ts -t "A07\|A15"` |
| **广告 TVC** | 6 大行业品类识别、20 项视觉手法、锚点复用 | `npx vitest run src/features/canvas/agent/application/minimaxAcceptanceMatrix.test.ts -t "A06\|A32"` |
| **音乐卡点 MV** | 实测主音频权威锁、无缝切片无累积误差 | `npx vitest run src/features/canvas/agent/application/musicVideoWorkflow.test.ts` |
| **KOC 种草短视频** | 原生口播模式优先、Hook候选库、BGM与字幕隔离 | `npx vitest run src/features/canvas/agent/application/minimaxAcceptanceMatrix.test.ts -t "A22"` |
| **制作计划状态机** | ProductionPlan 乐观并发锁 (`revision`) 与工作项重试 | `npx vitest run src/features/canvas/agent/application/productionPlanService.test.ts` |
| **执行协调器** | 跨标签页并发租约 (`acquireLease`) 与幂等指纹 | `npx vitest run src/features/canvas/agent/application/productionCoordinator.test.ts` |
| **受控媒体后期** | 探测、精确拼接、智能闪避混音、字幕防注入烧录 | `npx vitest run src/features/canvas/agent/domain/mediaPostprocess.test.ts` |
| **ComfyUI 适配器** | 节点/模型依赖预检、运行状态机、产物收归 | `npx vitest run src/features/canvas/agent/application/comfyuiAdapter.test.ts` |
| **防循环与纪律** | LoopGuard 熔断、画布纪律检查、四级优先级裁决 | `npx vitest run src/features/canvas/agent/application/agentLoopGuard.test.ts src/features/canvas/agent/domain/agentContracts.test.ts` |
| **外部 MCP 桥接** | Codex / Claude Code 外部调用清单与分发 | `npx vitest run src/features/canvas/agent/application/externalAgentToolManifest.test.ts` |

---

## 三、界面交互与人工端到端测试方案

### 3.1 启动服务
```bash
npm run dev
```
启动后在浏览器打开控制台输出的本地地址（通常为 `http://localhost:5173`），或使用桌面客户端进入画布页面。

---

### 3.2 逐场景实测用例

#### 测试场景 1：小任务 Direct 快速直达通道（禁止生成多阶段制作计划）
- **输入 Prompt 1**：`生成一张雨夜街景`
  - **预期表现**：
    - 对话框仅出现简单的图片生成确认卡或直接生成节点；
    - **严禁**弹出「短剧制作计划」或「TVC 策划案」等多阶段 DAG 流程面板；
    - 画布上仅新增 1 个图片节点，引用正确的图片生成模型。
- **输入 Prompt 2**：`只分析剧本节奏`
  - **预期表现**：
    - Agent 输出纯文本的节奏分析报告；
    - 工具调用记录中**无** `generation.submit`，不触发扣费或任务排队。
- **输入 Prompt 3**：`只把剧本拆成六个镜头`
  - **预期表现**：
    - Agent 仅输出包含 6 个镜头的分镜脚本与景别说明；
    - 不会自动触发 6 段视频或 6 张图片的渲染提交。

---

#### 测试场景 2：多集短剧范围澄清（Clarify 机制）
- **输入 Prompt**：`短剧全集剧本已上传，请制作成片`
- **预期表现**：
  - 系统识别到多集模糊性，**不会**盲目把全集全部加入渲染队列；
  - Agent 主动发起澄清卡片，询问：“检测到多集剧本内容，请明确本次需要制作哪一集？（例如：第 1 集）”。

---

#### 测试场景 3：短剧微电影完整制作流与局部重做
- **输入 Prompt 1**：`已有剧本，制作第1集短剧`
- **预期表现**：
  - 任务路由进入 `drama-series` 工作流；
  - 计划大纲自动**省略**已有的「剧本编写」阶段，直接进入「资产锚点」和「站位记忆与分镜」阶段；
  - 自动物化站位记忆文档，镜头时长严格遵守 `< 15.0s` 硬限制。
- **输入 Prompt 2（局部重做）**：`重做第2个镜头，改成主角拔剑反击`
- **预期表现**：
  - 系统仅对第 2 个镜头对应的 workItem 置为 `pending` 重新编译提示词；
  - 第 1 镜与后续无依赖镜头的已完成产物妥善保留，`revision` 自增，杜绝全剧本重跑。

---

#### 测试场景 4：商业广告 TVC 流程与品类识别
- **输入 Prompt**：`为全新智能电动SUV制作一段30秒广告TVC`
- **预期表现**：
  - 自动识别行业品类为 `auto`（汽车），创意方向为 `product-ad` 或 `brand-ad`；
  - 制作大纲按序展示：提案简报 -> 核心锚点（车型硬照/光影） -> 分镜脚本 -> 视频生成；
  - 分镜提示词中自动匹配并注入 T01（极速微距）或 T19（速度感驾驶）等专业视觉手法参数。

---

#### 测试场景 5：KOC 种草短视频与音轨隔离
- **输入 Prompt**：`做一段美妆口播，不要加BGM，也不要加字幕`
- **预期表现**：
  - 任务路由进入 `koc-video` 工作流；
  - 提案简报生成 5 个 Hook 候选（如反直觉开场、痛点共鸣）与 3 个博主 Persona；
  - 声音配置锁定为原生视频口播模式（`native-dialogue-in-video`）；
  - `wantBgm` 严格为 `false`，`wantSubtitles` 严格为 `false`，后期阶段不会混入背景音乐或硬烧字幕。

---

#### 测试场景 6：防翻车风险预检 (Linter 机制)
- **输入 Prompt**：`2K 逼真人像，同时带有口播对白`
- **预期表现**：
  - 系统在预检阶段提示检测到潜在风险：
    - `spoken-video`：提示视频需要同步对白，建议走原生对白流或对齐音轨；
    - `plastic-skin`：提示超写实肖像易产生假人感，建议补充毛孔与微表情肌理细节；
  - Agent 在优化提示词时自动应用这些建议，而不是直接报错拒执。

---

#### 测试场景 7：LoopGuard 防死循环熔断测试
- **测试步骤**：
  - 在对话框中连续快速发送 3 次完全相同且无法解析的指令（例如 `canvas_command` 执行错误或非法语法）。
- **预期表现**：
  - 第 3 次调用时，系统立即阻断并触发红色警告：`[LoopGuard] 检测到在最近 5 次工具调用中已执行 3 次完全相同的调用，强制熔断，防止消耗超出限制。`
  - 停止死循环，保护用户配额与算力资源。

---

## 四、外部智能体（Codex / Claude Code）协同测试

如果你在使用 Codex、Claude Code 或自建智能体通过 MCP 协议连接到该画布：

1. **Manifest 获取**：
   调用工具发现接口，检查是否能正常获取到新增的工具清单：
   - `production_plan`（制作计划读取、大纲编写、重试）
   - `profile_search`（202 份资料目录检索）
   - `profile_read`（分页受控读取）
   - `source_read` / `source_inspect`（剧本文件与来源解析）
   - `media_postprocess`（结构化音视频后期操作）
2. **越权工具隔离**：
   检查返回的 Tools 列表中**绝对不存在**遗留的未授权标识（如 `hub_ffmpeg`、`hub_run_comfyui_workflow`）。
3. **调用测试**：
   通过外部客户端发送：
   ```json
   {
     "name": "profile_search",
     "arguments": { "query": "T13" }
   }
   ```
   **预期返回**：准确定位到 `T13-fluid-macro-dynamics.md` 流体微距动力学资料详情。
