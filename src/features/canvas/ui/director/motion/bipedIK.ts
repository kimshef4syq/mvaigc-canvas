// Matrix-preserving port of AI4AnimationPy Actor/FABRIK/LegIK (CC BY-NC 4.0).
import * as THREE from 'three';
import { basisQuaternion, matrixFromRows, mixBasis, poseBasis } from './bipedMath';
import type { BipedMeta, BipedPose } from './types';

export class BipedIK {
  private readonly zeroPositions: THREE.Vector3[];
  private readonly children: number[][];
  private readonly initialized = [false, false, false, false];
  private readonly targets: Array<{ position: THREE.Vector3; rotation: THREE.Matrix4 }>;
  constructor(private readonly meta: BipedMeta, initial: BipedPose) {
    this.zeroPositions = meta.zeroMatrices.map(m => new THREE.Vector3().setFromMatrixPosition(matrixFromRows(m)));
    this.children = meta.jointNames.map(() => []);
    meta.parentIndices.forEach((parent, i) => { if (parent !== i) this.children[parent].push(i); });
    this.targets = meta.contactIndices.map(i => ({ position: initial.positions[i].clone(), rotation: poseBasis(initial,i).clone() }));
  }
  private transform(p:BipedPose,index:number) { return poseBasis(p,index).clone().setPosition(p.positions[index]); }
  private set(p:BipedPose,index:number,position:THREE.Vector3,rotation:THREE.Matrix4,fk=false) {
    const delta=rotation.clone().setPosition(position).multiply(this.transform(p,index).invert());
    p.positions[index].copy(position);
    p.rotationBases![index]=rotation.clone().setPosition(0,0,0);
    p.rotations[index]=basisQuaternion(rotation);
    if (!fk) return;
    const rotationDelta=delta.clone().setPosition(0,0,0);
    const visit=(child:number) => {
      p.positions[child].applyMatrix4(delta);
      p.rotationBases![child].premultiply(rotationDelta);
      p.rotations[child]=basisQuaternion(p.rotationBases![child]);
      this.children[child].forEach(visit);
    };
    this.children[index].forEach(visit);
  }
  private alignment(p:BipedPose,index:number,child:number,target:THREE.Vector3) {
    const from=this.zeroPositions[child].clone().applyMatrix4(poseBasis(p,index)).normalize();
    const to=target.clone().sub(p.positions[index]).normalize();
    return new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(from,to)).multiply(poseBasis(p,index));
  }
  restore(p:BipedPose) {
    p.rotationBases=p.rotations.map((_,i)=>poseBasis(p,i).clone());
    const previous=p.positions.map(v=>v.clone());
    p.positions.forEach((v,i)=>{ const parent=this.meta.parentIndices[i]; if(i!==parent) v.copy(previous[i]).sub(previous[parent]).normalize().multiplyScalar(this.zeroPositions[i].length()).add(previous[parent]); });
    this.children.forEach((children,i)=>{if(children.length===1) this.set(p,i,p.positions[i].clone(),this.alignment(p,i,children[0],p.positions[children[0]]));});
  }
  private solveChain(p:BipedPose,chain:number[],target:THREE.Vector3,rotation:THREE.Matrix4,pole?:THREE.Vector3) {
    // Upstream solves in the root's matrix space, including its non-orthogonal axes.
    const root=this.transform(p,chain[0]), inverse=root.clone().invert();
    const positions=chain.map(i=>p.positions[i].clone().applyMatrix4(inverse));
    const lengths=chain.map((i,j)=>j ? p.positions[i].distanceTo(p.positions[chain[j-1]]) : 0);
    const localTarget=target.clone().applyMatrix4(inverse);
    positions[positions.length-1].copy(localTarget);
    for(let i=positions.length-2;i>0;i--) positions[i].sub(positions[i+1]).normalize().multiplyScalar(lengths[i+1]).add(positions[i+1]);
    for(let i=1;i<positions.length;i++) positions[i].sub(positions[i-1]).normalize().multiplyScalar(lengths[i]).add(positions[i-1]);
    if(pole) {
      const axis=localTarget.clone().sub(positions[0]).normalize();
      const poleVector=pole.clone().applyMatrix4(inverse).sub(positions[0]); poleVector.addScaledVector(axis,-poleVector.dot(axis)).normalize();
      for(let i=1;i<positions.length-1;i++) {
        const relative=positions[i].clone().sub(positions[0]), projected=relative.clone().addScaledVector(axis,-relative.dot(axis)).normalize();
        if(!projected.lengthSq()||!poleVector.lengthSq()) continue;
        const angle=Math.atan2(new THREE.Vector3().crossVectors(projected,poleVector).dot(axis),projected.dot(poleVector));
        positions[i].copy(relative.applyAxisAngle(axis,angle).add(positions[0]));
      }
    }
    for(let i=0;i<chain.length-1;i++) {
      const index=chain[i], position=positions[i].clone().applyMatrix4(root);
      // Compute alignment with the assigned position, before FK mutates descendants.
      const from=this.zeroPositions[chain[i+1]].clone().applyMatrix4(poseBasis(p,index)).normalize();
      const to=positions[i+1].clone().applyMatrix4(root).sub(position).normalize();
      const desired=new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(from,to)).multiply(poseBasis(p,index));
      this.set(p,index,position,desired,true);
    }
    this.set(p,chain[chain.length-1],positions[positions.length-1].clone().applyMatrix4(root),rotation,true);
  }
  solve(p:BipedPose) {
    for(let leg=0;leg<2;leg++) {
      const ankleSlot=leg*2,ballSlot=ankleSlot+1,ankle=this.meta.contactIndices[ankleSlot],ball=this.meta.contactIndices[ballSlot];
      const knee=this.meta.parentIndices[ankle],hip=this.meta.parentIndices[knee];
      const updateTarget=(slot:number,bone:number)=>{
        const target=this.targets[slot],weight=p.contacts[slot];
        if(!this.initialized[slot]) {target.position.copy(p.positions[bone]);target.rotation.copy(poseBasis(p,bone));this.initialized[slot]=true;}
        const baseline=this.meta.restPositions[bone][1],locked=target.position.clone();
        locked.y=Math.max(THREE.MathUtils.lerp(locked.y,baseline,weight),baseline);
        target.position.copy(p.positions[bone]).lerp(locked,weight);
        target.rotation=mixBasis(poseBasis(p,bone),target.rotation,0.5*weight);
        return target;
      };
      const ankleTarget=updateTarget(ankleSlot,ankle);
      const pole=new THREE.Vector3(0,0,1).applyMatrix4(this.transform(p,knee));
      this.solveChain(p,[hip,knee,ankle],ankleTarget.position,ankleTarget.rotation,pole);
      const ballTarget=updateTarget(ballSlot,ball),height=ballTarget.position.y,direction=ballTarget.position.clone().sub(ankleTarget.position);direction.y=0;
      if(direction.length()<1e-6) direction.set(1,0,0);else direction.normalize();
      const distance=new THREE.Vector3().fromArray(this.meta.restPositions[ankle]).distanceTo(new THREE.Vector3().fromArray(this.meta.restPositions[ball]));
      ballTarget.position.copy(ankleTarget.position).addScaledVector(direction,Math.sqrt(Math.max(distance**2-(height-ankleTarget.position.y)**2,0)));ballTarget.position.y=height;
      this.solveChain(p,[ankle,ball],ballTarget.position,ballTarget.rotation);
    }
  }
}
