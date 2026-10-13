import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { BlueprintActionPose } from '@/features/canvas/domain/canvasNodes';
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
      object.castShadow = true; object.receiveShadow = true;
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
  group.traverse((object: any) => { const rest = object.userData.neuralRest; if (rest) { object.position.fromArray(rest.position); object.quaternion.fromArray(rest.quaternion); object.scale.fromArray(rest.scale); } });
}
export function applyNeuralStaticPose(group: THREE.Group, pose?: BlueprintActionPose) {
  resetNeuralPose(group);
  if (!pose) return;
  const mapping: Record<string, string> = { leftShoulder: 'LeftArm', rightShoulder: 'RightArm', leftElbow: 'LeftForeArm', rightElbow: 'RightForeArm', leftHip: 'LeftUpLeg', rightHip: 'RightUpLeg', leftKnee: 'LeftLeg', rightKnee: 'RightLeg', head: 'Head', torso: 'Spine' };
  Object.entries(mapping).forEach(([key, name]) => {
    const bone = group.getObjectByName(name), value = pose[key as keyof BlueprintActionPose];
    if (!bone || !value || typeof value !== 'object') return;
    const angles = value as { x?: number; y?: number; z?: number };
    bone.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(angles.x ?? 0, angles.y ?? 0, angles.z ?? 0)));
  });
}
export class NeuralSkeletonAdapter {
  readonly bones: THREE.Object3D[];
  private readonly origin: THREE.Vector3;
  private readonly originRotation: THREE.Quaternion;
  private readonly originScale: THREE.Vector3;
  constructor(readonly group: THREE.Group, readonly meta: BipedMeta) {
    if (!group.userData.neuralReady || group.userData.neuralModelId !== 'ai4animation-geno') throw new Error('请选择已加载的 Geno 人物');
    this.bones = meta.jointNames.map(name => { const bone = group.getObjectByName(name); if (!bone) throw new Error(`Geno 缺少关节 ${name}`); return bone; });
    this.origin = group.position.clone(); this.originRotation = group.quaternion.clone(); this.originScale = group.scale.clone();
  }
  apply(pose: BipedPose) {
    this.group.position.copy(pose.rootPosition).multiply(this.originScale).applyQuaternion(this.originRotation).add(this.origin);
    this.group.quaternion.copy(this.originRotation).multiply(pose.rootRotation);
    this.group.updateMatrixWorld(true);
    const inverseRoot = pose.rootRotation.clone().invert();
    this.bones.forEach((bone, i) => {
      const position = pose.positions[i].clone().sub(pose.rootPosition).applyQuaternion(inverseRoot);
      const rotation = inverseRoot.clone().multiply(pose.rotations[i]);
      const desired = new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(1, 1, 1));
      desired.premultiply(this.group.matrixWorld);
      if (bone.parent) desired.premultiply(bone.parent.matrixWorld.clone().invert());
      const scale = new THREE.Vector3(); desired.decompose(bone.position, bone.quaternion, scale);
      bone.updateMatrixWorld(true);
    });
    this.group.userData.motionPoseKey = undefined;
  }
  capture(time: number): DirectorSkeletonFrame {
    return { time, rootPosition: this.group.position.toArray(), rootRotation: this.group.quaternion.toArray(), rootScale: this.group.scale.toArray(), joints: this.bones.flatMap(bone => [...bone.position.toArray(), ...bone.quaternion.toArray()]) };
  }
}
export function applyBakedSkeleton(group: THREE.Group, names: string[], frame: DirectorSkeletonFrame) {
  group.position.fromArray(frame.rootPosition); group.quaternion.fromArray(frame.rootRotation); group.scale.fromArray(frame.rootScale);
  names.forEach((name, i) => { const bone = group.getObjectByName(name); if (bone) { bone.position.fromArray(frame.joints, i * 7); bone.quaternion.fromArray(frame.joints, i * 7 + 3).normalize(); } });
  group.userData.motionPoseKey = undefined;
  group.updateMatrixWorld(true);
}
