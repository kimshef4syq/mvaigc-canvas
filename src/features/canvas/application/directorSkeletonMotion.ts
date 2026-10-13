import * as THREE from 'three';
import type { DirectorSkeletonFrame, DirectorSkeletonRecording } from '../domain/canvasNodes';

export function normalizeSkeletonRecordings(value: unknown, duration: number): Record<string, DirectorSkeletonRecording> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, DirectorSkeletonRecording> = {};
  Object.entries(value).forEach(([id, raw]) => {
    if (!raw || typeof raw !== 'object') return;
    const r = raw as Partial<DirectorSkeletonRecording>;
    if (r.modelId !== 'ai4animation-geno' || r.skeletonId !== 'geno-biped-23-v1' || r.fps !== 30 || !Array.isArray(r.jointNames) || r.jointNames.length !== 23 || new Set(r.jointNames).size !== 23 || !r.jointNames.every(n => typeof n === 'string' && n.length > 0) || !Array.isArray(r.frames)) return;
    const vector = (v: unknown, size: number): v is number[] => Array.isArray(v) && v.length === size && v.every(n => typeof n === 'number' && Number.isFinite(n));
    const validQuaternion = (v: number[], offset = 0) => Math.hypot(...v.slice(offset, offset + 4)) > 1e-6;
    const frames = r.frames.slice(0, 902).filter(f => f && typeof f.time === 'number' && Number.isFinite(f.time) && f.time >= 0 && f.time <= 30 && vector(f.rootPosition, 3) && vector(f.rootRotation, 4) && validQuaternion(f.rootRotation) && vector(f.rootScale, 3) && f.rootScale.every(n => n > 0) && vector(f.joints, 23 * 7) && Array.from({ length: 23 }, (_, i) => validQuaternion(f.joints, i * 7 + 3)).every(Boolean)).sort((a, b) => a.time - b.time);
    const unique = frames.filter((f, i) => !i || f.time > frames[i - 1].time);
    const trimmed = unique.filter(f => f.time <= duration);
    if (unique.length > 1 && trimmed.length && unique[unique.length - 1].time > duration && trimmed[trimmed.length - 1].time < duration) {
      const end = sampleSkeletonRecording({ modelId: r.modelId, skeletonId: r.skeletonId, fps: 30, jointNames: r.jointNames, frames: unique }, duration);
      if (end) trimmed.push(end);
    }
    if (trimmed.length > 1) result[id] = { modelId: r.modelId, skeletonId: r.skeletonId, fps: 30, jointNames: [...r.jointNames], frames: trimmed.map(f => ({ time: f.time, rootPosition: [...f.rootPosition], rootRotation: [...f.rootRotation], rootScale: [...f.rootScale], joints: [...f.joints] })) };
  });
  return result;
}
export function sampleSkeletonRecording(recording: DirectorSkeletonRecording, time: number): DirectorSkeletonFrame | null {
  const frames = recording.frames;
  if (!frames.length || time < frames[0].time || time > frames[frames.length - 1].time) return null;
  let low = 0, high = frames.length - 1;
  while (low < high) { const mid = Math.floor((low + high) / 2); if (frames[mid].time < time) low = mid + 1; else high = mid; }
  const b = frames[low], a = frames[Math.max(0, low - 1)];
  const t = a.time === b.time ? 0 : (time - a.time) / (b.time - a.time);
  const vector = (x: number[], y: number[]) => x.map((v, i) => THREE.MathUtils.lerp(v, y[i], t));
  const quaternion = (x: number[], y: number[]) => new THREE.Quaternion().fromArray(x).normalize().slerp(new THREE.Quaternion().fromArray(y).normalize(), t).toArray();
  const joints: number[] = [];
  recording.jointNames.forEach((_, i) => { const offset = i * 7; joints.push(...vector(a.joints.slice(offset, offset + 3), b.joints.slice(offset, offset + 3)), ...quaternion(a.joints.slice(offset + 3, offset + 7), b.joints.slice(offset + 3, offset + 7))); });
  return { time, rootPosition: vector(a.rootPosition, b.rootPosition), rootRotation: quaternion(a.rootRotation, b.rootRotation), rootScale: vector(a.rootScale, b.rootScale), joints };
}
