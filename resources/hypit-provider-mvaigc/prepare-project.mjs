/** App-owned environment bootstrap; never shells out with interpolated paths. */
import { readFile, writeFile, mkdir, rename, copyFile, access, lstat, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

export async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error(`Invalid or unreadable configuration: ${path}`); }
}
export async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, path);
}
export async function run(command, args, cwd) {
  return await new Promise((res, rej) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 });
    let output = '';
    child.stdout.on('data', bytes => { if (output.length < 16000) output += bytes.toString(); });
    child.stderr.on('data', bytes => { if (output.length < 16000) output += bytes.toString(); });
    child.once('error', () => rej(new Error(`Cannot run ${command}; install Node.js/npm once in environment settings.`)));
    child.once('close', code => {
      if (code === 0) { res(output); return; }
      let detail = '';
      if (args[0] !== 'install') {
        try {
          const report = JSON.parse(output);
          detail = (report.diagnostics ?? []).map(item => `${item.code}: ${item.message}`).join('; ');
        } catch { detail = output; }
        detail = detail.replace(/https?:\/\/[^\s"<>]+/g, '[url]');
        if (process.env.OSC_MVAIGC_TOKEN) detail = detail.split(process.env.OSC_MVAIGC_TOKEN).join('[redacted]');
      }
      rej(new Error(`Hypit environment step ${args[0]} failed. ${detail.slice(0, 1600)} Existing project files were preserved.`));
    });
  });
}

