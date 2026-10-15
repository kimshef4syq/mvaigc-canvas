async (page) => {
  await page.evaluate(async () => {
    const {NeuralLocomotionEngine}=await import('/src/features/canvas/ui/director/motion/NeuralLocomotionEngine.ts');
    const THREE=await import('/node_modules/.vite/deps/three.js');
    const {poseBasis,lookRotation}=await import('/src/features/canvas/ui/director/motion/bipedMath.ts');
    const manifest=await (await fetch('/scripts/ai4animation/fixtures/continuous/manifest.json')).json();
    const report=[];window.__continuousReport=report;
    for(const test of manifest.cases) {
      const truth=new Float32Array(await (await fetch('/scripts/ai4animation/fixtures/continuous/'+test.file)).arrayBuffer());
      const engine=new NeuralLocomotionEngine();await engine.initialize();
      let maxPosition=0,maxAngle=0,maxBasis=0,maxRoot=0,firstFailure=null;
      for(let frame=0;frame<test.frames;frame++) {
        const velocity=new THREE.Vector3(...(frame<60||frame>=540?[0,0,0]:frame<300?[0,0,1]:frame<420?[0.6,0,0.8]:[0,0,-1])).multiplyScalar(frame>=180&&frame<300?2:1);
        const direction=new THREE.Vector3(...(frame>=300&&frame<420?[1,0,0]:[0,0,0]));
        const pose=await engine.step({velocity,direction,style:test.style},1/60),offset=frame*test.stride;
        maxRoot=Math.max(maxRoot,pose.rootPosition.distanceTo(new THREE.Vector3().fromArray(truth,offset)));
        for(let i=0;i<23;i++) {
          const distance=pose.positions[i].distanceTo(new THREE.Vector3().fromArray(truth,offset+7+i*3));
          const expected=new THREE.Matrix4(),e=expected.elements;
          for(let row=0;row<3;row++)for(let column=0;column<3;column++)e[column*4+row]=truth[offset+76+i*9+row*3+column];
          const actual=poseBasis(pose,i);
          // Compare orientation of the native forward/up axes; raw bases need not be orthogonal.
          const rotation=m=>lookRotation(new THREE.Vector3().setFromMatrixColumn(m,2),new THREE.Vector3().setFromMatrixColumn(m,1));
          const angle=rotation(expected).angleTo(rotation(actual))*180/Math.PI;
          maxPosition=Math.max(maxPosition,distance);maxAngle=Math.max(maxAngle,angle);
          for(let j=0;j<16;j++) maxBasis=Math.max(maxBasis,Math.abs(poseBasis(pose,i).elements[j]-e[j]));
          if(!firstFailure&&(distance>0.01||angle>1))firstFailure={frame,joint:engine.meta.jointNames[i],distance,angle};
        }
      }
      report.push({style:test.style,maxPosition,maxAngle,maxBasis,maxRoot,firstFailure});await engine.dispose();
    }
  });
  return await page.evaluate(()=>window.__continuousReport);
}
