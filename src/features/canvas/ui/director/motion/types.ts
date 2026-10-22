import * as THREE from 'three';

export type NeuralCharacterModelId = 'ai4animation-geno' | 'ai4animation-cranberry';
export interface BipedMeta {
  schemaVersion: 1;
  upstreamRevision: string;
  normalization: 'embedded';
  sequenceLength: number;
  sequenceWindow: number;
  sequenceFps: number;
  predictionFps: number;
  iterations: number;
  jointNames: string[];
  parentIndices: number[];
  restPositions: number[][];
  restMatrices: number[][][];
  zeroMatrices: number[][][];
  contactIndices: number[];
  guidances: Record<string, number[][]>;
  models: Record<'locomotion_biped' | 'contacts_biped', { inputDim: number; outputDim: number }>;
}
export interface BipedPose {
  rootPosition: THREE.Vector3;
  rootRotation: THREE.Quaternion;
  rootVelocity?: THREE.Vector3;
  positions: THREE.Vector3[];
  rotations: THREE.Quaternion[];
  /** Unorthogonalized predicted bases are retained for official contact features. */
  rotationBases?: THREE.Matrix4[];
  velocities: THREE.Vector3[];
  contacts: number[];
}
export interface BipedSequence {
  startTime: number;
  frames: BipedPose[];
}
export interface MotionControl {
  velocity: THREE.Vector3;
  direction: THREE.Vector3;
  style: string;
}
export const NEURAL_ASSET_BASE = '/models/ai4animation/';
