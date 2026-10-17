import { GENO_FINGER_JOINT_NAMES, CRANBERRY_BODY_JOINT_NAMES, CRANBERRY_FINGER_JOINT_NAMES, interpolateHandPose } from '@/features/canvas/domain/directorHandPose';
import { applyNeuralHandPose } from './neuralHandPose';
import { poseBasis } from './bipedMath';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { BlueprintActionPose, BlueprintHandPose } from '@/features/canvas/domain/canvasNodes';
import { BLUEPRINT_PRESERVE_MATERIAL_COLOR } from '../../blueprintMeshFactory';
import { NEURAL_ASSET_BASE, type BipedMeta, type BipedPose, type NeuralCharacterModelId } from './types';
import type { DirectorSkeletonFrame } from '@/features/canvas/domain/canvasNodes';

const templates = new Map<NeuralCharacterModelId, { scene: THREE.Group; height: number }>();
const loading = new Map<NeuralCharacterModelId, Promise<void>>();
export function neuralModelId(presetId?: string): NeuralCharacterModelId | null {
  return presetId === 'ai4animation-geno' || presetId === 'ai4animation-cranberry' ? presetId : null;
}
export function isNeuralModelReady(id: NeuralCharacterModelId): boolean { return templates.has(id); }
export async function ensureNeuralModel(id: NeuralCharacterModelId): Promise<void> {
  if (templates.has(id)) return;
  if (loading.has(id)) return loading.get(id)!;
  const promise = new GLTFLoader().loadAsync(`${NEURAL_ASSET_BASE}${id === 'ai4animation-geno' ? 'geno' : 'cranberry'}.glb`).then(gltf => {
    gltf.scene.updateMatrixWorld(true);
    const height = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).y;
    if (!Number.isFinite(height) || height < 0.01) throw new Error('人物模型高度无效');
    templates.set(id, { scene: gltf.scene, height });
  }).finally(() => loading.delete(id));
  loading.set(id, promise);
  return promise;
}
export function createNeuralCharacter(id: NeuralCharacterModelId, height: number): THREE.Group {
  const group = new THREE.Group();
  group.userData.neuralModelId = id;
  const template = templates.get(id);
  if (!template) return group;
  const model = clone(template.scene);
  model.traverse((object: any) => {
    if (object.isMesh) {
      object.castShadow = true; object.receiveShadow = true; object.userData.neuralSharedGeometry = true;
      const materials = (Array.isArray(object.material) ? object.material : [object.material]).map((m: any) => { const material = m.clone(); material.userData[BLUEPRINT_PRESERVE_MATERIAL_COLOR] = true; return material; });
      object.material = Array.isArray(object.material) ? materials : materials[0];
    }
    if (object.isBone) object.userData.neuralRest = { position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray() };
  });
  group.add(model);
  group.scale.setScalar(height / template.height);
  group.userData.neuralNativeScale = group.scale.x;
  group.userData.neuralReady = true;
  return group;
}
export function resetNeuralPose(group: THREE.Group) {
  group.traverse((object: any) => { const rest = object.userData.neuralRest; if (rest) { object.matrixAutoUpdate = true; object.position.fromArray(rest.position); object.quaternion.fromArray(rest.quaternion); object.scale.fromArray(rest.scale); } });
}
// Action angles use a common character frame (+Y up, +Z forward), with
// arms naturally hanging slightly outward. Imported bone-local frames differ.
const actionRest = new WeakMap<THREE.Group, Map<THREE.Object3D, { local: THREE.Quaternion; parent: THREE.Quaternion }>>();
function characterQuaternion(group: THREE.Group, object: THREE.Object3D): THREE.Quaternion {
  const chain: THREE.Object3D[] = [];
  for (let current: THREE.Object3D | null = object; current && current !== group; current = current.parent) chain.push(current);
  return chain.reverse().reduce((rotation, bone) => rotation.multiply(bone.quaternion), new THREE.Quaternion()).normalize();
}
function prepareActionRest(group: THREE.Group) {
  const cached = actionRest.get(group);
  if (cached) return cached;
  group.updateMatrixWorld(true);
  const isCranberry = group.userData.neuralModelId === 'ai4animation-cranberry';
  const bonePairs = isCranberry ? [
    ['b_l_arm', 'b_l_forearm'], ['b_l_forearm', 'b_l_wrist'], ['b_l_wrist', 'b_l_middle3'],
    ['b_r_arm', 'b_r_forearm'], ['b_r_forearm', 'b_r_wrist'], ['b_r_wrist', 'b_r_middle3'],
    ['b_l_upleg', 'b_l_leg'], ['b_l_leg', 'b_l_talocrural'],
    ['b_r_upleg', 'b_r_leg'], ['b_r_leg', 'b_r_talocrural'],
  ] : [
    ['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'], ['LeftHand', 'LeftHandMiddle3'],
    ['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'], ['RightHand', 'RightHandMiddle3'],
    ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'],
    ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot'],
  ];
  for (const [parentName, childName] of bonePairs) {
    const arm = group.getObjectByName(parentName);
    const elbow = group.getObjectByName(childName);
    if (!arm?.parent || !elbow) continue;
    const direction = group.worldToLocal(elbow.getWorldPosition(new THREE.Vector3())).sub(group.worldToLocal(arm.getWorldPosition(new THREE.Vector3()))).normalize();
    // A straight-down arm intersects pelvis/thigh silhouette.
    // Keep a natural ~11 degree outward hang, including the wrist/fingers.
    const isArm = /Arm|Hand|arm|wrist/i.test(parentName);
    const side = /Left|_l_/i.test(parentName) ? 1 : -1;
    const down = new THREE.Vector3(isArm ? side * 0.2 : 0, -1, isArm ? 0.04 : 0).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(direction, down);
    const world = delta.multiply(characterQuaternion(group, arm));
    arm.quaternion.copy(characterQuaternion(group, arm.parent).invert().multiply(world));
    arm.updateMatrixWorld(true);
  }
  const rest = new Map<THREE.Object3D, { local: THREE.Quaternion; parent: THREE.Quaternion }>();
  group.traverse(object => {
    if (!(object as THREE.Bone).isBone) return;
    rest.set(object, { local: object.quaternion.clone(), parent: characterQuaternion(group, object.parent!) });
  });
  actionRest.set(group, rest);
  return rest;
}
const groundedActions = new Set(['sit-upright', 'sit-relaxed', 'squat-low', 'kneel-one', 'kneel-two', 'walk-stride', 'run-stride', 'walk', 'walk-back', 'squat-rise', 'step-over', 'side-step']);
const restFeet = new WeakMap<THREE.Group, Map<string, THREE.Quaternion>>();
const restContacts = new WeakMap<THREE.Group, Map<string, number>>();
const footNames = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'];
function jointHeight(group: THREE.Group, name: string): number | undefined {
  const bone = group.getObjectByName(name);
  if (!bone) return;
  return group.worldToLocal(bone.getWorldPosition(new THREE.Vector3())).y;
}
export function applyNeuralStaticPose(group: THREE.Group, pose?: BlueprintActionPose, actionId?: string) {
  resetNeuralPose(group);
  const rest = prepareActionRest(group);
  rest.forEach((value, bone) => bone.quaternion.copy(value.local));
  group.updateMatrixWorld(true);
  const isCranberry = group.userData.neuralModelId === 'ai4animation-cranberry';
  const characterFootNames = isCranberry ? ['b_l_talocrural', 'b_r_talocrural', 'b_l_ball', 'b_r_ball'] : footNames;
  if (!restContacts.has(group)) {
    const contacts = new Map<string, number>();
    characterFootNames.forEach(name => { const height = jointHeight(group, name); if (height != null) contacts.set(name, height); });
    restContacts.set(group, contacts);
    const feet = new Map<string, THREE.Quaternion>();
    for (const name of isCranberry ? ['b_l_talocrural', 'b_r_talocrural'] : ['LeftFoot', 'RightFoot']) {
      const bone = group.getObjectByName(name);
      if (bone) feet.set(name, characterQuaternion(group, bone));
    }
    restFeet.set(group, feet);
  }
  group.userData.poseYOffset = pose?.groupY ?? 0;
  group.userData.poseRotationX = pose?.groupRotX ?? 0;
  group.userData.poseScaleY = pose?.scaleY ?? 1;
  const mapping: Record<string, string> = isCranberry ? {
    leftShoulder: 'b_l_arm', rightShoulder: 'b_r_arm',
    leftElbow: 'b_l_forearm', rightElbow: 'b_r_forearm',
    leftHip: 'b_l_upleg', rightHip: 'b_r_upleg',
    leftKnee: 'b_l_leg', rightKnee: 'b_r_leg',
    head: 'b_head', torso: 'b_spine0'
  } : {
    leftShoulder: 'LeftArm', rightShoulder: 'RightArm',
    leftElbow: 'LeftForeArm', rightElbow: 'RightForeArm',
    leftHip: 'LeftUpLeg', rightHip: 'RightUpLeg',
    leftKnee: 'LeftLeg', rightKnee: 'RightLeg',
    head: 'Head', torso: 'Spine'
  };
  Object.entries(mapping).forEach(([key, name]) => {
    const bone = group.getObjectByName(name), value = pose?.[key as keyof BlueprintActionPose];
    const bind = bone && rest.get(bone);
    if (!bone || !bind || !value || typeof value !== 'object') return;
    const angles = value as { x?: number; y?: number; z?: number };
    // Torso extends upward, so forward flexion has the opposite X sign
    // from a hanging arm/leg. Shoulder twist acts along the hanging limb
    // before splay and forward swing (XZY), not around the splayed arm.
    const x = (angles.x ?? 0) * (key === 'torso' ? -1 : 1);
    const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, angles.y ?? 0, angles.z ?? 0, key.endsWith('Shoulder') ? 'XZY' : 'XYZ'));
    // Conjugate the character-frame delta into the parent's bind frame.
    bone.quaternion.copy(bind.parent.clone().invert().multiply(delta).multiply(bind.parent).multiply(bind.local));
  });
  applyNeuralHandPose(group, pose?.leftHand, pose?.rightHand, pose?.leftWrist, pose?.rightWrist);
  group.updateMatrixWorld(true);
  if (actionId && groundedActions.has(actionId)) {
    // Compensate hip/knee flexion at the ankles so support feet stay flat.
    // A kneeling leg points the foot backward along its horizontal shin.
    const ankleRight = isCranberry ? 'b_r_talocrural' : 'RightFoot';
    restFeet.get(group)!.forEach((rotation, name) => {
      const bone = group.getObjectByName(name)!;
      const kneeling = actionId === 'kneel-two' || (actionId === 'kneel-one' && name === ankleRight);
      const desired = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), kneeling ? Math.PI : 0).multiply(rotation);
      bone.quaternion.copy(characterQuaternion(group, bone.parent!).invert().multiply(desired));
    });
    group.updateMatrixWorld(true);
    const contacts = [...restContacts.get(group)!].map(([name, height]) => (jointHeight(group, name) ?? height) - height);
    if (actionId.startsWith('kneel-')) {
      for (const name of isCranberry ? ['b_l_leg', 'b_r_leg'] : ['LeftLeg', 'RightLeg']) {
        const height = jointHeight(group, name);
        if (height != null) contacts.push(height - 0.04);
      }
    }
    if (contacts.length) group.userData.poseYOffset = -Math.min(...contacts) * (group.userData.neuralNativeScale ?? 1);
  }
}
/** Compose the pose under the object's authored transform. Scene updates must
 * retain these channels rather than overwrite lie rotation/breathing scale. */
