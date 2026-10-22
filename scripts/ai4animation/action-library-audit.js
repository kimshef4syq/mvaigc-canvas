// Playwright CLI: run-code --filename scripts/ai4animation/action-library-audit.js
// Use a dedicated audit tab: this replaces its DOM, without changing projects.
async (page) => {
  await page.setViewportSize({ width: 1340, height: 1000 });
  await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const assets = await import('/src/features/canvas/ui/director/motion/neuralCharacterAssets.ts');
    const motion = await import('/src/features/canvas/application/directorMotion.ts');
    await assets.ensureNeuralModel('ai4animation-geno');
    document.documentElement.style.cssText = 'height:auto;overflow:visible';
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;height:auto;overflow:visible;background:#222;color:white;font:13px sans-serif';
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(220, 240); renderer.setPixelRatio(1);
    const report = { staticPoses: motion.DIRECTOR_STATIC_POSES.length, proceduralActions: motion.DIRECTOR_PROCEDURAL_ACTIONS.length, sampledFrames: 0, finite: true };
    for (const [kind, entries] of [
      ['static', motion.DIRECTOR_STATIC_POSES.flatMap(entry => ['front', 'side'].map(view => ({ id: entry.id, pose: entry.pose, view })))],
      ['motion', motion.DIRECTOR_PROCEDURAL_ACTIONS.flatMap(entry => [0, 0.25, 0.5, 0.75].map(phase => ({ id: entry.id, pose: motion.sampleDirectorProceduralAction(entry.id, phase * entry.durationSeconds), phase, view: 'three-quarter' })))],
    ]) {
      const root = document.createElement('section'); root.id = `audit-${kind}`;
      root.style.cssText = 'display:grid;grid-template-columns:repeat(6,220px);gap:3px;padding:3px'; document.body.append(root);
      for (const entry of entries) {
        const scene = new THREE.Scene(); scene.background = new THREE.Color('#2b3038');
        scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 3));
        const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(3, 4, 5); scene.add(light);
        const model = assets.createNeuralCharacter('ai4animation-geno', 1.7);
        assets.applyNeuralStaticPose(model, entry.pose, entry.id);
        assets.applyNeuralCharacterTransform(model, {x:0,y:0,z:0}, {x:0,y:0,z:0}, {x:1,y:1,z:1});
        scene.add(model, new THREE.GridHelper(4, 20, 0xcccccc, 0x505860), new THREE.AxesHelper(0.5));
        const camera = new THREE.PerspectiveCamera(36, 220 / 240, 0.01, 20);
        camera.position.set(...(entry.view === 'front' ? [0, 1.3, 4.3] : entry.view === 'side' ? [4.3, 1.3, 0] : [3, 1.5, 3])); camera.lookAt(0, 0.85, 0);
        if (entry.id === 'lie-back') { camera.position.z -= 0.8; camera.lookAt(0, 0.25, -0.8); }
        renderer.render(scene, camera);
        const card = document.createElement('div'), caption = document.createElement('div');
        caption.textContent = `${entry.id} · ${entry.view}${entry.phase != null ? ` ${entry.phase}` : ''}`;
        card.append(caption); const image = new Image(); image.src = renderer.domElement.toDataURL(); card.append(image); root.append(card);
        model.traverse(bone => { report.finite &&= [...bone.position.toArray(), ...bone.quaternion.toArray()].every(Number.isFinite); });
        report.sampledFrames++;
      }
      await Promise.all([...root.querySelectorAll('img')].map(image => image.decode()));
    }
    window.__actionLibraryAudit = report; renderer.dispose(); renderer.forceContextLoss();
  });
  await page.locator('#audit-static').screenshot({ path: 'output/playwright/geno-static-poses.png' });
  await page.locator('#audit-motion').screenshot({ path: 'output/playwright/geno-procedural-actions.png' });
}
