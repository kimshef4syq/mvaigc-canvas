async (page) => {
  await page.setViewportSize({width:1340,height:1000});
  const report=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/.vite/deps/three.js');
    const assets=await import('/src/features/canvas/ui/director/motion/neuralCharacterAssets.ts');
    const motions=await import('/src/features/canvas/ui/director/motion/originalMotionAssets.ts');
    const meta=await(await fetch('/models/ai4animation/locomotion_biped_meta.json')).json();
    const reference=await(await fetch('/scripts/ai4animation/fixtures/skin-reference.json')).json();
    const vertices=new Float32Array(await(await fetch('/scripts/ai4animation/fixtures/skin-vertices.bin')).arrayBuffer());
    await assets.ensureNeuralModel('ai4animation-geno');
    document.body.innerHTML='';document.documentElement.style.cssText='height:auto;overflow:visible';document.body.style.cssText='margin:0;height:auto;overflow:visible;background:#222;color:white;font:12px sans-serif';
    const root=document.createElement('section');root.id='original-compare';root.style.cssText='display:grid;grid-template-columns:repeat(6,220px);gap:3px;padding:3px';document.body.append(root);
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(220,240);renderer.setPixelRatio(1);
    let maxPixelDifference=0;
    for(let ci=0;ci<reference.cases.length;ci++) {
      if(![0,2,4].includes(ci%5))continue;
      const test=reference.cases[ci],scene=new THREE.Scene();scene.background=new THREE.Color('#2b3038');
      const group=assets.createNeuralCharacter('ai4animation-geno',1.7);group.scale.setScalar(1);
      const adapter=new assets.NeuralSkeletonAdapter(group,meta),motion=await motions.loadOriginalMotion(test.motion),pose=motions.sampleOriginalMotion(motion,test.time);adapter.apply(pose);
      let skinned;group.traverse(o=>{if(o.isSkinnedMesh)skinned=o;});
      const geometry=skinned.geometry.clone(),vertexCount=geometry.attributes.position.count;
      geometry.setAttribute('position',new THREE.BufferAttribute(vertices.slice(ci*vertexCount*3,(ci+1)*vertexCount*3),3));
      geometry.computeBoundingSphere();
      const material=new THREE.MeshBasicMaterial({color:0xbfc3c7});skinned.material=material;
      const source=new THREE.Mesh(geometry,material);
      const camera=new THREE.PerspectiveCamera(36,220/240,0.01,100);
      const hip=pose.positions[0];camera.position.set(hip.x+2.8,1.6,hip.z+3.6);camera.lookAt(hip.x,0.9,hip.z);
      const images=[];
      for(const [label,model]of[['原 Python 蒙皮',source],['预演台',group]]) {
        scene.add(model);renderer.render(scene,camera);const pixels=new Uint8Array(220*240*4);renderer.getContext().readPixels(0,0,220,240,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,pixels);images.push(pixels);
        const card=document.createElement('div'),caption=document.createElement('div');caption.textContent=`${motion.definition.label} ${test.time.toFixed(2)}s · ${label}`;const image=new Image();image.src=renderer.domElement.toDataURL();card.append(caption,image);root.append(card);scene.remove(model);
      }
      let difference=0;for(let i=0;i<images[0].length;i++)difference+=Math.abs(images[0][i]-images[1][i]);maxPixelDifference=Math.max(maxPixelDifference,difference/images[0].length);
      geometry.dispose();material.dispose();
    }
    await Promise.all([...root.querySelectorAll('img')].map(i=>i.decode()));renderer.dispose();renderer.forceContextLoss();
    return {pairedFrames:15,maxMeanPixelDifference:maxPixelDifference};
  });
  await page.locator('#original-compare').screenshot({path:'output/playwright/geno-original-comparison.png'});
  return report;
}
