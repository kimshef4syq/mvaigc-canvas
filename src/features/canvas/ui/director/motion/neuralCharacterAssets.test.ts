import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { applyNeuralCharacterTransform, applyNeuralStaticPose, removeNeuralActionTransform, NeuralSkeletonAdapter } from './neuralCharacterAssets';
import { DIRECTOR_PROCEDURAL_ACTIONS, DIRECTOR_STATIC_POSE_MAP, DIRECTOR_STATIC_POSES, sampleDirectorProceduralAction } from '../../../application/directorMotion';

function loadRig(model = 'geno') {
  // Read the actual shipped GLB hierarchy; no renderer or synthetic joint axes.
  const buffer = readFileSync(`public/models/ai4animation/${model}.glb`);
  const gltf = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString());
  const nodes: THREE.Bone[] = gltf.nodes.map((node: any) => {
    const bone = new THREE.Bone(); bone.name = node.name;
    bone.position.fromArray(node.translation ?? [0, 0, 0]);
    bone.quaternion.fromArray(node.rotation ?? [0, 0, 0, 1]);
    bone.scale.fromArray(node.scale ?? [1, 1, 1]);
    bone.userData.neuralRest = { position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray() };
    return bone;
  });
  gltf.nodes.forEach((node: any, i: number) => node.children?.forEach((j: number) => nodes[i].add(nodes[j])));
  const group = new THREE.Group(); gltf.scenes[gltf.scene ?? 0].nodes.forEach((i: number) => group.add(nodes[i]));
  group.userData.neuralReady = true;
  group.userData.neuralModelId = `ai4animation-${model}`;
  return group;
}
function point(group: THREE.Group, name: string) { return group.getObjectByName(name)!.getWorldPosition(new THREE.Vector3()); }

