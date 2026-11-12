# Spec: director-previs（3D 导演台与预演动画系统）

> **状态**：Approved（现行基线）  
> **所属模块 ID**：`director-previs`（见 [CAPABILITY-MAP.md](CAPABILITY-MAP.md)）  
> **关联 PRD**：[PRD-mvaigc-canvas-v2.md](../prd/PRD-mvaigc-canvas-v2.md)  
> **使用说明**：[director-previsualization.md](../director-previsualization.md)  
> **最后更新**：2026-11-12

---

## 1. Objective（目标与职责）

在 `blueprintNode`（导演台）与独立预演工作区中，提供基于 Three.js 的 3D 空间布景、角色姿态/骨骼动作、全景背景导入、摄影机跟拍/运镜关键帧时间轴，以及预演视频录制导出与构图截图回传画布能力。

## 2. Tech Stack & Interfaces（技术栈与边界契约）

- **3D 渲染**：`three`（`@types/three`）+ `DirectorSceneErrorBoundary`（单场景渲染异常隔离，防止拖垮主画布）。
- **核心动作与时间轴契约**（[src/features/canvas/application/directorMotion.ts](../../src/features/canvas/application/directorMotion.ts)）：
  - `DIRECTOR_MOTION_SCHEMA_VERSION = 1`
  - 时长范围：`DIRECTOR_MOTION_MIN_DURATION_SECONDS = 0.5` ~ `DIRECTOR_MOTION_MAX_DURATION_SECONDS = 30`（默认 `8` 秒）
  - 采样结构：`SampledDirectorMotionFrame`（`time`, `camera: SampledDirectorCameraState | null`, `objects`, `actions`, `skeletons`）
- **子域能力**：
  - 骨骼与手部姿态：`directorSkeletonMotion.ts`、`directorHandPose.ts`、`BlueprintPoseEditor.tsx`
  - 全景背景导入：`directorStudioPanoramaImport.ts`
  - 视频录制导出：`directorVideoRecording.ts`、`DirectorVideoExportDialog.tsx`

## 3. Commands（验证命令）

```bash
npx tsc --noEmit
npm test -- src/features/canvas/application/directorMotion.test.ts src/features/canvas/application/directorSkeletonMotion.test.ts src/features/canvas/application/directorHandChannels.test.ts src/features/canvas/application/directorVideoRecording.test.ts src/features/canvas/ui/DirectorSceneErrorBoundary.test.ts src/features/canvas/ui/BlueprintScene.test.ts
```

## 4. Project Structure & Code Style（目录落点）

- `src/features/canvas/nodes/BlueprintNode.tsx`：导演台画布节点入口
- `src/features/canvas/application/director*.ts` & `blueprintPrompt.ts`：关键帧插值、骨骼采样、录制与提示词反推
- `src/features/canvas/domain/director*.ts` & `blueprintPresetCatalog.ts`：人体控制、手势与预设目录
- `src/features/canvas/ui/Director*.tsx` & `Blueprint*.tsx`：预演工作区壳层、时间轴、动作库与 3D 场景组件

## 5. Testing Strategy（测试策略）

- 重点对关键帧插值、骨骼录制采样、手部通道映射、录制时长同步、网格工厂与 ErrorBoundary 进行 Vitest 单元测试。

## 6. Boundaries（三层边界）

- **Always**：
  - WebGL / Three.js 场景必须被 `DirectorSceneErrorBoundary` 包裹并正确释放几何体/纹理资源。
  - 录制时长必须与时间轴项目时长对齐，且兼容浏览器预览态降级。
- **Ask first**：修改 `DIRECTOR_MOTION_SCHEMA_VERSION` 或 `DirectorMotionProjectV1` 持久化格式。
- **Never**：在未释放 Three.js 资源的情况下反复重建渲染器；在纯浏览器模式调用桌面专属保存接口。

## 7. Success Criteria（完成标准）

- [x] 支持人物/道具/灯光/摄影机关键帧编排、跟拍锁定与预演视频导出。
- [x] 单个导演台 3D 异常不会导致画布整体崩溃。
- [x] 导演台与预演相关单元测试与 `tsc --noEmit` 全部通过。

