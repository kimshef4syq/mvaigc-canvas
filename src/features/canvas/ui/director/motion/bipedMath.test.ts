import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import metaJson from '../../../../../../public/models/ai4animation/locomotion_biped_meta.json';
import reference from '../../../../../../scripts/ai4animation/fixtures/controller-reference.json';
import { assembleFeatures, contactFeatures, decodeSequence, matrixFromRows, restPose, sampleSequence, TrajectoryPlanner } from './bipedMath';
import { BipedIK } from './bipedIK';
import type { BipedMeta } from './types';
const meta = metaJson as BipedMeta;
const error = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

describe('AI4AnimationPy reference parity', () => {
  it('matches the Python trajectory and complete 441-feature layout', () => {
    const planner = new TrajectoryPlanner();
    for (let i = 0; i < 12; i++) planner.update(planner.samples[0].position.clone(), new THREE.Vector3(0.3, 0, 1), new THREE.Vector3(0.3, 0, 1), 1 / 60);
    planner.samples.forEach((sample, i) => {
      expect(sample.position.distanceTo(new THREE.Vector3().setFromMatrixPosition(matrixFromRows(reference.trajectoryMatrices[i])))).toBeLessThan(1e-5);
      expect(error(sample.velocity.toArray(), reference.trajectoryVelocities[i])).toBeLessThan(1e-5);
    });
    const features = assembleFeatures(restPose(meta), planner.samples, meta.guidances.Neutral, 441);
    expect(error(Array.from(features), reference.features)).toBeLessThan(1e-5);
  });
  it('decodes all 16 future frames in the Python world coordinate convention', () => {
    const sequence = decodeSequence(Float32Array.from(reference.prediction), restPose(meta), meta, 0);
    sequence.frames.forEach((frame, i) => {
      expect(frame.rootPosition.distanceTo(new THREE.Vector3().setFromMatrixPosition(matrixFromRows(reference.rootMatrices[i])))).toBeLessThan(1e-6);
      frame.positions.forEach((v, j) => expect(v.distanceTo(new THREE.Vector3().setFromMatrixPosition(matrixFromRows(reference.motionMatrices[i][j])))).toBeLessThan(1e-5));
      frame.velocities.forEach((v, j) => expect(error(v.toArray(), reference.velocities[i][j])).toBeLessThan(1e-5));
    });
    const contacts = contactFeatures(Float32Array.from(reference.features), restPose(meta), sequence, meta);
    expect(contacts).toHaveLength(456);
    expect(error(Array.from(contacts), reference.contactFeatures)).toBeLessThan(0.002);
    expect(sampleSequence(sequence, -1, 0.5).rootPosition.toArray()).toEqual(sequence.frames[0].rootPosition.toArray());
    expect(sampleSequence(sequence, 1, 0.5).rootPosition.toArray()).toEqual(sequence.frames[15].rootPosition.toArray());
  });
  it('restores bone lengths and solves ankle/toe contacts close to the reference', () => {
    const initial = restPose(meta), ik = new BipedIK(meta, initial);
    const frame = decodeSequence(Float32Array.from(reference.prediction), initial, meta, 0).frames[1];
    frame.contacts = [0.8, 0.6, 0.7, 0.4]; ik.restore(frame);
    ik.solve(frame);
    const maxDistance = Math.max(...frame.positions.map((v, i) => v.distanceTo(new THREE.Vector3().fromArray(reference.ikPositions[i]))));
    expect(maxDistance).toBeLessThan(0.002);
  });
});
