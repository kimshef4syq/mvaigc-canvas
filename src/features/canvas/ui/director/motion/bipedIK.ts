// Adapted from Meta AI4AnimationPy Actor, FABRIK and Biped/LegIK (CC BY-NC 4.0).
import * as THREE from 'three';
import { matrixFromRows } from './bipedMath';
import type { BipedMeta, BipedPose } from './types';

export class BipedIK {
  private readonly zeroPositions: THREE.Vector3[];
  private readonly children: number[][];
  private readonly lengths: number[];
  private readonly initialized = [false, false, false, false];
  private readonly targets: Array<{ position: THREE.Vector3; rotation: THREE.Quaternion }>;
  constructor(private readonly meta: BipedMeta, initial: BipedPose) {
    this.zeroPositions = meta.zeroMatrices.map(m => new THREE.Vector3().setFromMatrixPosition(matrixFromRows(m)));
    this.children = meta.jointNames.map(() => []);
    meta.parentIndices.forEach((parent, i) => { if (parent !== i) this.children[parent].push(i); });
    this.lengths = this.zeroPositions.map(p => p.length());
    this.targets = meta.contactIndices.map(i => ({ position: initial.positions[i].clone(), rotation: initial.rotations[i].clone() }));
  }
  restore(p: BipedPose) {
    // Match the upstream vectorized pass: all lengths use the pre-pass parents.
    const previous = p.positions.map(v => v.clone());
    p.positions.forEach((v, i) => {
      const parent = this.meta.parentIndices[i];
      if (i !== parent) v.copy(previous[i]).sub(previous[parent]).normalize().multiplyScalar(this.lengths[i]).add(previous[parent]);
    });
    this.children.forEach((children, i) => { if (children.length === 1) this.align(p, i, children[0], false); });
  }
  private align(p: BipedPose, index: number, child: number, fk: boolean) {
    const from = this.zeroPositions[child].clone().applyQuaternion(p.rotations[index]).normalize();
    const to = p.positions[child].clone().sub(p.positions[index]).normalize();
    if (!from.lengthSq() || !to.lengthSq()) return;
    this.rotate(p, index, new THREE.Quaternion().setFromUnitVectors(from, to), fk);
  }
  private rotate(p: BipedPose, index: number, delta: THREE.Quaternion, fk: boolean) {
    p.rotations[index].premultiply(delta).normalize();
    if (!fk) return;
    const origin = p.positions[index];
    const visit = (i: number) => {
      p.positions[i].sub(origin).applyQuaternion(delta).add(origin);
      p.rotations[i].premultiply(delta).normalize();
      this.children[i].forEach(visit);
    };
    this.children[index].forEach(visit);
  }
  private solveChain(p: BipedPose, chain: number[], target: THREE.Vector3, rotation: THREE.Quaternion, pole?: THREE.Vector3) {
    const positions = chain.map(i => p.positions[i].clone());
    const lengths = positions.map((v, i) => i ? v.distanceTo(positions[i - 1]) : 0);
    positions[positions.length - 1].copy(target);
    for (let i = positions.length - 2; i > 0; i--) positions[i].sub(positions[i + 1]).normalize().multiplyScalar(lengths[i + 1]).add(positions[i + 1]);
    for (let i = 1; i < positions.length; i++) positions[i].sub(positions[i - 1]).normalize().multiplyScalar(lengths[i]).add(positions[i - 1]);
    if (pole) {
      const root = positions[0], axis = target.clone().sub(root).normalize();
      const poleVector = pole.clone().sub(root); poleVector.addScaledVector(axis, -poleVector.dot(axis)).normalize();
      for (let i = 1; i < positions.length - 1; i++) {
        const relative = positions[i].clone().sub(root);
        const projected = relative.clone().addScaledVector(axis, -relative.dot(axis)).normalize();
        if (!projected.lengthSq() || !poleVector.lengthSq()) continue;
        const angle = Math.atan2(new THREE.Vector3().crossVectors(projected, poleVector).dot(axis), projected.dot(poleVector));
        positions[i].copy(relative.applyAxisAngle(axis, angle).add(root));
      }
    }
    chain.slice(0, -1).forEach((index, i) => {
      const movement = positions[i].clone().sub(p.positions[index]);
      const move = (j: number) => { p.positions[j].add(movement); this.children[j].forEach(move); };
      move(index);
      const child = chain[i + 1];
      const from = this.zeroPositions[child].clone().applyQuaternion(p.rotations[index]).normalize();
      const to = positions[i + 1].clone().sub(positions[i]).normalize();
      if (from.lengthSq() && to.lengthSq()) this.rotate(p, index, new THREE.Quaternion().setFromUnitVectors(from, to), true);
    });
    const end = chain[chain.length - 1], movement = positions[positions.length - 1].clone().sub(p.positions[end]);
    const move = (j: number) => { p.positions[j].add(movement); this.children[j].forEach(move); };
    move(end);
    this.rotate(p, end, rotation.clone().multiply(p.rotations[end].clone().invert()), true);
  }
  solve(p: BipedPose) {
    for (let leg = 0; leg < 2; leg++) {
      const ankleSlot = leg * 2, ballSlot = ankleSlot + 1;
      const ankle = this.meta.contactIndices[ankleSlot], ball = this.meta.contactIndices[ballSlot];
      const knee = this.meta.parentIndices[ankle], hip = this.meta.parentIndices[knee];
      const updateTarget = (slot: number, bone: number) => {
        const target = this.targets[slot], weight = p.contacts[slot];
        // Upstream initial targets are views into Actor.Transforms and track
        // the first assigned pose until Solve creates independent arrays.
        if (!this.initialized[slot]) { target.position.copy(p.positions[bone]); target.rotation.copy(p.rotations[bone]); this.initialized[slot] = true; }
        const baseline = this.meta.restPositions[bone][1];
        const locked = target.position.clone();
        locked.y = Math.max(THREE.MathUtils.lerp(locked.y, baseline, weight), baseline);
        target.position.copy(p.positions[bone]).lerp(locked, weight);
        target.rotation.copy(p.rotations[bone].clone().slerp(target.rotation, 0.5 * weight));
        return target;
      };
      const ankleTarget = updateTarget(ankleSlot, ankle);
      const pole = new THREE.Vector3(0, 0, 1).applyQuaternion(p.rotations[knee]).add(p.positions[knee]);
      this.solveChain(p, [hip, knee, ankle], ankleTarget.position, ankleTarget.rotation, pole);
      const ballTarget = updateTarget(ballSlot, ball);
      const height = ballTarget.position.y, direction = ballTarget.position.clone().sub(ankleTarget.position); direction.y = 0;
      if (direction.lengthSq() < 1e-12) direction.set(1, 0, 0); else direction.normalize();
      const distance = new THREE.Vector3().fromArray(this.meta.restPositions[ankle]).distanceTo(new THREE.Vector3().fromArray(this.meta.restPositions[ball]));
      const reach = Math.sqrt(Math.max(distance ** 2 - (height - ankleTarget.position.y) ** 2, 0));
      ballTarget.position.copy(ankleTarget.position).addScaledVector(direction, reach); ballTarget.position.y = height;
      this.solveChain(p, [ankle, ball], ballTarget.position, ballTarget.rotation);
    }
  }
}
