import * as THREE from 'three';
import type { BlueprintHandPose, BlueprintActionPose } from '@/features/canvas/domain/canvasNodes';
import { HAND_FINGERS, normalizeHandPose } from '@/features/canvas/domain/directorHandPose';

interface FingerJoint {
  bone: THREE.Object3D;
  rest: THREE.Quaternion;
  curlAxis: THREE.Vector3;
  spreadAxis: THREE.Vector3;
  oppositionAxis: THREE.Vector3;
  finger: typeof HAND_FINGERS[number];
  joint: number;
  side: 'Left' | 'Right';
}
const wrists = new WeakMap<THREE.Group, Array<{ bone: THREE.Object3D; side: 'Left' | 'Right'; flex: THREE.Vector3; twist: THREE.Vector3; deviation: THREE.Vector3 }>>();
const rigs = new WeakMap<THREE.Group, FingerJoint[]>();
function restQuaternion(bone: THREE.Object3D) {
  return bone.userData.neuralRest ? new THREE.Quaternion().fromArray(bone.userData.neuralRest.quaternion) : bone.quaternion.clone();
}
function relativeRotation(bone: THREE.Object3D, hand: THREE.Object3D) {
  const chain: THREE.Object3D[] = [];
  for (let current: THREE.Object3D | null = bone; current && current !== hand; current = current.parent) chain.push(current);
  return chain.reverse().reduce((q, joint) => q.multiply(restQuaternion(joint)), new THREE.Quaternion()).normalize();
}
function prepare(group: THREE.Group) {
  const cached = rigs.get(group); if (cached) return cached;
  const joints: FingerJoint[] = [];
  const wristAxes: Array<{ bone: THREE.Object3D; side: 'Left' | 'Right'; flex: THREE.Vector3; twist: THREE.Vector3; deviation: THREE.Vector3 }> = [];
  const isCranberry = group.userData.neuralModelId === 'ai4animation-cranberry';
  for (const side of ['Left', 'Right'] as const) {
    const s = side === 'Left' ? 'l' : 'r';
    const hand = isCranberry ? group.getObjectByName(`b_${s}_wrist`) : group.getObjectByName(side + 'Hand');
    const index = isCranberry ? group.getObjectByName(`b_${s}_index1`) : group.getObjectByName(side + 'HandIndex1');
    const pinky = isCranberry ? group.getObjectByName(`b_${s}_pinky1`) : group.getObjectByName(side + 'HandPinky1');
    const middle = isCranberry ? group.getObjectByName(`b_${s}_middle1`) : group.getObjectByName(side + 'HandMiddle1');
    if (!hand || !index || !pinky || !middle) continue;
    // Finger ordering is mirrored. Derive anatomical palm flexion from
    // the imported knuckles, rather than assuming the bones bend about X.
    const palm = index.position.clone().cross(pinky.position).normalize().multiplyScalar(side === 'Left' ? -1 : 1);
    const fan = index.position.clone().sub(pinky.position).normalize();
    const long = middle.position.clone().normalize();
    wristAxes.push({bone:hand,side,flex:long.clone().cross(palm).normalize(),twist:long.clone(),deviation:long.clone().cross(fan).normalize()});
    for (const finger of HAND_FINGERS) for (let joint = 1; joint <= 3; joint++) {
      const boneName = isCranberry ? `b_${s}_${finger.toLowerCase()}${joint}` : `${side}Hand${finger}${joint}`;
      const bone = group.getObjectByName(boneName); if (!bone) continue;
      const inverse = relativeRotation(bone, hand).invert();
      const child = bone.children.find(object => (object as THREE.Bone).isBone && object.position.lengthSq() > 1e-8);
      const direction = child ? child.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
      joints.push({ bone, rest: restQuaternion(bone), finger, joint, side,
        curlAxis: direction.clone().cross(palm.clone().applyQuaternion(inverse)).normalize(),
        spreadAxis: direction.clone().cross(fan.clone().applyQuaternion(inverse)).normalize(),
        oppositionAxis: long.clone().applyQuaternion(inverse).normalize() });
    }
  }
  rigs.set(group, joints); wrists.set(group, wristAxes); return joints;
}
export function applyNeuralHandPose(group: THREE.Group, left?: BlueprintHandPose, right?: BlueprintHandPose, leftWrist?: BlueprintActionPose['leftWrist'], rightWrist?: BlueprintActionPose['rightWrist']) {
  const joints = prepare(group);
  for (const wrist of wrists.get(group)!) {
    const rotation = wrist.side === 'Left' ? leftWrist : rightWrist;
    if (!rotation) continue;
    for (const [key, axis] of [['x', wrist.flex], ['y', wrist.twist], ['z', wrist.deviation]] as const) {
      const angle = rotation[key];
      if (typeof angle === 'number' && Number.isFinite(angle)) wrist.bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    }
    wrist.bone.quaternion.normalize();
  }
  const hands = { Left: normalizeHandPose(left), Right: normalizeHandPose(right) };
  for (const joint of joints) {
    const hand = hands[joint.side], key = joint.finger.toLowerCase() as 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
    joint.bone.quaternion.copy(joint.rest);
    if (!hand) continue;
    const curl = hand[key] ?? 0;
    if (joint.joint === 1) {
      const spread = { Thumb: 0.35, Index: 0.25, Middle: 0, Ring: -0.15, Pinky: -0.35 }[joint.finger];
      joint.bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(joint.spreadAxis, (hand.spread ?? 0) * spread));
      if (joint.finger === 'Thumb') joint.bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(joint.oppositionAxis, (hand.thumbOpposition ?? 0) * 1.05 * (joint.side === 'Left' ? 1 : -1)));
    }
    const angles = joint.finger === 'Thumb' ? [0.5, 0.75, 0.5] : [1.1, 1.3, 0.8];
    joint.bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(joint.curlAxis, curl * angles[joint.joint - 1])).normalize();
  }
  group.updateMatrixWorld(true);
}
