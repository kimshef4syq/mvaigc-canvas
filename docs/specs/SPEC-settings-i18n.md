# Spec: settings-i18n（应用设置、主题与双语本地化）

> **状态**：Approved（现行基线）  
> **所属模块 ID**：`settings-i18n`（见 [CAPABILITY-MAP.md](CAPABILITY-MAP.md)）  
> **关联 PRD**：[PRD-mvaigc-canvas-v2.md](../prd/PRD-mvaigc-canvas-v2.md)  
> **最后更新**：2026-11-12

---

## 1. Objective（目标与职责）

统一管理应用级用户偏好、供应商 API 凭据、内置服务端口（如 `mvaigc-proxy`）、网络路由策略（系统代理 / 直连 / 自定义代理）、画布鼠标交互预设、主题外观以及中英文（`zh` / `en`）国际化运行时。

## 2. Tech Stack & Interfaces（技术栈与边界契约）

- **状态管理**：`zustand` + `persist` 中间件（持久化介质：`resilientLocalStorage`）。
- **国际化**：`i18next` + `react-i18next` + `i18next-browser-languagedetector`。
- **核心类型与导出**（[src/stores/settingsStore.ts](../../src/stores/settingsStore.ts)）：
  - `ProviderApiKeys` (`Record<string, string>`)
  - `GenerationNetworkRoute` (`'system' | 'direct' | 'custom-proxy'`) & `GenerationNetworkSettings`
  - `CanvasMouseBindingPreset` (`'default' | 'traditional' | 'custom'`) & `CanvasMouseBindings`
  - `AudioProviderKind` (`'local-doubao-tts' | 'gradio-voxcpm' | 'comfyui'`) & `AudioOutputMode` (`'server' | 'segmented'`)
  - `ImageHostProvider` (`'pixhost' | 'seedvault'`)
  - `DEFAULT_MVAIGC_PORT` / `normalizeMvaigcPort`（[src/features/settings/mvaigcSettings.ts](../../src/features/settings/mvaigcSettings.ts)）
- **i18n 初始化**（[src/i18n/index.ts](../../src/i18n/index.ts)）：
  - 语言资源：`src/i18n/locales/zh.json`、`src/i18n/locales/en.json`
  - 默认回退语言：`fallbackLng: 'zh'`，检测顺序 `['localStorage', 'navigator']`。

## 3. Commands（验证命令）

```bash
npx tsc --noEmit
npm test -- src/stores/settingsStore.test.ts src/features/settings/mvaigcSettings.test.ts src/features/settings/externalAgentSettings.test.ts
```

## 4. Project Structure & Code Style（目录落点）

- `src/stores/settingsStore.ts`：全局设置状态（唯一设置真相源）
- `src/stores/themeStore.ts` & `src/stores/homeAppearanceStore.ts`：主题与主页外观状态
- `src/features/settings/`：各专项设置规范化辅助函数与提示组件（`mvaigcSettings.ts`、`externalAgentSettings.ts`、`MissingApiKeyHint.tsx`）
- `src/features/theme/skinPresets.ts`：皮肤预设定义
- `src/i18n/`：语言包与 i18n 实例配置

## 5. Testing Strategy（测试策略）

- 对端口归一化、外部 Agent 路径规范化、设置持久化反序列化兼容进行 Vitest 单元测试（`settingsStore.test.ts`、`mvaigcSettings.test.ts`、`externalAgentSettings.test.ts`）。

## 6. Boundaries（三层边界）

- **Always**：
  - 所有用户可见文本必须通过 `useTranslation()` + `t('key')` 渲染，并同步维护 `zh.json` 与 `en.json`。
  - 新增设置项必须提供默认值与旧版持久化数据兼容归一化逻辑。
- **Ask first**：修改设置持久化键名或变更凭据存储结构。
- **Never**：在日志、错误提示或默认导出配置中明文输出 `ProviderApiKeys` 或代理密码。

## 7. Success Criteria（完成标准）

- [x] `zh` / `en` 语言切换实时生效且无缺失键回退异常。
- [x] 旧版本 `localStorage` 配置升级后不丢失已有供应商设置与快捷键偏好。
- [x] 相关单元测试与 `tsc --noEmit` 全部通过。

