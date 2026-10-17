import * as THREE from 'three';
import type { DirectorSkeletonRecording } from '@/features/canvas/domain/canvasNodes';
import { getMixamoClips, getMixamoDefinition, MixamoSkeletonAdapter, resetMixamoPose } from './mixamoCharacterAssets';

/**
 * Bakes a Mixamo GLB's own animation clip into the shared
 * `DirectorSkeletonRecording` format by stepping an `AnimationMixer` at 30 fps
 * and capturing each bone's local transform per frame. The result flows through
 * the same timeline / recording / playback path as Geno/Cranberry, so no new
 * player or retargeting layer is needed.
 */
export function bakeMixamoMotion(
  group: THREE.Group,
  clipId: string,
  startTime: number,
  projectDuration: number,
): DirectorSkeletonRecording {
  const modelId = group.userData.mixamoModelId as string | undefined;
  const definition = modelId ? getMixamoDefinition(modelId) : null;
  if (!modelId || !definition) throw new Error('请选择一个 Mixamo 人物');
  if (![startTime, projectDuration].every(Number.isFinite) || startTime < 0) throw new Error('动作片段范围无效');

  const clip = getMixamoClips(modelId).find((candidate) => candidate.name === clipId);
  if (!clip) throw new Error('Mixamo 动作不存在');

  const duration = Math.min(clip.duration, projectDuration - startTime);
  if (duration < 1 / 30) throw new Error('时间轴剩余长度不足，请将播放头向前移动');

  resetMixamoPose(group);
  const mixer = new THREE.AnimationMixer(group);
  const action = mixer.clipAction(clip);
  action.play();
  const adapter = new MixamoSkeletonAdapter(group);
  const frames = [];
  for (let i = 0; i <= Math.floor(duration * 30); i += 1) {
    mixer.setTime(i / 30);
    group.updateMatrixWorld(true);
    frames.push(adapter.capture(startTime + i / 30));
  }
  if (frames[frames.length - 1].time < startTime + duration - 1e-8) {
    mixer.setTime(duration);
    group.updateMatrixWorld(true);
    frames.push(adapter.capture(startTime + duration));
  }
  action.stop();
  mixer.uncacheClip(clip);

  return {
    modelId: modelId as `mixamo-${string}`,
    skeletonId: `${modelId}-v1` as `mixamo-${string}`,
    fps: 30,
    jointNames: adapter.jointNames,
    frames,
  };
}
