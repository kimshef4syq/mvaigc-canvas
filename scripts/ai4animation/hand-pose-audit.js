// Playwright CLI, dedicated audit tab; does not modify project data.
async (page) => {
  await page.setViewportSize({width:1260,height:900});
  await page.evaluate(async () => {
    const T=await import('/node_modules/.vite/deps/three.js');
    const a=await import('/src/features/canvas/ui/director/motion/neuralCharacterAssets.ts');
    const {HAND_POSES}=await import('/src/features/canvas/domain/directorHandPose.ts');
    await a.ensureNeuralModel('ai4animation-geno');
    document.body.innerHTML='';document.documentElement.style.cssText='height:auto;overflow:visible';
    document.body.style.cssText='margin:0;background:#222;color:white;font:15px sans-serif;height:auto;overflow:visible';
    const root=document.createElement('div');root.style.cssText='display:grid;grid-template-columns:repeat(3,410px);gap:5px';document.body.append(root);
    const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(410,400);
    for(const name of ['relaxed','open','fist','point','phone','wrist']) {
      const model=a.createNeuralCharacter('ai4animation-geno',1.7);
      a.applyNeuralStaticPose(model,name==='wrist'?{rightHand:HAND_POSES.open,rightWrist:{x:0.6,y:0.4,z:0.25}}:{rightHand:HAND_POSES[name]});
      a.applyNeuralCharacterTransform(model,{x:0,y:0,z:0},{x:0,y:0,z:0},{x:1,y:1,z:1});
      const scene=new T.Scene();scene.background=new T.Color('#2b3038');scene.add(model,new T.HemisphereLight(0xffffff,0x777777,3));
      const light=new T.DirectionalLight(0xffffff,3);light.position.set(-3,4,5);scene.add(light);
      const hand=model.getObjectByName('RightHand').getWorldPosition(new T.Vector3());
      const camera=new T.PerspectiveCamera(32,410/400,.005,20);camera.position.copy(hand).add(new T.Vector3(-.36,.06,.32));camera.lookAt(hand.x,hand.y-.08,hand.z);
      renderer.render(scene,camera);
      const card=document.createElement('div'),caption=document.createElement('div');caption.textContent={relaxed:'放松',open:'张开',fist:'握拳',point:'指向',phone:'握持',wrist:'手腕独立旋转'}[name];card.append(caption);
      const img=new Image();img.src=renderer.domElement.toDataURL();card.append(img);root.append(card);await img.decode();
    }
    renderer.dispose();renderer.forceContextLoss();
  });
  await page.screenshot({path:'output/playwright/geno-hand-gestures.png',fullPage:true});
}