describe('imported character action directions', () => {
  for (const model of ['geno']) {
    it(`${model}: hands clap in front and close toward each other`, () => {
      const rig = loadRig(model);
      const distances: number[] = [];
      for (let t = 0; t <= 1.1; t += 0.05) {
        applyNeuralStaticPose(rig, sampleDirectorProceduralAction('clap', t));
        const left = point(rig, 'LeftHand'), right = point(rig, 'RightHand');
        expect(left.x).toBeGreaterThanOrEqual(right.x - 0.015);
        expect(left.z).toBeGreaterThan(point(rig, 'LeftArm').z + 0.15);
        expect(right.z).toBeGreaterThan(point(rig, 'RightArm').z + 0.15);
        distances.push(left.distanceTo(right));
      }
      expect(Math.max(...distances) - Math.min(...distances)).toBeGreaterThan(0.1);
      expect(Math.min(...distances)).toBeLessThan(0.1);
    });
  }
  it('forward arm swing and knee bend use the character axes', () => {
    const rig = loadRig();
    applyNeuralStaticPose(rig, { leftShoulder: { x: -1.2 }, leftKnee: { x: 1 } });
    expect(point(rig, 'LeftHand').z).toBeGreaterThan(point(rig, 'LeftArm').z + 0.3);
    expect(point(rig, 'LeftFoot').z).toBeLessThan(point(rig, 'LeftLeg').z - 0.2);
  });
  it('sampling every action is repeatable after other poses and root transforms', () => {
    const rig = loadRig();
    for (const action of DIRECTOR_PROCEDURAL_ACTIONS) {
      const pose = sampleDirectorProceduralAction(action.id, action.durationSeconds * 0.3);
      applyNeuralStaticPose(rig, pose);
      const expected = rig.getObjectByName('LeftArm')!.quaternion.clone();
      applyNeuralStaticPose(rig, sampleDirectorProceduralAction('wave', 0.5));
      rig.rotation.y = 1.5; rig.scale.setScalar(2);
      applyNeuralStaticPose(rig, pose);
      expect(rig.getObjectByName('LeftArm')!.quaternion.angleTo(expected)).toBeLessThan(1e-6);
    }
  });
  it('forward lean and bow move the head forward; backward lean moves it back', () => {
    const rig = loadRig();
    applyNeuralStaticPose(rig, {});
    const neutral = point(rig, 'Head').z;
    for (const id of ['lean-forward', 'lean-back']) {
      applyNeuralStaticPose(rig, DIRECTOR_STATIC_POSE_MAP[id]);
      expect((point(rig, 'Head').z - neutral) * (id === 'lean-forward' ? 1 : -1)).toBeGreaterThan(0.12);
    }
    applyNeuralStaticPose(rig, sampleDirectorProceduralAction('bow', 1.2));
    expect(point(rig, 'Head').z - neutral).toBeGreaterThan(0.3);
  });
  it('look up/down and left/right turn the face in the labeled direction', () => {
    const rig = loadRig();
    for (const [id, axis, sign] of [
      ['look-up', 'y', 1], ['look-down', 'y', -1], ['look-left', 'x', 1], ['look-right', 'x', -1],
    ] as const) {
      applyNeuralStaticPose(rig, DIRECTOR_STATIC_POSE_MAP[id]);
      const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.getObjectByName('Head')!.getWorldQuaternion(new THREE.Quaternion()));
      expect(direction[axis] * sign).toBeGreaterThan(0.35);
    }
  });
  it('hands on hips and crossed arms reach the named body regions', () => {
    const rig = loadRig();
    applyNeuralStaticPose(rig, DIRECTOR_STATIC_POSE_MAP['hands-on-hips']);
    const hip = point(rig, 'Hips');
    for (const side of ['Left', 'Right']) {
      const hand = point(rig, side + 'Hand');
      expect(Math.abs(hand.y - hip.y)).toBeLessThan(0.15);
      expect(Math.abs(hand.z - hip.z)).toBeLessThan(0.12);
      expect(hand.x * (side === 'Left' ? 1 : -1)).toBeGreaterThan(0.1);
    }
    applyNeuralStaticPose(rig, DIRECTOR_STATIC_POSE_MAP['arms-crossed']);
    expect(point(rig, 'LeftHand').x).toBeLessThan(0);
    expect(point(rig, 'RightHand').x).toBeGreaterThan(0);
    for (const side of ['Left', 'Right']) {
      const hand = point(rig, side + 'Hand');
      expect(hand.y).toBeGreaterThan(hip.y + 0.2);
      expect(hand.y).toBeLessThan(point(rig, 'Neck').y);
    }
  });
  it('phone reaches the head instead of remaining stretched in front', () => {
    const rig = loadRig();
    applyNeuralStaticPose(rig, sampleDirectorProceduralAction('phone', 0.5));
    expect(point(rig, 'RightHand').distanceTo(point(rig, 'Head'))).toBeLessThan(0.2);
  });
  it('side step spreads the legs to the corresponding sides', () => {
    const rig = loadRig();
    applyNeuralStaticPose(rig, sampleDirectorProceduralAction('side-step', 0.325));
    expect(point(rig, 'LeftLeg').x).toBeGreaterThan(point(rig, 'LeftUpLeg').x + 0.1);
    expect(point(rig, 'RightLeg').x).toBeLessThan(point(rig, 'RightUpLeg').x - 0.1);
  });
  it('seated, squatting and kneeling poses keep their supports at the floor', () => {
    const rig = loadRig();
    applyNeuralStaticPose(rig, {});
    const contacts = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'].map(name => ({name, height: point(rig, name).y}));
    for (const id of ['sit-upright', 'sit-relaxed', 'squat-low', 'kneel-one', 'kneel-two']) {
      applyNeuralStaticPose(rig, DIRECTOR_STATIC_POSE_MAP[id], id);
      applyNeuralCharacterTransform(rig, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
      const support = Math.min(...contacts.map(({name, height}) => point(rig, name).y - height),
        ...(id.startsWith('kneel-') ? [point(rig, 'LeftLeg').y - 0.04, point(rig, 'RightLeg').y - 0.04] : []));
      expect(Math.abs(support)).toBeLessThan(0.035);
      expect(point(rig, 'Hips').y).toBeLessThan(0.65);
    }
  });
  it('lying rotation composes beneath route yaw and survives repeated scene updates', () => {
    const rig = loadRig();
    applyNeuralStaticPose(rig, DIRECTOR_STATIC_POSE_MAP['lie-back'], 'lie-back');
    for (const yaw of [0, Math.PI / 2, Math.PI]) {
      applyNeuralCharacterTransform(rig, { x: 3, y: 0, z: 2 }, { x: 0, y: yaw, z: 0 }, { x: 1, y: 1, z: 1 });
      const body = point(rig, 'Head').sub(point(rig, 'Hips'));
      expect(Math.abs(body.y)).toBeLessThan(0.05);
      expect(new THREE.Vector3(0, 0, 1).applyQuaternion(rig.quaternion).y).toBeGreaterThan(0.99);
    }
    applyNeuralStaticPose(rig, {});
    applyNeuralCharacterTransform(rig, { x: 3, y: 0, z: 2 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    expect(point(rig, 'Head').y - point(rig, 'Hips').y).toBeGreaterThan(0.6);
  });
  it('breathing scale and jump height survive the object transform', () => {
    const rig = loadRig();
    const pose = { scaleY: 1.1, groupY: 0.4 };
    applyNeuralStaticPose(rig, pose);
    applyNeuralCharacterTransform(rig, { x: 2, y: 3, z: 4 }, { x: 0, y: 0.7, z: 0 }, { x: 1, y: 2, z: 1 });
    expect(rig.scale.y).toBeCloseTo(2.2);
    expect(rig.position.y).toBeCloseTo(3.8);
  });
  it('all static poses retain finite joint transforms and switch back to neutral', () => {
    const rig = loadRig();
    applyNeuralStaticPose(rig, {});
    const neutral = point(rig, 'LeftHand');
    for (const definition of DIRECTOR_STATIC_POSES) {
      applyNeuralStaticPose(rig, definition.pose, definition.id);
      rig.traverse(bone => expect([...bone.position.toArray(), ...bone.quaternion.toArray()].every(Number.isFinite)).toBe(true));
      applyNeuralStaticPose(rig, {});
      expect(point(rig, 'LeftHand').distanceTo(neutral)).toBeLessThan(1e-6);
    }
  });

  it('first pose setup is independent of a preexisting rotated, nonuniformly scaled root', () => {
    const neutral = loadRig(), transformed = loadRig();
    transformed.rotation.set(0.3, 1.2, -0.2); transformed.scale.set(0.7, 1.6, 1.2); transformed.position.set(3, 2, -5);
    for (const definition of DIRECTOR_STATIC_POSES) {
      applyNeuralStaticPose(neutral, definition.pose);
      applyNeuralStaticPose(transformed, definition.pose);
      neutral.traverse(bone => {
        const counterpart = transformed.getObjectByName(bone.name);
        if (bone.name && counterpart) expect(bone.quaternion.clone().normalize().angleTo(counterpart.quaternion.clone().normalize())).toBeLessThan(1e-6);
      });
    }
  });

  it('entering live control removes static pose channels while retaining the authored root', () => {
    const rig = loadRig();
    const rotation = { x: 0.2, y: 0.7, z: 0 };
    applyNeuralStaticPose(rig, { ...DIRECTOR_STATIC_POSE_MAP['lie-back'], scaleY: 1.1 });
    applyNeuralCharacterTransform(rig, { x: 3, y: 2, z: 4 }, rotation, { x: 1, y: 1.3, z: 1 });
    removeNeuralActionTransform(rig);
    expect(rig.position.toArray()).toEqual([3, 2, 4]);
    expect(rig.scale.y).toBeCloseTo(1.3);
    expect(rig.quaternion.angleTo(new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z)))).toBeLessThan(1e-6);
    removeNeuralActionTransform(rig);
    expect(rig.position.y).toBe(2);
  });

  it('neutral wrists and fingertips stay outside the thighs with a natural outward hang', () => {
    const rig = loadRig();
    applyNeuralStaticPose(rig, {});
    for (const side of ['Left', 'Right']) {
      const sign = side === 'Left' ? 1 : -1;
      const shoulder = point(rig, side + 'Arm'), elbow = point(rig, side + 'ForeArm');
      const wrist = point(rig, side + 'Hand'), finger = point(rig, side + 'HandMiddle3');
      const hip = point(rig, side + 'UpLeg');
      expect((wrist.x - hip.x) * sign).toBeGreaterThan(0.095);
      expect((elbow.x - shoulder.x) * sign).toBeGreaterThan(0.04);
      expect((finger.x - wrist.x) * sign).toBeGreaterThan(0.015);
      const fingerDirection = finger.clone().sub(wrist).normalize();
      expect(fingerDirection.y).toBeLessThan(-0.95);
      expect(fingerDirection.x * sign).toBeGreaterThan(0.15);
    }
  });

  it('actual hand skin stays outside the legs in neutral, attention and breathing poses', async () => {
    const buffer = readFileSync('public/models/ai4animation/geno.glb');
    const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
    const rig = new THREE.Group(); rig.add(gltf.scene);
    rig.traverse(bone => { if ((bone as THREE.Bone).isBone) bone.userData.neuralRest = { position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray() }; });
    for (const [id, pose] of [
      ['stand-neutral', DIRECTOR_STATIC_POSE_MAP['stand-neutral']],
      ['stand-attention', DIRECTOR_STATIC_POSE_MAP['stand-attention']],
      ...Array.from({ length: 24 }, (_, i) => i * 2.6 / 24).map(time => ['idle-breath ' + time, sampleDirectorProceduralAction('idle-breath', time)] as const),
    ] as const) {
      applyNeuralStaticPose(rig, pose);
      const vertices: Record<string, THREE.Vector3[]> = { LeftHand: [], RightHand: [], LeftLeg: [], RightLeg: [] };
      rig.traverse(object => {
        if (!(object as THREE.SkinnedMesh).isSkinnedMesh) return;
        const skin = object as THREE.SkinnedMesh; skin.skeleton.update();
        const weights = skin.geometry.getAttribute('skinWeight'), indices = skin.geometry.getAttribute('skinIndex');
        for (let i = 0; i < weights.count; i++) {
          const w = new THREE.Vector4(weights.getX(i), weights.getY(i), weights.getZ(i), weights.getW(i)), ids = new THREE.Vector4(indices.getX(i), indices.getY(i), indices.getZ(i), indices.getW(i));
          let dominant = 0;
          for (let channel = 1; channel < 4; channel++) if (w.getComponent(channel) > w.getComponent(dominant)) dominant = channel;
          const name = skin.skeleton.bones[ids.getComponent(dominant)].name;
          const key = /^LeftHand/.test(name) ? 'LeftHand' : /^RightHand/.test(name) ? 'RightHand' : /^Left(UpLeg|Leg)/.test(name) ? 'LeftLeg' : /^Right(UpLeg|Leg)/.test(name) ? 'RightLeg' : null;
          if (key) vertices[key].push(skin.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(skin.matrixWorld));
        }
      });
      for (const side of ['Left', 'Right']) {
        const sign = side === 'Left' ? 1 : -1, hands = vertices[side + 'Hand'];
        expect(hands.length).toBeGreaterThan(50);
        const minY = Math.min(...hands.map(p => p.y)), maxY = Math.max(...hands.map(p => p.y));
        const legs = vertices[side + 'Leg'].filter(p => p.y >= minY && p.y <= maxY);
        expect(legs.length).toBeGreaterThan(10);
        const clearance = Math.min(...hands.map(p => p.x * sign)) - Math.max(...legs.map(p => p.x * sign));
        expect(clearance, id + " " + side).toBeGreaterThan(0.005);
      }
    }
  });

  it('cranberry: static poses, hand poses and skeleton adapter operate with valid transforms', () => {
    const rig = loadRig('cranberry');
    applyNeuralStaticPose(rig, { leftShoulder: { x: -1.0 }, leftKnee: { x: 0.8 }, leftHand: { index: 0.8 } });
    const wrist = point(rig, 'b_l_wrist'), arm = point(rig, 'b_l_arm');
    expect(Number.isFinite(wrist.x)).toBe(true);
    expect(Number.isFinite(wrist.y)).toBe(true);
    expect(Number.isFinite(wrist.z)).toBe(true);
    // Forward shoulder swing moves wrist forward (+Z)
    expect(wrist.z).toBeGreaterThan(arm.z + 0.1);

    const adapter = new NeuralSkeletonAdapter(rig, {
      jointNames: [
        "Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase",
        "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase",
        "Spine", "Spine1", "Spine2", "Spine3", "Neck", "Head",
        "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
        "RightShoulder", "RightArm", "RightForeArm", "RightHand"
      ],
      restPositions: [],
      restMatrices: [],
      guidances: {}
    } as any);

    expect(adapter.jointNames).toHaveLength(53);
    expect(adapter.bones).toHaveLength(53);
    const frame = adapter.capture(1.5);
    expect(frame.joints).toHaveLength(53 * 7);
    expect(frame.jointBases).toHaveLength(53 * 9);
    expect(frame.joints.every(Number.isFinite)).toBe(true);
  });
});
