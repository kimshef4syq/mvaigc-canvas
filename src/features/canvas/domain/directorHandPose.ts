import type { BlueprintHandPose } from './canvasNodes';

export const HAND_CHANNELS = ['thumb', 'index', 'middle', 'ring', 'pinky', 'spread', 'thumbOpposition'] as const;
export const HAND_FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const;
export const GENO_BODY_JOINT_NAMES = ["Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase", "Spine", "Spine1", "Spine2", "Spine3", "Neck", "Head", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand"];
export const GENO_FINGER_JOINT_NAMES = ['Left', 'Right'].flatMap(side => HAND_FINGERS.flatMap(finger => [1, 2, 3].map(joint => `${side}Hand${finger}${joint}`)));
export const HAND_POSES: Record<'open' | 'relaxed' | 'fist' | 'point' | 'phone', BlueprintHandPose> = {
  open: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0.35, thumbOpposition: 0 },
  relaxed: { thumb: 0.1, index: 0.12, middle: 0.16, ring: 0.2, pinky: 0.24, spread: 0, thumbOpposition: 0.1 },
  fist: { thumb: 0.65, index: 1, middle: 1, ring: 1, pinky: 1, spread: -0.05, thumbOpposition: 0.75 },
  point: { thumb: 0.45, index: 0, middle: 1, ring: 1, pinky: 1, spread: 0, thumbOpposition: 0.5 },
  phone: { thumb: 0.35, index: 0.5, middle: 0.6, ring: 0.7, pinky: 0.75, spread: 0, thumbOpposition: 0.5 },
};
export function normalizeHandPose(value: unknown): BlueprintHandPose | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as Record<string, unknown>, hand: BlueprintHandPose = {};
  for (const key of HAND_CHANNELS) {
    const amount = record[key];
    if (typeof amount === 'number' && Number.isFinite(amount)) hand[key] = Math.min(1, Math.max(key === 'spread' ? -1 : 0, amount));
  }
  return Object.keys(hand).length ? hand : undefined;
}

export const GENO_HAND_SKELETON_JOINT_NAMES = [...GENO_BODY_JOINT_NAMES, ...GENO_FINGER_JOINT_NAMES];
export const CRANBERRY_BODY_JOINT_NAMES = [
  "b_root", "b_l_upleg", "b_l_leg", "b_l_talocrural", "b_l_ball",
  "b_r_upleg", "b_r_leg", "b_r_talocrural", "b_r_ball",
  "b_spine0", "b_spine1", "b_spine2", "b_spine3", "b_neck0", "b_head",
  "b_l_shoulder", "b_l_arm", "b_l_forearm", "b_l_wrist",
  "b_r_shoulder", "b_r_arm", "b_r_forearm", "b_r_wrist"
];
export const CRANBERRY_FINGER_JOINT_NAMES = ['l', 'r'].flatMap(side =>
  ['thumb', 'index', 'middle', 'ring', 'pinky'].flatMap(finger =>
    [1, 2, 3].map(joint => `b_${side}_${finger}${joint}`)
  )
);
export const CRANBERRY_HAND_SKELETON_JOINT_NAMES = [...CRANBERRY_BODY_JOINT_NAMES, ...CRANBERRY_FINGER_JOINT_NAMES];
export function interpolateHandPose(from: BlueprintHandPose, to: BlueprintHandPose, amount: number): BlueprintHandPose {
  return Object.fromEntries(HAND_CHANNELS.map(key => [key, (from[key] ?? 0) + ((to[key] ?? 0) - (from[key] ?? 0)) * amount]));
}

