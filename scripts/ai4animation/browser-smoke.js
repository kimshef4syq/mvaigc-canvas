async (page) => {
  const result = await page.evaluate(async () => {
    const { NeuralLocomotionEngine } = await import('/src/features/canvas/ui/director/motion/NeuralLocomotionEngine.ts');
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const assets = await import('/src/features/canvas/ui/director/motion/neuralCharacterAssets.ts');
    const engine = new NeuralLocomotionEngine();
    await engine.initialize(); await assets.ensureNeuralModel('ai4animation-geno');
    const fixtureResponse = await fetch('/scripts/ai4animation/fixtures/network-parity.json');
    const fixtures = await fixtureResponse.json();
    const parity = {};
    for (const [name, cases] of Object.entries(fixtures)) {
      const session = name === 'locomotion_biped' ? engine.network : engine.contacts;
      let maxError = 0;
      for (const test of cases) {
        const output = await engine.run(session, Float32Array.from(test.input), test.output.length);
        output.forEach((value, i) => {
          const difference = Math.abs(value - test.output[i]);
          if (difference > 1e-4 + 1e-4 * Math.abs(test.output[i])) throw new Error(name + ' browser parity failed at ' + i);
          maxError = Math.max(maxError, difference);
        });
      }
      parity[name] = maxError;
    }
    const mesh = assets.createNeuralCharacter('ai4animation-geno', 1.7);
    const adapter = new assets.NeuralSkeletonAdapter(mesh, engine.meta);
    const metrics = [], errors = [], poses = [];
    for (let batch = 0; batch < 30; batch++) {
      for (let i = 0; i < 6; i++) {
        const started = performance.now();
        const velocity = new THREE.Vector3(batch < 20 ? 0.5 : 0, 0, batch < 20 ? 1 : 0);
        adapter.apply(engine.update({velocity, direction: new THREE.Vector3(), style:'Neutral'}, 1 / 60));
        metrics.push(performance.now() - started);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      if (engine.error) errors.push(engine.error.message);
      poses.push(engine.pose.rootPosition.toArray());
    }
    const recording = adapter.capture(3);
    const before = recording.joints;
    assets.resetNeuralPose(mesh);
    assets.applyBakedSkeleton(mesh, engine.meta.jointNames, recording);
    const replayError = Math.max(...adapter.capture(3).joints.map((value, i) => Math.abs(value - before[i])));
    const result = {parity, replayError, errors, root: engine.pose.rootPosition.toArray(), rootAtMoveEnd: poses[19], inferenceMs: engine.lastInferenceMs, updateMaxMs: Math.max(...metrics), finite: recording.joints.every(Number.isFinite), joints:recording.joints.length};
    await engine.dispose();
    return result;
  });
  await page.evaluate(result => window.__neuralSmokeResult = result, result);
}