export function mergeRuntime(original, baseUrl) {
  if (!original || typeof original !== 'object' || Array.isArray(original)) throw new Error('Invalid Hypit runtime object');
  if (original.credentials?.env && original.credentials.env.use !== '@hypit/credential-store-env') throw new Error('The existing env credential store is user-managed and incompatible; preserve it and resolve the conflict before launch.');
  if (original.endpoints?.['canvas.mvaigc'] && original.endpoints['canvas.mvaigc'].use !== 'mvaigc-provider') throw new Error('The canvas.mvaigc endpoint name is already used by another provider.');
  return {
    ...original, format: original.format ?? 'hypit.runtime-local@1',
    dataRoot: original.dataRoot ?? '.hypit/runtimes/local',
    credentials: { ...original.credentials, 'env': { use: '@hypit/credential-store-env' } },
    endpoints: {
      ...original.endpoints,
      'media.local': original.endpoints?.['media.local'] ?? { use: '@hypit/media-local' },
      'html.local': original.endpoints?.['html.local'] ?? { use: '@hypit/provider-html-local' },
      'image.opencv.local': original.endpoints?.['image.opencv.local'] ?? { use: '@hypit/provider-image-opencv-local' },
      'canvas.mvaigc': { use: 'mvaigc-provider', config: { baseUrl, apiKey: { store: 'env', key: 'OSC_MVAIGC_TOKEN' } } },
    },
    bindings: {
      ...original.bindings,
      '@hypit/nano-banana@1#nano-banana-pro': 'canvas.mvaigc',
      '@hypit/minimax-h3@1#minimax-h3': 'canvas.mvaigc',
      // Seedance 2.5 is a second exact model on the same mvaigc account. The
      // composer decides the element, so the binding must exist or Hypit
      // refuses to plan the request.
      '@hypit/seedance@1#seedance-2.5': 'canvas.mvaigc',
    },
  };
}
async function copySkill(source, target) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error('Skill source contains a symlink; choose a regular installed Hypit skill.');
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source)) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      await copySkill(join(source, entry), join(target, entry));
    }
  } else if (info.isFile()) {
    if (info.size > 4 * 1024 * 1024) throw new Error('Hypit skill file exceeds preparation limit');
    await copyFile(source, target);
  }
}
// npm can retain a file: dependency from the old lock entry even when its
// source directory changes. Evict only this managed package during an upgrade.
export async function installManagedProvider(projectDir, manifest, next) {
  const manifestPath = join(projectDir, 'package.json');
  const lockPath = join(projectDir, 'package-lock.json');
  const installedPath = join(projectDir, 'node_modules', 'mvaigc-provider');
  const savedPath = join(projectDir, '.canvas-agent', 'provider-install-backup');
  let oldLock;
  try { oldLock = await readFile(lockPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dirname(savedPath), { recursive: true });
  // Never overwrite a recovery copy from an interrupted install.
  try { await access(savedPath); throw new Error('A provider install backup exists; restore it before retrying.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let moved = false;
  try {
    await rename(installedPath, savedPath);
    moved = true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try {
    if (oldLock) {
      const lock = JSON.parse(oldLock);
      if (lock.packages) {
        delete lock.packages['node_modules/mvaigc-provider'];
        if (lock.packages['']?.dependencies) lock.packages[''].dependencies['mvaigc-provider'] = next.dependencies['mvaigc-provider'];
      }
      if (lock.dependencies) delete lock.dependencies['mvaigc-provider'];
      await atomicJson(lockPath, lock);
    }
    await atomicJson(manifestPath, next);
    await run('npm', ['install', '--install-links', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], projectDir);
    if (moved) await rm(savedPath, { recursive: true, force: true });
  } catch (error) {
    await atomicJson(manifestPath, manifest);
    if (oldLock) await writeFile(lockPath, oldLock); else await rm(lockPath, { force: true });
    await rm(installedPath, { recursive: true, force: true });
    if (moved) await rename(savedPath, installedPath);
    throw error;
  }
}

export async function prepareProject(input) {
  const { projectDir, cacheDir, baseUrl, skillSource } = input;
  const source = dirname(fileURLToPath(import.meta.url));
  const pkg = await readJson(join(source, 'package.json'), null);
  const entries = ['provider.js', 'endpoint.js', 'lifecycle.js', 'activation.js'];
  const digest = createHash('sha256').update(JSON.stringify(pkg));
  for (const entry of entries) digest.update(await readFile(join(source, 'dist', entry)));
  const hash = digest.digest('hex');
  const packageDir = join(cacheDir, `mvaigc-${hash.slice(0, 20)}`);
  await mkdir(join(packageDir, 'dist'), { recursive: true });
  for (const entry of entries) await copyFile(join(source, 'dist', entry), join(packageDir, 'dist', entry));
  // A real immutable npm version, rather than a mutable file: link per project.
  await atomicJson(join(packageDir, 'package.json'), {
    name: 'mvaigc-provider', version: `0.1.0-canvas.${hash.slice(0, 20)}`, private: true, type: 'module',
    hypit: pkg.hypit, exports: pkg.exports, files: ['dist'],
    dependencies: { '@hypit/generation': '0.1.0', '@hypit/hypit': '0.3.1', '@hypit/runtime-local': '0.1.1' },
  });
  const markerPath = join(projectDir, '.canvas-agent', 'environment.json');
  const marker = await readJson(markerPath, {});
  const manifestPath = join(projectDir, 'package.json');
  const manifest = await readJson(manifestPath, null);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid project package.json');
  const runtimePath = join(projectDir, 'hypit.runtime.json');
  // Parse before any install/mutation; corrupt user configuration is preserved.
  const oldRuntime = await readJson(runtimePath, {});
  const runtime = mergeRuntime(oldRuntime, baseUrl);
  let installed = false;
  try { await access(join(projectDir, 'node_modules', 'mvaigc-provider', 'dist', 'activation.js')); await access(join(projectDir, 'node_modules', '.bin', 'hypit')); installed = true; } catch {}
  if (marker.providerHash !== hash || !installed) {
    const version = marker.providerHash;
    // Explicit upgrade required for existing managed projects. Never auto-upgrade a locked environment.
    if (version && version !== hash && !input.upgradeEnvironment) throw new Error('This project has a locked Provider version. Use an explicit environment upgrade before switching versions.');
    await atomicJson(`${manifestPath}.canvas-backup`, manifest);
    const next = { ...manifest, dependencies: { ...manifest.dependencies, '@hypit/hypit': '0.3.1', 'mvaigc-provider': `file:${packageDir}` } };
    await installManagedProvider(projectDir, manifest, next);
  }
  // Project-local skills: no global writes, both clients discover their own directory.
  for (const client of ['.claude', '.agents']) {
    const target = join(projectDir, client, 'skills', 'hypit');
    try { await access(join(target, 'SKILL.md')); }
    catch { await copySkill(skillSource, target); }
  }
  const selectionPath = join(projectDir, '.hypit', 'runtime');
  let oldSelection = null;
  try { oldSelection = await readFile(selectionPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let hadRuntime = true;
  try { await access(runtimePath); } catch { hadRuntime = false; }
  const hypit = join(projectDir, 'node_modules', '.bin', process.platform === 'win32' ? 'hypit.cmd' : 'hypit');
  if (hadRuntime && (marker.providerHash !== hash || JSON.stringify(oldRuntime) !== JSON.stringify(runtime))) {
    const status = JSON.parse(await run(hypit, ['runtime', 'status', runtimePath, '--json'], projectDir));
    const builds = status.builds ?? {};
    if (['submitting', 'working', 'savingResult'].some(key => Number(builds[key]) > 0) || Number(status.capacity?.active) > 0) {
      throw new Error('This project still has active Hypit work. Let it finish before refreshing the environment; no generation was resubmitted.');
    }
    // Hypit reuses a running worker by dataRoot, without checking profile/code
    // changes. Refresh only an idle worker, preserving checkpointed task state.
    if (status.worker?.state === 'running') await run(hypit, ['runtime', 'down', runtimePath], projectDir);
  }
  await atomicJson(`${runtimePath}.canvas-backup`, oldRuntime);
  await atomicJson(runtimePath, runtime);
  try {
    await run(hypit, ['runtime', 'use', runtimePath], projectDir);
    // A plain doctor without a selected runtime only checks Results. Explicitly
    // validate the actual managed endpoint before declaring preparation ready.
    await run(hypit, ['doctor', '--runtime', runtimePath, '--endpoint', 'canvas.mvaigc', '--json'], projectDir);
  } catch (error) {
    if (hadRuntime) await atomicJson(runtimePath, oldRuntime); else await rm(runtimePath, { force: true });
    if (oldSelection) await writeFile(selectionPath, oldSelection); else await rm(selectionPath, { force: true });
    throw error;
  }
  await atomicJson(markerPath, { schemaVersion: 1, hypitVersion: '0.3.1', providerHash: hash, bootstrapVersion: 1, skillSource, skillHash: createHash('sha256').update(await readFile(join(projectDir, '.agents/skills/hypit/SKILL.md'))).digest('hex'), preparedAt: new Date().toISOString() });
  return { providerHash: hash };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareProject(JSON.parse(await readFile(process.argv[2], 'utf8')))
    .then(value => process.stdout.write(JSON.stringify(value)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
