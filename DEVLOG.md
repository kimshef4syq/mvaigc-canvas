# mvaigc-canvas 开发日志（交接用）

> 新会话 / 新接手的人：读这一份就知道**已经做完什么、在哪、怎么验证、下一步**。
> 不必重新问"我们之前干了哪些活"。
>
> 最后更新：2026-10-10

---

## 0. 一句话现状

`mvaigc-canvas/` 是 Open Storyboard Canvas（OSC）的二次开发版本。
当前分支 **`feat/mvaigc-proxy`**，共 **81 个提交**，工作区干净（无未提交改动）。
三条主线已完成：**自建反代（mvaigc-proxy）**、**「生成图片」一体节点**、**「生成视频」一体节点**。

工作区约定、Camera 冻结范围、截图硬性要求等，见 `../CLAUDE.md`（不在此重复）。

---

## 1. 分支与回退锚点

| 项 | 值 |
|---|---|
| 分支 | `feat/mvaigc-proxy`（不是 main，可直接提交） |
| 提交总数 | 81 |
| 基线提交 | `7a78240` chore: 建立 Git 仓库，导入 mvaigc-canvas 工作副本基线 |
| 最新提交 | `11274be` feat(settings): 隐藏 即梦 Dreamina 与 图床配置 两个设置入口 |

**Tag（按时间）**：

| Tag | 日期 | 指向 | 含义 |
|---|---|---|---|
| `milestone-2026-10-07` | 10-07 | `d3b368b` | 里程碑锚点，出问题回退到这里 |
| `图片节点已经对其` | 10-08 | `492b5f1` | 图片节点尺寸对齐阶段 |
| `图片节点OK` | 10-08 | `51e62a7` | 图片节点验收通过 |
| `视频参考-之前` | 10-09 | `259f89f` | 视频参考改造前的存档 |
| `视频参考-接通未测` | 10-09 | `e81fd38` | 视频参考已接通、**尚未端到端验证** |

> 回退示例：`git reset --hard milestone-2026-10-07`

---

## 2. 已完成的工作（按主题，带提交区间）

### A. 自建反代 mvaigc-proxy（Rust 内置，axum）

`6f78b86` → `7a4d5fd`，后续修复到 `601a896`。

- 设计文档：`docs/superpowers/specs/2026-10-07-mvaigc-proxy-design.md`
- 实施计划：`docs/superpowers/plans/2026-10-07-mvaigc-proxy.md`
- 形态：**Rust 原生内置**（非外挂进程），用户只填账号+密码，端口可配
- 能力：客户端登录与模型列表 → 提交与轮询 → axum HTTP 服务与字段映射 → 随应用启动 → 自动注册图片/视频供应商 → 设置面板
- CLI 测试脚本：`mvaigc-proxy/mvaigc-cli.py` + `mvaigc-proxy/README.md`
- 关键修复：
  - `132591b` 终审修复（token 重登 / 视频请求体 / 空结果 / 图片 operType）
  - `9afcd98` 并发重登竞态导致的偶发 502
  - `1001e28` 支持带参考图/视频的大请求体
  - `601a896` / `e5aa1aa` 参考图先上传 OSS 换成短 URL，修复 `oper_info` 超长 500
  - `bf7fb3f` 默认模型改 Nano-Banana-Pro；修 `@@` 重复引用标记
  - `d364d9d` 真实使用暴露的比例与超时问题

### B. 「生成图片」一体节点

`d9e03ce` → `ecad933`。

- 设计：`docs/superpowers/specs/2026-10-07-generate-image-node-design.md`（已评审）
- 计划：`docs/superpowers/plans/2026-10-07-generate-image-node.md`
- 能力：历史数据模型与旧数据迁移 → 生成完成追加历史并设为主图 → 提交复用节点、count>1 串行入队 → 主图 + 历史面板选主图 → 内嵌提示词面板 + 覆盖/新建生成 → 接入菜单与参考图流程
- 大量尺寸/布局修复（`3e0abe7` → `e12381c`）：面板仅选中时显示、张数下拉 1–4、默认尺寸对齐参考节点 `563x337`、面板宽度 460 与节点宽度解耦、容器查询 `cqw`+`em` 等比缩放、半透明放大按钮

### C. 「生成视频」一体节点

`4436f95` → `10b0d73`。

- 设计：`docs/superpowers/specs/2026-10-08-generate-video-node-design.md`
- 计划：`docs/superpowers/plans/2026-10-08-generate-video-node.md`
- 能力：视频历史数据模型 → 生成落法（覆盖/新建）→ 回填按 entry 写入历史 → 截帧支持时间点（首/当前/尾）→ 参考缩略图排 + 提示词放大 → 视频显示框 + 历史面板 + 截帧工具条 → 迁移接线、菜单改名「生成视频」、导出媒体

