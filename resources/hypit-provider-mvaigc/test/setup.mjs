/**
 * Make the Hypit SDK loadable in a plain `node --test` run.
 *
 * Loaded via --import (not a bare `import` in a test file) because ESM hoists
 * imports: a test's own `import '@hypit/nano-banana'` would be linked before a
 * sibling bootstrap module could register tsx's loader.
 *
 * The SDK's `import` condition points at TypeScript source, so Node refuses it
 * from node_modules. The CLI solves this identically (bin/hypit.mjs:24-28).
 */
import { register } from 'tsx/esm/api';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distributionRoot = realpathSync.native(
  resolve(here, '..', 'node_modules', '@hypit', 'hypit'),
);
register();
const { installDistributionPackageResolution } = await import(
  new URL('packages/loader/src/node/distribution-resolution.ts', pathToFileURL(distributionRoot + sep)).href
);
installDistributionPackageResolution([distributionRoot]);
