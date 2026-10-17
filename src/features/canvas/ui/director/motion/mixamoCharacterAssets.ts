import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BLUEPRINT_PRESERVE_MATERIAL_COLOR } from '../../blueprintMeshFactory';
import type { DirectorSkeletonFrame } from '@/features/canvas/domain/canvasNodes';

/**
 * Mixamo-sourced characters, added alongside (never replacing) the neural
 * Geno/Cranberry path. A character is a single GLB that also carries its own
 * animation clips; we register it here, then bake its clips into the shared
 * `DirectorSkeletonRecording` format so the existing timeline / recording /
 * playback pipeline works unchanged. Playback is by bone name, so a character
 * always consumes its own clips — no retargeting.
 */

export interface MixamoModelDefinition {
  id: string;
  label: string;
  glbUrl: string;
}

export const MIXAMO_MODELS: readonly MixamoModelDefinition[] = [
  { id: 'mixamo-vanguard', label: 'Vanguard', glbUrl: '/blueprint-figure.glb' },
];

const MIXAMO_BY_ID = new Map(MIXAMO_MODELS.map((model) => [model.id, model]));

/** Returns the mixamo model id for a presetId like `mixamo-vanguard`, or null. */
export function mixamoModelId(presetId?: string): string | null {
  if (!presetId || !presetId.startsWith('mixamo-')) return null;
  return MIXAMO_BY_ID.has(presetId) ? presetId : null;
}

export function getMixamoDefinition(id: string): MixamoModelDefinition | null {
  return MIXAMO_BY_ID.get(id) ?? null;
}

interface MixamoTemplate {
  scene: THREE.Group;
  height: number;
  animations: THREE.AnimationClip[];
}

const templates = new Map<string, MixamoTemplate>();
const loading = new Map<string, Promise<void>>();

export function isMixamoModelReady(id: string): boolean {
  return templates.has(id);
}

export async function ensureMixamoModel(id: string): Promise<void> {
  if (templates.has(id)) return;
  if (loading.has(id)) return loading.get(id)!;
  const definition = MIXAMO_BY_ID.get(id);
  if (!definition) throw new Error(`未知的 Mixamo 模型：${id}`);
  const promise = new GLTFLoader().loadAsync(definition.glbUrl).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    const height = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).y;
    if (!Number.isFinite(height) || height < 0.01) throw new Error('人物模型高度无效');
    templates.set(id, { scene: gltf.scene, height, animations: gltf.animations ?? [] });
  }).finally(() => loading.delete(id));
  loading.set(id, promise);
  return promise;
}

export function getMixamoClips(id: string): THREE.AnimationClip[] {
  return templates.get(id)?.animations ?? [];
}

export function createMixamoCharacter(id: string, height: number): THREE.Group {
  const group = new THREE.Group();
  group.userData.mixamoModelId = id;
  const template = templates.get(id);
  if (!template) return group;
  const model = clone(template.scene);
  model.traverse((object: any) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      const materials = (Array.isArray(object.material) ? object.material : [object.material]).map((m: any) => {
        const material = m.clone();
        material.userData[BLUEPRINT_PRESERVE_MATERIAL_COLOR] = true;
        return material;
      });
      object.material = Array.isArray(object.material) ? materials : materials[0];
    }
    if (object.isBone) object.userData.neuralRest = { position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray() };
  });
  group.add(model);
  group.scale.setScalar(height / template.height);
  group.userData.neuralNativeScale = group.scale.x;
  // Marked `neuralReady` so the shared baked-skeleton playback path recognises it.
  group.userData.neuralReady = true;
  return group;
}

export function resetMixamoPose(group: THREE.Group) {
  group.traverse((object: any) => {
    const rest = object.userData.neuralRest;
    if (rest) {
      object.matrixAutoUpdate = true;
      object.position.fromArray(rest.position);
      object.quaternion.fromArray(rest.quaternion);
      object.scale.fromArray(rest.scale);
    }
  });
}

/** Captures the whole skeleton's local transforms per frame, matching the
 *  `DirectorSkeletonFrame` shape the timeline samples and replays. */
export class MixamoSkeletonAdapter {
  readonly bones: THREE.Object3D[];
  readonly jointNames: string[];
  constructor(readonly group: THREE.Group) {
    const id = group.userData.mixamoModelId;
    if (!group.userData.neuralReady || typeof id !== 'string') throw new Error('请选择一个已加载的 Mixamo 人物');
    const bones: THREE.Object3D[] = [];
    const seen = new Set<string>();
    group.traverse((object) => {
      if (!(object as THREE.Bone).isBone || !object.name || seen.has(object.name)) return;
      seen.add(object.name);
      bones.push(object);
    });
    if (!bones.length) throw new Error('Mixamo 人物缺少骨骼');
    this.bones = bones;
    this.jointNames = bones.map((bone) => bone.name);
  }
  capture(time: number): DirectorSkeletonFrame {
    return {
      time,
      rootPosition: this.group.position.toArray(),
      rootRotation: this.group.quaternion.toArray(),
      rootScale: this.group.scale.toArray(),
      joints: this.bones.flatMap((bone) => [...bone.position.toArray(), ...bone.quaternion.clone().normalize().toArray()]),
    };
  }
}
