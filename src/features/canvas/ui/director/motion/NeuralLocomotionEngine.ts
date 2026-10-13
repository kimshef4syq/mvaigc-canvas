// Adapted from Meta AI4AnimationPy Biped/Program.py (CC BY-NC 4.0).
// See public/models/ai4animation/LICENSE.txt and manifest.json.
import * as THREE from 'three';
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import { assembleFeatures, clonePose, contactFeatures, decodeSequence, mixPose, restPose, sampleSequence, TrajectoryPlanner, type TrajectorySample } from './bipedMath';
import { BipedIK } from './bipedIK';
import { NEURAL_ASSET_BASE, type BipedMeta, type BipedPose, type BipedSequence, type MotionControl } from './types';

export class NeuralLocomotionEngine {
  private network: ort.InferenceSession | null = null;
  private contacts: ort.InferenceSession | null = null;
  meta!: BipedMeta;
  pose!: BipedPose;
  private planner!: TrajectoryPlanner;
  private ik!: BipedIK;
  private previous: BipedSequence | null = null;
  private sequence: BipedSequence | null = null;
  private wallTime = 0;
  private animationTime = 0;
  private predictedAt = -Infinity;
  private blendStartedAt = 0;
  private timescale = 1;
  private synchronization = 0;
  private disposed = false;
  private initializing = true;
  private pending: Promise<void> | null = null;
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
      this.meta = meta; this.pose = restPose(meta);
      this.planner = new TrajectoryPlanner(meta.sequenceLength, meta.sequenceWindow);
      this.ik = new BipedIK(meta, this.pose);
      this.network = await ort.InferenceSession.create(`${NEURAL_ASSET_BASE}locomotion_biped.onnx`, { executionProviders: ['wasm'] });
      if (this.disposed) throw new Error('动作加载已取消');
      this.contacts = await ort.InferenceSession.create(`${NEURAL_ASSET_BASE}contacts_biped.onnx`, { executionProviders: ['wasm'] });
      if (this.disposed) throw new Error('动作加载已取消');
      await this.predict('Idle');
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
  private correctedTrajectory(): TrajectorySample[] {
    if (!this.sequence) return this.planner.samples;
    const samples = this.planner.samples.map((s, i) => {
      const predicted = this.sequence!.frames[i];
      return { position: s.position.clone().lerp(predicted.rootPosition, 0.25), rotation: s.rotation.clone().slerp(predicted.rootRotation, 0.25), velocity: s.velocity.clone() };
    });
    samples.forEach((sample, i) => {
      const total = new THREE.Vector3(); let time = 0;
      for (let j = i; j < samples.length; j++) { total.add(samples[j].position.clone().sub(this.pose.rootPosition)); time += j * this.meta.sequenceWindow / 15; }
      const target = time > 0 ? total.divideScalar(time) : new THREE.Vector3();
      // Sequence root velocities use per-frame root delta at 30 Hz.
      sample.velocity.copy(target).lerp(this.sequence!.frames[i].rootVelocity ?? new THREE.Vector3(), 0.25);
    });
    return samples;
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
  private async predict(style: string) {
    const started = performance.now(), state = clonePose(this.pose), sampledAt = this.animationTime;
    const features = assembleFeatures(state, this.correctedTrajectory(), this.meta.guidances[style] ?? this.meta.guidances.Neutral, this.meta.models.locomotion_biped.inputDim);
    const output = await this.run(this.network!, features, this.meta.models.locomotion_biped.outputDim);
    if (this.disposed) return;
    const sequence = decodeSequence(output, state, this.meta, sampledAt);
    const contacts = await this.run(this.contacts!, contactFeatures(features, state, sequence, this.meta), this.meta.models.contacts_biped.outputDim);
    if (this.disposed) return;
    sequence.frames.forEach((frame, i) => { frame.contacts = Array.from(contacts.slice(i * 4, i * 4 + 4), v => THREE.MathUtils.clamp(v, 0, 1) ** 3); });
    this.previous = this.sequence ?? sequence;
    this.sequence = sequence;
    this.blendStartedAt = this.wallTime;
    this.lastInferenceMs = performance.now() - started;
  }
  update(control: MotionControl, delta: number): BipedPose {
    if (this.disposed || this.error) return this.pose;
    const dt = THREE.MathUtils.clamp(delta, 0, 0.05);
    this.wallTime += dt;
    const position = this.planner.samples[0].position.clone().lerp(this.pose.rootPosition, this.synchronization);
    this.planner.update(position, control.direction, control.velocity, dt);
    if (!this.pending && this.wallTime - this.predictedAt >= 1 / this.meta.predictionFps) {
      this.predictedAt = this.wallTime;
      this.pending = this.predict(control.velocity.length() < 0.1 ? 'Idle' : control.style)
        .catch(error => { if (!this.disposed) this.error = error instanceof Error ? error : new Error(String(error)); })
        .finally(() => { this.pending = null; });
    }
    if (!this.sequence || !this.previous) return this.pose;
    const length = (points: THREE.Vector3[]) => points.slice(1).reduce((sum, v, i) => sum + v.distanceTo(points[i]), 0);
    const required = (this.pose.rootPosition.distanceTo(this.planner.samples[0].position) + length(this.planner.samples.map(s => s.position))) / this.meta.sequenceWindow;
    const predicted = length(this.sequence.frames.map(s => s.rootPosition)) / this.meta.sequenceWindow;
    const moving = required > 0.1 && predicted > 0.1;
    const smooth = 1 - Math.exp(-dt * 5);
    this.timescale = THREE.MathUtils.clamp(THREE.MathUtils.lerp(this.timescale, moving ? required / predicted : 1, smooth), 1, 1.5);
    this.synchronization = THREE.MathUtils.lerp(this.synchronization, moving ? 1 : 0, smooth);
    const sdt = dt * this.timescale;
    this.animationTime += sdt;
    const next = mixPose(sampleSequence(this.previous, this.animationTime, this.meta.sequenceWindow), sampleSequence(this.sequence, this.animationTime, this.meta.sequenceWindow), (this.wallTime - this.blendStartedAt) * this.meta.predictionFps);
    if (this.sequence.frames.reduce((sum, frame) => sum + frame.contacts.reduce((a, b) => a + b, 0), 0) / (this.meta.sequenceLength * 4) > 0.75) { next.rootPosition.copy(this.pose.rootPosition); next.rootRotation.copy(this.pose.rootRotation); }
    next.positions.forEach((p, i) => p.lerp(this.pose.positions[i].clone().addScaledVector(next.velocities[i], sdt), 0.5));
    this.ik.restore(next);
    this.ik.solve(next);
    this.pose = next;
    return next;
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    await this.pending;
    // Initialization owns its in-flight session creation and prediction.
    if (!this.initializing) await this.releaseSessions();
  }
}
