import { describe, expect, it } from 'vitest';
import type { DirectorSkeletonFrame, DirectorSkeletonRecording } from '../domain/canvasNodes';
import { createEmptyDirectorMotionProject, normalizeDirectorMotionProject, sampleDirectorMotion } from './directorMotion';
import { normalizeSkeletonRecordings, sampleSkeletonRecording } from './directorSkeletonMotion';
import meta from '../../../../public/models/ai4animation/locomotion_biped_meta.json';
const frame = (time: number, x: number, rotation = [0, 0, 0, 1]): DirectorSkeletonFrame => ({ time, rootPosition: [x, 0, 0], rootRotation: rotation, rootScale: [1, 1, 1], joints: Array.from({ length: 23 }, () => [x, 0, 0, ...rotation]).flat() });
const recording = (): DirectorSkeletonRecording => ({ modelId: 'ai4animation-geno', skeletonId: 'geno-biped-23-v1', fps: 30, jointNames: meta.jointNames, frames: [frame(1, 2), frame(2, 4, [0, 1, 0, 0])] });
describe('baked director skeleton motion', () => {
  it('round trips without mutating the source and supports backwards random seeks', () => {
    const source = { ...createEmptyDirectorMotionProject(), skeletonRecordings: { actor: recording() } };
    const normalized = normalizeDirectorMotionProject(JSON.parse(JSON.stringify(source)));
    expect(normalized.skeletonRecordings).toEqual(source.skeletonRecordings);
    const clip = normalized.skeletonRecordings!.actor;
    expect(sampleSkeletonRecording(clip, 1.5)?.rootPosition).toEqual([3, 0, 0]);
    expect(sampleSkeletonRecording(clip, 2)?.rootPosition).toEqual([4, 0, 0]);
    expect(sampleSkeletonRecording(clip, 1)?.rootPosition).toEqual([2, 0, 0]);
    expect(sampleSkeletonRecording(clip, 0.9)).toBeNull();
    expect(sampleSkeletonRecording(clip, 2.1)).toBeNull();
    expect(Math.hypot(...sampleSkeletonRecording(clip, 1.5)!.rootRotation)).toBeCloseTo(1);
  });
  it('lets recorded roots and joints own only the recorded range', () => {
    const project = { ...createEmptyDirectorMotionProject(), skeletonRecordings: { actor: recording() } };
    const actor = { id: 'actor', label: 'Geno', category: 'person' as const, presetId: 'ai4animation-geno', color: '#fff', x: 0, y: 0, pos3d: { x: 9, y: 0, z: 0 } };
    expect(sampleDirectorMotion(project, 1.5, [actor]).objects.actor.position.x).toBe(3);
    expect(sampleDirectorMotion(project, 1.5, [actor]).skeletons?.actor.frame.joints[0]).toBe(3);
    expect(sampleDirectorMotion(project, 0, [actor]).objects.actor.position.x).toBe(9);
    expect(sampleDirectorMotion(project, 1.5, [{ ...actor, presetId: 'ai4animation-cranberry' }]).skeletons).toBeUndefined();
  });
  it('preserves an interpolated final pose when the timeline is shortened between samples', () => {
    const shortened = normalizeSkeletonRecordings({ actor: recording() }, 1.5).actor;
    expect(shortened.frames.map(f => f.time)).toEqual([1, 1.5]);
    expect(sampleSkeletonRecording(shortened, 1.5)?.rootPosition).toEqual([3, 0, 0]);
  });
  it('rejects malformed skeletons, nonfinite joints, invalid quaternions and duplicate times', () => {
    const clip = recording();
    expect(normalizeSkeletonRecordings({ actor: { ...clip, jointNames: ['Hips'] } }, 8)).toEqual({});
    const bad = recording(); bad.frames[1].joints[0] = NaN;
    expect(normalizeSkeletonRecordings({ actor: bad }, 8)).toEqual({});
    const zero = recording(); zero.frames[1].rootRotation = [0, 0, 0, 0];
    expect(normalizeSkeletonRecordings({ actor: zero }, 8)).toEqual({});
    expect(normalizeSkeletonRecordings({ actor: { ...clip, frames: [clip.frames[0], clip.frames[0]] } }, 8)).toEqual({});
    expect(normalizeDirectorMotionProject(undefined).skeletonRecordings).toBeUndefined();
  });
  it('accepts Mixamo recordings with the model\'s own variable-length skeleton', () => {
    const mixamoFrame = (time: number, x: number): DirectorSkeletonFrame => ({ time, rootPosition: [x, 0, 0], rootRotation: [0, 0, 0, 1], rootScale: [1, 1, 1], joints: Array.from({ length: 5 }, () => [0, 0, 0, 0, 0, 0, 1]).flat() });
    const mixamo: DirectorSkeletonRecording = { modelId: 'mixamo-vanguard', skeletonId: 'mixamo-vanguard-v1', fps: 30, jointNames: ['mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Head', 'mixamorig:LeftHand', 'mixamorig:RightHand'], frames: [mixamoFrame(1, 2), mixamoFrame(2, 4)] };
    const normalized = normalizeSkeletonRecordings({ actor: mixamo }, 8);
    expect(normalized.actor?.jointNames.length).toBe(5);
    expect(normalized.actor?.frames.length).toBe(2);
    expect(sampleSkeletonRecording(normalized.actor, 1.5)?.rootPosition).toEqual([3, 0, 0]);
    // malformed: zero-length quaternion in a joint is rejected
    const bad = { ...mixamo, frames: [{ ...mixamo.frames[0], joints: [0, 0, 0, 0, 0, 0, 0] }, mixamo.frames[1]] };
    expect(normalizeSkeletonRecordings({ actor: bad }, 8)).toEqual({});
  });
  it('supports Cranberry skeleton recordings with matching presetId', () => {
    const cranRecording: DirectorSkeletonRecording = {
      modelId: 'ai4animation-cranberry',
      skeletonId: 'cranberry-biped-23-v1',
      fps: 30,
      jointNames: meta.jointNames,
      frames: [frame(1, 5), frame(2, 7)]
    };
    const project = { ...createEmptyDirectorMotionProject(), skeletonRecordings: { actor: cranRecording } };
    const actor = { id: 'actor', label: 'Cranberry', category: 'person' as const, presetId: 'ai4animation-cranberry', color: '#fff', x: 0, y: 0, pos3d: { x: 0, y: 0, z: 0 } };
    const sampled = sampleDirectorMotion(project, 1.5, [actor]);
    expect(sampled.skeletons?.actor.frame.rootPosition[0]).toBe(6);
  });
  it('supports 53-joint full body and hand skeleton recordings persistence and JSON serialization', async () => {
    const { CRANBERRY_HAND_SKELETON_JOINT_NAMES } = await import('../domain/directorHandPose');
    const f1: DirectorSkeletonFrame = {
      time: 0,
      rootPosition: [0, 0, 0],
      rootRotation: [0, 0, 0, 1],
      rootScale: [1, 1, 1],
      joints: Array.from({ length: 53 * 7 }, (_, i) => i % 7 === 6 ? 1 : 0),
      jointBases: Array.from({ length: 53 * 9 }, (_, i) => (i % 9 === 0 || i % 9 === 4 || i % 9 === 8) ? 1 : 0),
    };
    const f2: DirectorSkeletonFrame = {
      time: 2,
      rootPosition: [1, 0, 2],
      rootRotation: [0, 0.7071, 0, 0.7071],
      rootScale: [1, 1, 1],
      joints: Array.from({ length: 53 * 7 }, (_, i) => i % 7 === 6 ? 1 : 0),
      jointBases: Array.from({ length: 53 * 9 }, (_, i) => (i % 9 === 0 || i % 9 === 4 || i % 9 === 8) ? 1 : 0),
    };
    const recording53: DirectorSkeletonRecording = {
      modelId: 'ai4animation-cranberry',
      skeletonId: 'cranberry-biped-hands-53-v2',
      fps: 30,
      jointNames: [...CRANBERRY_HAND_SKELETON_JOINT_NAMES],
      frames: [f1, f2],
    };
    const project = { ...createEmptyDirectorMotionProject(), skeletonRecordings: { actor53: recording53 } };
    const serialized = JSON.stringify(project);
    const restored = normalizeDirectorMotionProject(JSON.parse(serialized));
    expect(restored.skeletonRecordings?.actor53.jointNames.length).toBe(53);
    expect(restored.skeletonRecordings?.actor53.modelId).toBe('ai4animation-cranberry');
    expect(restored.skeletonRecordings?.actor53.skeletonId).toBe('cranberry-biped-hands-53-v2');
    expect(restored.skeletonRecordings?.actor53.frames[1].jointBases?.length).toBe(53 * 9);
    const sampled = sampleSkeletonRecording(restored.skeletonRecordings!.actor53, 1);
    expect(sampled?.rootPosition).toEqual([0.5, 0, 1]);
  });
});

