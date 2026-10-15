// Ported from AI4AnimationPy Math/Transform, RootModule.Series and Biped/Sequence.
// Upstream CC BY-NC 4.0. See public/models/ai4animation/LICENSE.txt.
import * as THREE from 'three';
import type { BipedMeta, BipedPose, BipedSequence } from './types';

const UP = new THREE.Vector3(0, 1, 0);
export const poseBasis = (pose: BipedPose, i: number) => pose.rotationBases?.[i] ?? new THREE.Matrix4().makeRotationFromQuaternion(pose.rotations[i]);
export function normalizeBasis(matrix: THREE.Matrix4): THREE.Matrix4 {
  const y = new THREE.Vector3().setFromMatrixColumn(matrix, 1).normalize();
  const z = new THREE.Vector3().setFromMatrixColumn(matrix, 2).normalize();
  return new THREE.Matrix4().makeBasis(y.clone().cross(z), y, z);
}
export function mixBasis(a: THREE.Matrix4, b: THREE.Matrix4, weight: number): THREE.Matrix4 {
  const matrix = a.clone(); matrix.elements.forEach((v, i) => { matrix.elements[i] = THREE.MathUtils.lerp(v, b.elements[i], weight); });
  return normalizeBasis(matrix);
}
/** Match upstream Shepperd conversion; Three's trace branch differs for non-orthogonal bases. */
export function basisQuaternion(m: THREE.Matrix4): THREE.Quaternion {
  const e=m.elements, candidates=[1+e[0]+e[5]+e[10],1+e[0]-e[5]-e[10],1-e[0]+e[5]-e[10],1-e[0]-e[5]+e[10]];
  const pivot=candidates.indexOf(Math.max(...candidates)), s=Math.max(2*Math.sqrt(Math.max(candidates[pivot],0)),1e-5);
  const q = pivot===0 ? [ (e[6]-e[9])/s,(e[8]-e[2])/s,(e[1]-e[4])/s,s/4 ]
    : pivot===1 ? [s/4,(e[4]+e[1])/s,(e[8]+e[2])/s,(e[6]-e[9])/s]
    : pivot===2 ? [(e[4]+e[1])/s,s/4,(e[9]+e[6])/s,(e[8]-e[2])/s]
    : [(e[8]+e[2])/s,(e[9]+e[6])/s,s/4,(e[1]-e[4])/s];
  return new THREE.Quaternion().fromArray(q).normalize();
}
export function matrixFromRows(rows: number[][]): THREE.Matrix4 {
  return new THREE.Matrix4().set(...rows.flat() as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]);
}
export function lookRotation(z: THREE.Vector3, y: THREE.Vector3): THREE.Quaternion {
  const forward = z.clone().normalize();
  const right = y.clone().cross(forward).normalize();
  if (forward.lengthSq() < 1e-10 || right.lengthSq() < 1e-10) return new THREE.Quaternion();
  const up = forward.clone().cross(right).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward)).normalize();
}
export function clonePose(p: BipedPose): BipedPose {
  return { rootPosition: p.rootPosition.clone(), rootRotation: p.rootRotation.clone(), positions: p.positions.map(v => v.clone()), rotations: p.rotations.map(v => v.clone()), velocities: p.velocities.map(v => v.clone()), rotationBases: p.rotations.map((_, i) => poseBasis(p, i).clone()), contacts: [...p.contacts] };
}
export function restPose(meta: BipedMeta): BipedPose {
  return { rootPosition: new THREE.Vector3(), rootRotation: new THREE.Quaternion(), positions: meta.restPositions.map(v => new THREE.Vector3().fromArray(v)), rotations: meta.restMatrices.map(m => basisQuaternion(matrixFromRows(m))), rotationBases: meta.restMatrices.map(m => matrixFromRows(m).setPosition(0,0,0)), velocities: meta.jointNames.map(() => new THREE.Vector3()), contacts: [0, 0, 0, 0] };
}
export function mixPose(a: BipedPose, b: BipedPose, t: number): BipedPose {
  const w = THREE.MathUtils.clamp(t, 0, 1);
  return { rootPosition: a.rootPosition.clone().lerp(b.rootPosition, w), rootRotation: basisQuaternion(mixBasis(new THREE.Matrix4().makeRotationFromQuaternion(a.rootRotation), new THREE.Matrix4().makeRotationFromQuaternion(b.rootRotation), w)), positions: a.positions.map((v, i) => v.clone().lerp(b.positions[i], w)), rotationBases: a.rotations.map((_, i) => mixBasis(poseBasis(a, i), poseBasis(b, i), w)), rotations: a.rotations.map((_, i) => basisQuaternion(mixBasis(poseBasis(a, i), poseBasis(b, i), w))), velocities: a.velocities.map((v, i) => v.clone().lerp(b.velocities[i], w)), contacts: a.contacts.map((v, i) => THREE.MathUtils.lerp(v, b.contacts[i], w)) };
}
export function sampleSequence(seq: BipedSequence, time: number, window: number): BipedPose {
  const frame = THREE.MathUtils.clamp((time - seq.startTime) / window * (seq.frames.length - 1), 0, seq.frames.length - 1);
  return mixPose(seq.frames[Math.floor(frame)], seq.frames[Math.ceil(frame)], frame % 1);
}
export interface TrajectorySample { position: THREE.Vector3; rotation: THREE.Quaternion; velocity: THREE.Vector3 }
export class TrajectoryPlanner {
  readonly samples: TrajectorySample[];
  constructor(readonly count = 16, readonly window = 0.5) {
    this.samples = Array.from({ length: count }, () => ({ position: new THREE.Vector3(), rotation: new THREE.Quaternion(), velocity: new THREE.Vector3() }));
  }
  update(position: THREE.Vector3, direction: THREE.Vector3, velocity: THREE.Vector3, dt: number) {
    const step = this.window / (this.count - 1);
    const current = this.samples[0];
    const target = direction.lengthSq() ? direction : velocity.lengthSq() ? velocity : new THREE.Vector3(0, 0, 1).applyQuaternion(current.rotation);
    const rotation = lookRotation(target, UP);
    current.velocity.lerp(velocity, 1 - Math.exp(-dt * 10));
    if (current.velocity.distanceTo(velocity) < 0.01) current.velocity.copy(velocity);
    current.position.copy(position).addScaledVector(current.velocity, dt);
    current.rotation.slerp(rotation, 1 - Math.exp(-dt * 10));
    // Upstream Vector3.SlerpDt snaps within eps=0.01, as velocity control does.
    const desiredDirection = target.clone().normalize();
    if (new THREE.Vector3(0, 0, 1).applyQuaternion(current.rotation).distanceTo(desiredDirection) < 0.01) current.rotation.copy(rotation);
    for (let i = 1; i < this.count; i++) {
      const ratio = i / (this.count - 1), prev = this.samples[i - 1], sample = this.samples[i];
      sample.velocity.copy(prev.velocity).lerp(velocity, 1 - Math.exp(-step * ratio * 10));
      if (sample.velocity.distanceTo(velocity) < 0.01) sample.velocity.copy(velocity);
      sample.position.copy(prev.position).addScaledVector(sample.velocity, step);
      sample.rotation.copy(current.rotation).slerp(rotation, ratio);
    }
  }
}
export function assembleFeatures(pose: BipedPose, trajectory: TrajectorySample[], guidance: number[][], inputDim: number): Float32Array {
  const inverse = pose.rootRotation.clone().invert();
  const values: number[] = [];
  const feed = (v: THREE.Vector3) => values.push(v.x, v.y, v.z);
  pose.positions.forEach(v => feed(v.clone().sub(pose.rootPosition).applyQuaternion(inverse)));
  [new THREE.Vector3(0, 0, 1), UP].forEach(axis => pose.rotations.forEach((_, i) => feed(axis.clone().applyMatrix4(poseBasis(pose,i)).applyQuaternion(inverse))));
  pose.velocities.forEach(v => feed(v.clone().applyQuaternion(inverse)));
  [0, 1, 2].forEach(kind => trajectory.forEach(sample => {
    const v = kind === 0 ? sample.position.clone().sub(pose.rootPosition) : kind === 1 ? new THREE.Vector3(0, 0, 1).applyQuaternion(sample.rotation) : sample.velocity.clone();
    v.applyQuaternion(inverse); values.push(v.x, v.z);
  }));
  guidance.forEach(v => values.push(...v));
  if (values.length !== inputDim) throw new Error(`Biped features: ${values.length} != ${inputDim}`);
  return Float32Array.from(values);
}
export function decodeSequence(output: Float32Array, pose: BipedPose, meta: BipedMeta, startTime: number): BipedSequence {
  const n = meta.jointNames.length, stride = 3 + 12 * n;
  if (output.length !== stride * meta.sequenceLength) throw new Error('Invalid biped prediction size');
  const delta = new THREE.Vector3();
  const frames: BipedPose[] = [];
  for (let f = 0; f < meta.sequenceLength; f++) {
    const offset = f * stride;
    if (f > 0) delta.add(new THREE.Vector3().fromArray(output, offset));
    const rootRotation = pose.rootRotation.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP, THREE.MathUtils.degToRad(delta.y)));
    const rootPosition = new THREE.Vector3(delta.x, 0, delta.z).applyQuaternion(pose.rootRotation).add(pose.rootPosition);
    const read = (base: number, i: number) => new THREE.Vector3().fromArray(output, offset + base + i * 3);
    const rotationBases = Array.from({ length: n }, (_, i) => {
      const z = read(3 + n * 3, i).normalize(), y = read(3 + n * 6, i).normalize();
      return new THREE.Matrix4().makeRotationFromQuaternion(rootRotation).multiply(new THREE.Matrix4().makeBasis(y.clone().cross(z), y, z));
    });
    frames.push({ rootPosition, rootRotation, rotationBases, rootVelocity: new THREE.Vector3(output[offset] * meta.sequenceFps, 0, output[offset + 2] * meta.sequenceFps).applyQuaternion(rootRotation),
      positions: Array.from({ length: n }, (_, i) => read(3, i).applyQuaternion(rootRotation).add(rootPosition)),
      rotations: Array.from({ length: n }, (_, i) => basisQuaternion(rotationBases[i])),
      velocities: Array.from({ length: n }, (_, i) => read(3 + n * 9, i).applyQuaternion(rootRotation)), contacts: [0, 0, 0, 0] });
  }
  return { startTime, frames };
}
export function contactFeatures(input: Float32Array, pose: BipedPose, sequence: BipedSequence, meta: BipedMeta): Float32Array {
  const values = Array.from(input.slice(0, meta.jointNames.length * 12));
  for (let kind = 0; kind < 3; kind++) {
    sequence.frames.slice(1).forEach(frame => meta.contactIndices.forEach(index => {
      values.push(kind === 0 ? pose.positions[index].distanceTo(frame.positions[index]) : kind === 1 ? rotationAngle(poseBasis(pose,index), frame.rotationBases?.[index] ?? new THREE.Matrix4().makeRotationFromQuaternion(frame.rotations[index])) : pose.velocities[index].distanceTo(frame.velocities[index]));
    }));
  }
  if (values.length !== meta.models.contacts_biped.inputDim) throw new Error('Invalid contact feature size');
  return Float32Array.from(values);
}

function rotationAngle(current: THREE.Matrix4, target: THREE.Matrix4): number {
  const delta = current.clone().invert().multiply(target).elements;
  return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp((delta[0] + delta[5] + delta[10] - 1) / 2, -1, 1)));
}
