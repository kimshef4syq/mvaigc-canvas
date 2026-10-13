# AI4AnimationPy 双足动画移植

本地非商业验证版本。上游代码、预训练网络和人物资产采用 **CC BY-NC 4.0**，不属于项目原有许可证的重新授权范围。发布商业版本前需要另行获得相应授权或替换这些组件。

## 使用

1. 打开导演台的模型库，选择「基础人物」中的 **Geno · AI 动作** 或 **Cranberry**。
2. 切换到「预演台」，选中已加载的 Geno，点击「AI 角色操控」。首次进入会加载两个本地 ONNX 网络。
3. WASD 移动，Shift 加速，Q/E 切换动作风格，右键拖动调整朝向；Esc 退出。风格也可以通过下拉框选择。
4. 将播放头置于要开始录制的时间，点击「录制动作」。以 30 FPS 保存最终根变换和 23 个关节的局部变换；到时间轴末尾自动保存。再次录制替换这个角色的上一段骨骼录制。
5. 退出操控后可拖动时间轴、循环播放，或删除骨骼录制。录制范围内骨骼数据覆盖该角色的路径与姿态轨道。
6. 点击「保存工程」持久化；配置至少两个摄像机关键帧后，使用既有「录制」功能导出 720p / 1080p、24 / 30 FPS 视频或添加到画布。

Cranberry 首版只支持模型展示和场景变换，不使用 Geno 网络。程序化人物及旧 GLTF 人物保持原有行为。此版本未包含任意骨架重定向、四足控制器、碰撞或地形适应。

## 移植边界与数据

- 上游：<https://github.com/facebookresearch/ai4animationpy>，固定提交见 `public/models/ai4animation/manifest.json`。
- 模型文件：Geno、Cranberry 的 GLB 保持不变；骨架定义和上游许可与资产一起归档。
- 主网络：441 维输入，4464 维输出；16 帧、0.5 秒的未来序列，固定三次确定性迭代，每秒预测 10 次。
- 接触网络：456 维输入，64 维输出；4 个足部接触值 × 16 帧。接触值裁剪到 [0,1] 后取三次方。
- 模型内部归一化保留在 ONNX 图中，前端不重复归一化。根增量的 yaw 为角度；Three.js 运算转换为弧度。
- TypeScript 移植轨迹控制、特征拼接、序列解码与混合、骨长/方向恢复、脚踝与脚趾 FABRIK。Three.js 以正交四元数表达姿态，回放采用四元数插值。
- 两个网络按需异步加载、串行推理；渲染采样最近序列，取消后丢弃过期结果并释放推理资源。无需 Python 服务或 Rust 动画后端。
- `BlueprintItem.presetId` 使用 `ai4animation-geno` / `ai4animation-cranberry` 识别模型。`DirectorMotionProjectV1.skeletonRecordings` 是可选字段，旧项目继续可读取。
- 每段录制记录 `modelId`、`skeletonId`、`fps`、`jointNames` 和 `frames`；每帧包含时间、根位置/四元数/缩放及按关节顺序排列的 `xyz + xyzw` 局部变换。
- 导出和随机时间回放直接读取烘焙数据，不重新运行模型。录制正常保存为导演台工程后，随项目数据一起持久化。

## 重建资产

客户端只需要 `public/models/ai4animation/` 和 Vite 打包的 ONNX Runtime WASM/MJS。模型总计约 48.4 MB，两个 GLB 合计约 1.1 MB；另有约 14.2 MB 的 WASM 引擎。

离线重建使用 Python 3.12，在独立虚拟环境中安装 `scripts/ai4animation/requirements-export.txt`。克隆官方仓库并检出脚本中的 `PINNED_REVISION`，然后运行：

```sh
python scripts/ai4animation/export_biped_onnx.py --source /path/to/ai4animationpy
```

脚本核对提交，加载可信的官方 PyTorch checkpoint，导出 opset 17 静态 ONNX，验证模型，执行 PyTorch / ONNX 数值对照，并更新资产 SHA-256 清单与参考测试数据。只从固定官方来源加载 checkpoint；它们使用 Python pickle。

## 验证

```sh
npm test
npm run build
```

`bipedMath.test.ts` 对照 Python 生成的轨迹、完整输入与接触特征、世界坐标解码和足部 IK；`directorSkeletonMotion.test.ts` 验证旧项目兼容、保存恢复、反向时间采样、录制范围覆盖和损坏数据处理。

导出数值报告见 `scripts/ai4animation/fixtures/export-report.json`。本次四组固定输入的最大绝对误差：主网络约 `6.2e-6`、接触网络约 `4.8e-7`，均通过 `atol=1e-4, rtol=1e-4`。

浏览器开发环境检查可使用 Playwright CLI：打开开发地址后执行 `run-code --filename scripts/ai4animation/browser-smoke.js`，再执行 `eval 'window.__neuralSmokeResult'` 查看结果。该检查验证 WASM 数值一致性、持续移动/停止、骨骼有限值及录制回放一致性，不会发起视频生成请求。

性能为设备实测值，并非跨设备保证。当前 Chromium 中预热后的完整网络预测约 5–15 ms，姿态更新峰值约 0.8–1.5 ms；首次加载和编译更慢。运行路径保持单线程 WASM，不要求跨域隔离。

## 本次端到端验收记录

- 全库 115 个测试文件、811 项测试通过，TypeScript 检查、Vite 生产构建和 Tauri macOS debug app 打包通过。
- Chromium：两个 WASM 网络与 Python 固定输入的最大绝对误差分别约 `4.3e-6` / `4.8e-7`；烘焙回放关节误差约 `1.1e-8`。
- 实际界面录制 8 秒 / 241 帧，保存工程后重新打开能恢复骨骼轨道。Geno 和 Cranberry 的蒙皮模型均成功加载。
- 实际导出的 MP4 经 ffprobe 检查为 1280×720、193 个编码帧、约 8.043 秒，平均约 24 FPS；已通过现有入口添加为「导演台参考视频」节点。
- Tauri 打包版（`tauri://localhost`）：本地 GLB 与 ONNX/WASM 加载、角色操控和骨骼录制成功，不依赖 Python 服务。
- 浏览器模式保留现有存储配额：本次较大的撤销历史被原有保护机制跳过，添加视频后触发了原有 session-memory 回退。因此浏览器大型工程/视频的跨会话存储仍受原有配额限制；应及时导出工程或使用桌面版文件存储。本次骨骼工程重新打开和 MP4 文件导出均已独立验证。