export function applyNeuralCharacterTransform(
  group: THREE.Group,
  position: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number },
  scale: { x: number; y: number; z: number },
) {
  const base = group.userData.baseScale ?? { x: group.userData.neuralNativeScale ?? 1, y: group.userData.neuralNativeScale ?? 1, z: group.userData.neuralNativeScale ?? 1 };
  group.userData.poseAuthoredScaleY = scale.y;
  group.scale.set(base.x * scale.x, base.y * scale.y * (group.userData.poseScaleY ?? 1), base.z * scale.z);
  group.quaternion.setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z));
  group.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), group.userData.poseRotationX ?? 0));
  group.position.set(position.x, position.y + (group.userData.poseYOffset ?? 0) * scale.y, position.z);
  group.updateMatrixWorld(true);
}
/** Live locomotion starts from the authored root, without a static lie/drop/stretch. */
export function removeNeuralActionTransform(group: THREE.Group) {
  const stretch = group.userData.poseScaleY ?? 1;
  const baseY = group.userData.baseScale?.y ?? group.userData.neuralNativeScale ?? 1;
  const scaleY = group.userData.poseAuthoredScaleY ?? group.scale.y / (baseY * (stretch || 1));
  group.position.y -= (group.userData.poseYOffset ?? 0) * scaleY;
  group.scale.y = baseY * scaleY;
  group.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -(group.userData.poseRotationX ?? 0)));
  group.userData.poseYOffset = 0; group.userData.poseRotationX = 0; group.userData.poseScaleY = 1;
  group.userData.motionPoseKey = undefined;
  group.updateMatrixWorld(true);
}
export class NeuralSkeletonAdapter {
  readonly bones: THREE.Object3D[];
  readonly jointNames: string[];
  readonly modelId: NeuralCharacterModelId;
  private readonly bodyBones: THREE.Object3D[];
  leftHandPose: BlueprintHandPose = {};
  rightHandPose: BlueprintHandPose = {};
  private leftCurrent: BlueprintHandPose = {};
  private rightCurrent: BlueprintHandPose = {};
  private readonly origin: THREE.Vector3;
  private readonly originRotation: THREE.Quaternion;
  private readonly originScale: THREE.Vector3;
  constructor(readonly group: THREE.Group, readonly meta: BipedMeta) {
    const modelId = group.userData.neuralModelId as NeuralCharacterModelId | undefined;
    if (!group.userData.neuralReady || (modelId !== 'ai4animation-geno' && modelId !== 'ai4animation-cranberry')) {
      throw new Error('请选择已加载的 Geno 或 Cranberry 人物');
    }
    this.modelId = modelId;
    const isCranberry = modelId === 'ai4animation-cranberry';
    const bodyNames = isCranberry ? CRANBERRY_BODY_JOINT_NAMES : meta.jointNames;
    const fingerNames = isCranberry ? CRANBERRY_FINGER_JOINT_NAMES : GENO_FINGER_JOINT_NAMES;
    this.jointNames = [...bodyNames, ...fingerNames];
    this.bones = this.jointNames.map(name => {
      const bone = group.getObjectByName(name);
      if (!bone) throw new Error(`${isCranberry ? 'Cranberry' : 'Geno'} 缺少关节 ${name}`);
      return bone;
    });
    this.bodyBones = this.bones.slice(0, 23);
    this.origin = group.position.clone();
    this.originRotation = group.quaternion.clone();
    this.originScale = group.scale.clone();
  }
  apply(pose: BipedPose) {
    this.group.position.copy(pose.rootPosition).multiply(this.originScale).applyQuaternion(this.originRotation).add(this.origin);
    this.group.quaternion.copy(this.originRotation).multiply(pose.rootRotation);
    this.group.updateMatrixWorld(true);
    const inverseRoot = pose.rootRotation.clone().invert();
    this.bodyBones.forEach((bone, i) => {
      const position = pose.positions[i].clone().sub(pose.rootPosition).applyQuaternion(inverseRoot);
      const desired = poseBasis(pose, i).clone().premultiply(new THREE.Matrix4().makeRotationFromQuaternion(inverseRoot)).setPosition(position);
      desired.premultiply(this.group.matrixWorld);
      if (bone.parent) desired.premultiply(bone.parent.matrixWorld.clone().invert());
      const scale = new THREE.Vector3(); desired.decompose(bone.position, bone.quaternion, scale);
      bone.matrixAutoUpdate = false; bone.matrix.copy(desired);
      bone.updateMatrixWorld(true);
    });
    const isCranberry = this.modelId === 'ai4animation-cranberry';
    const fingerNames = isCranberry ? CRANBERRY_FINGER_JOINT_NAMES : GENO_FINGER_JOINT_NAMES;
    fingerNames.forEach(name => { const bone=this.group.getObjectByName(name); if(bone) bone.matrixAutoUpdate=true; });
    this.leftCurrent = interpolateHandPose(this.leftCurrent, this.leftHandPose, 0.2);
    this.rightCurrent = interpolateHandPose(this.rightCurrent, this.rightHandPose, 0.2);
    applyNeuralHandPose(this.group, this.leftCurrent, this.rightCurrent);
    this.group.userData.motionPoseKey = undefined;
  }
  capture(time: number): DirectorSkeletonFrame {
    return { time, rootPosition: this.group.position.toArray(), rootRotation: this.group.quaternion.toArray(), rootScale: this.group.scale.toArray(), joints: this.bones.flatMap(bone => [...bone.position.toArray(), ...bone.quaternion.clone().normalize().toArray()]), jointBases: this.bones.flatMap(bone => { if (bone.matrixAutoUpdate) bone.updateMatrix(); return bone.matrix.elements.filter((_, i) => [0,1,2,4,5,6,8,9,10].includes(i)); }) };
  }
}
export function applyBakedSkeleton(group: THREE.Group, names: string[], frame: DirectorSkeletonFrame) {
  if (group.userData.mixamoModelId) {
    // Mixamo rigs carry the whole skeleton; write root + every named bone
    // straight from the baked frame (no hand/finger or 23-joint special cases).
    group.position.fromArray(frame.rootPosition);
    group.quaternion.fromArray(frame.rootRotation);
    group.scale.fromArray(frame.rootScale);
    names.forEach((name, i) => {
      const bone = group.getObjectByName(name);
      if (!bone) return;
      bone.position.fromArray(frame.joints, i * 7);
      bone.quaternion.fromArray(frame.joints, i * 7 + 3).normalize();
      bone.matrixAutoUpdate = true;
    });
    group.userData.motionPoseKey = undefined;
    group.updateMatrixWorld(true);
    return;
  }
  const isCranberry = group.userData.neuralModelId === 'ai4animation-cranberry';
  const fingerNames = isCranberry ? CRANBERRY_FINGER_JOINT_NAMES : GENO_FINGER_JOINT_NAMES;
  fingerNames.forEach(name => { const bone=group.getObjectByName(name); if(bone) bone.matrixAutoUpdate=true; });
  applyNeuralHandPose(group);
  if (names.length === 23) for (const name of fingerNames) {
    const bone = group.getObjectByName(name), rest = bone?.userData.neuralRest;
    if (bone && rest) { bone.position.fromArray(rest.position); bone.scale.fromArray(rest.scale); }
  }
  group.position.fromArray(frame.rootPosition); group.quaternion.fromArray(frame.rootRotation); group.scale.fromArray(frame.rootScale);
  names.forEach((name, i) => { const bone = group.getObjectByName(name); if (bone) { bone.position.fromArray(frame.joints, i * 7); bone.quaternion.fromArray(frame.joints, i * 7 + 3).normalize(); bone.matrixAutoUpdate=true;
      if(frame.jointBases) { const b=frame.jointBases.slice(i*9,i*9+9); bone.matrix.set(b[0],b[3],b[6],bone.position.x,b[1],b[4],b[7],bone.position.y,b[2],b[5],b[8],bone.position.z,0,0,0,1); bone.matrixAutoUpdate=false; } } });
  group.userData.motionPoseKey = undefined;
  group.updateMatrixWorld(true);
}