### D. 视频节点后续修复与增强

`3c086dc` → `60163bc`。

- 布局：显示框与提示词框按比例分高；`@` 弹窗锚点改相对提示词框；外框只包视频、下方面板移到框外；截帧/预览工具条移到右上角避免被播放条遮挡；截帧节点固定落在视频节点右侧
- 行为：截帧改为产出「生成图片」节点（连线 视频 → 帧）；连入参考时**不再**自动往提示词追加 `@图N`
- 预览：`CanvasNodeImage` 支持单击打开放大预览（`a3b48d3`）；参考小图单击改为放大预览、不再插入 `@图N`（`f7a4eda`）
- 模型：火山方舟预设支持视频/音频参考（`cf9fcf3`）；即梦模型合并为一个条目 + 生成方式标签（`c8b40c3`、`9729aff`）
- 连线：生成视频节点可作为连线起点，接通「生成视频 → 生成视频」（`60163bc`）；生成视频产出可作为另一个生成视频的参考（`828372e`）；参考视频用首帧缩略图、点击放大播放（`d2d7f9f`）

### E. 画布菜单

- `55c4677` 双击菜单把「生成图片 / 生成视频」提到最前

### F. JSON 卡片（文本节点）

- `363013c` 文本节点连入即灌入内容，并支持卡片内直接编辑
- `00b0e50` 编辑态无法退出——NodeHeader 常驻，只切换正文
- `05be782` 自动模式下数组生成真实表格列

### G. 其他 UI 改动

- `c0ad5ee` 标题栏右上角新增「电影技法」按钮（打开 `https://melies.co/cinematic-techniques`）
- `11274be` 设置里隐藏「即梦 Dreamina」「图床配置」两个入口（**面板代码保留**，只去掉左侧导航按钮）

---

## 3. 关键文件落点

| 领域 | 位置 |
|---|---|
| 反代 Rust 实现 | `src-tauri/src/commands/`（网络代理、本地能力） |
| 反代 CLI 工具 | `mvaigc-proxy/mvaigc-cli.py`、`mvaigc-proxy/README.md` |
| 画布 / 节点 / 生成流程 | `src/features/canvas/`（`nodes/`、`ui/`、`application/`） |
| 共享组件与设置页 | `src/components/`（`TitleBar.tsx`、`SettingsDialog.tsx`、`settings/`） |
| i18n | `src/i18n/locales/zh.json`、`en.json` |
| 本项目设计/计划文档 | `docs/superpowers/specs/`、`docs/superpowers/plans/` |

> 查代码走 codebase-memory 索引（项目名见 `../CLAUDE.md`），别整文件 Read。

---

## 4. 怎么验证

```bash
cd mvaigc-canvas

npx tsc --noEmit     # 类型检查
npm test             # 全量测试（当前 758 通过 / 107 测试文件）
npm run tauri dev    # 桌面应用，手动看界面
```

最近一次全量测试：**758/758 通过**（在 `cf40a1d` 提交前跑过）。

---

## 5. 未完成 / 待办

1. **视频参考链路端到端未验证** —— tag `视频参考-接通未测` 即此意。参考视频/音频已写入 `scriptImgToVideo` 请求（`84b16c2`），但**没有跑通过一次真实生成**。
2. **ComfyUI 自定义工作流需要手填「节点绑定」** —— 内置识别只认 `CLIPTextEncode.text` 和 MiniMaxH3；其它提示词节点（如 `CR Prompt Text`）必须在设置 → ComfyUI → 高级 → 「ComfyUI 节点绑定 JSON」里手动写，例如：
   ```json
   {"prompt": {"nodeId": "456", "input": "prompt"}, "images": []}
   ```
3. **`../CLAUDE.md` 不受 git 管理** —— `/Users/spic007/Downloads/07-项目文件/000OD` 不是 git 仓库，该文件的改动无法提交。

---

## 6. 硬性规则速查

- `mvaigc-canvas/` 是唯一工作区；`open-storyboard-canvas/` 只读参照。
- **Camera 相关一律不碰**（除非明确说"这次改 Camera"）。
- 最小实现、外科手术式改动；每行改动可追溯到用户需求；不删没让删的既有代码。
- 看界面**必须自己截图**：`screencapture -x /tmp/shot.png` → `sips` 裁剪 → `Read` 读图。
- 提交流署名：`Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 数据与 API Key 默认存本地。
