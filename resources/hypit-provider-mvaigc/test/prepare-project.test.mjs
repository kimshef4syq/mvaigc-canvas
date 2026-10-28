import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeRuntime, readJson, atomicJson, run } from '../prepare-project.mjs';

test('managed runtime preserves user endpoints and never stores account/password', () => {
  const user = { format: 'hypit.runtime-local@1', dataRoot: 'custom-data', credentials: { local: { use: 'custom-store' } },
    endpoints: { custom: { use: 'custom-provider', config: { important: true } } }, bindings: { custom: 'custom' } };
  const result = mergeRuntime(user, 'http://127.0.0.1:9090');
  assert.deepEqual(result.endpoints.custom, user.endpoints.custom);
  assert.deepEqual(result.credentials.local, user.credentials.local);
  assert.equal(result.dataRoot, 'custom-data');
  assert.equal(result.bindings.custom, 'custom');
  assert.equal(result.endpoints['canvas.mvaigc'].config.baseUrl, 'http://127.0.0.1:9090');
  assert.deepEqual(result.endpoints['canvas.mvaigc'].config.apiKey, { store: 'env', key: 'OSC_MVAIGC_TOKEN' });
  assert.equal(user.endpoints['canvas.mvaigc'], undefined);
});

test('malformed existing configuration is preserved, never treated as an empty project', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canvas-bootstrap-'));
  try {
    const path = join(dir, 'hypit.runtime.json');
    await writeFile(path, '{ broken');
    await assert.rejects(readJson(path, {}), /Invalid/);
    assert.equal(await readFile(path, 'utf8'), '{ broken');
    assert.deepEqual(await readJson(join(dir, 'missing'), {}), {});
    await atomicJson(join(dir, 'new.json'), { ok: true });
    assert.deepEqual(await readJson(join(dir, 'new.json')), { ok: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('environment commands return actual worker status output to the caller', async () => {
  const text = await run(process.execPath, ['-e', 'console.log(JSON.stringify({worker:{state:"running"},builds:{working:0}}))'], tmpdir());
  assert.equal(JSON.parse(text).worker.state, 'running');
});
