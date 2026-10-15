// Adapted from Meta AI4AnimationPy Biped/Program.py (CC BY-NC 4.0).
// See public/models/ai4animation/LICENSE.txt and manifest.json.
import * as THREE from 'three';
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import { contactFeatures, decodeSequence } from './bipedMath';
import { BipedController } from './BipedController';
import { NEURAL_ASSET_BASE, type BipedMeta, type BipedPose, type MotionControl } from './types';

export class NeuralLocomotionEngine {
  private network: ort.InferenceSession | null = null;
  private contacts: ort.InferenceSession | null = null;
  meta!: BipedMeta;
  private controller!: BipedController;
  get pose(): BipedPose { return this.controller.pose; }
  private disposed = false;
  private initializing = true;
  private pending: Promise<BipedPose> | null = null;
  lastInferenceMs = 0;
  error: Error | null = null;

  async initialize() {
    try {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl };
      const response = await fetch(`${NEURAL_ASSET_BASE}locomotion_biped_meta.json`);
      if (!response.ok) throw new Error(`动作配置加载失败 (${response.status})`);
      const meta = await response.json() as BipedMeta;
      if (meta.schemaVersion !== 1 || meta.normalization !== 'embedded' || meta.jointNames.length !== 23 || meta.sequenceLength !== 16) throw new Error('不兼容的双足模型配置');
      this.meta = meta; this.controller = new BipedController(meta);
      this.network = await ort.InferenceSession.create(`${NEURAL_ASSET_BASE}locomotion_biped.onnx`, { executionProviders: ['wasm'] });
      if (this.disposed) throw new Error('动作加载已取消');
      this.contacts = await ort.InferenceSession.create(`${NEURAL_ASSET_BASE}contacts_biped.onnx`, { executionProviders: ['wasm'] });
      if (this.disposed) throw new Error('动作加载已取消');
    } catch (error) {
      await this.releaseSessions();
      throw error;
    } finally {
      this.initializing = false;
      if (this.disposed) await this.releaseSessions();
    }
  }
  private async releaseSessions() {
    const network = this.network, contacts = this.contacts;
    this.network = null; this.contacts = null;
    await network?.release(); await contacts?.release();
  }
  private async run(session: ort.InferenceSession, input: Float32Array, expected: number): Promise<Float32Array> {
    const tensor = new ort.Tensor('float32', input, [1, input.length]);
    let outputs: Record<string, ort.Tensor> | undefined;
    try {
      outputs = await session.run({ features: tensor });
      const values = new Float32Array(outputs.prediction.data as Float32Array);
      if (values.length !== expected || !values.every(Number.isFinite)) throw new Error('动作模型输出无效');
      return values;
    } finally {
      tensor.dispose();
      if (outputs) Object.values(outputs).forEach(t => t.dispose());
    }
  }
  async step(control: MotionControl, delta: number): Promise<BipedPose> {
    if (this.disposed || this.error) return this.pose;
    if (this.pending) throw new Error('角色控制器不支持并发步进');
    this.pending = this.advance(control, THREE.MathUtils.clamp(delta, 0, 0.05));
    try { return await this.pending; }
    catch(error) { this.error = error instanceof Error ? error : new Error(String(error)); throw this.error; }
    finally { this.pending = null; }
  }
  private async advance(control: MotionControl, dt: number): Promise<BipedPose> {
    this.controller.control(control, dt);
    if (this.controller.needsPrediction()) {
      const started = performance.now(), state = this.controller.snapshot();
      const features = this.controller.features(control);
      const output = await this.run(this.network!, features, this.meta.models.locomotion_biped.outputDim);
      if (this.disposed) return this.pose;
      const sequence = decodeSequence(output, state, this.meta, 0);
      const contacts = await this.run(this.contacts!, contactFeatures(features, state, sequence, this.meta), this.meta.models.contacts_biped.outputDim);
      if (this.disposed) return this.pose;
      sequence.frames.forEach((frame, i) => { frame.contacts = Array.from(contacts.slice(i * 4, i * 4 + 4), v => THREE.MathUtils.clamp(v, 0, 1) ** 3); });
      this.controller.publish(sequence);
      this.lastInferenceMs = performance.now() - started;
    }
    return this.disposed ? this.pose : this.controller.animate(dt);
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    await this.pending?.catch(() => undefined);
    // Initialization owns its in-flight session creation and prediction.
    if (!this.initializing) await this.releaseSessions();
  }
}
