/**
 * Publish-surface test: what `npm pack` would actually ship.
 *
 * The published tarball is the product here — the DSH host half, the browser
 * half, the profile patch layer and the installer CLI all have to be inside it,
 * while the repo's own scaffolding (tests, `src/types` documentation mirrors,
 * CI config, screenshots) must stay out.
 *
 * @module dsh-searchhub/tests/pack
 */

import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { spawnCommand } from '../scripts/cli.mjs';

/** This repository's root directory. */
const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Ask npm what it would pack.
 * @returns {{skipped: boolean, files?: string[], count?: number, reason?: string}} the dry-run result.
 */
function packDryRun() {
  const packed = spawnCommand('npm', ['pack', '--dry-run', '--json'], {
    cwd: repoDir,
    encoding: 'utf8',
    // `npm pack` runs lifecycle scripts; keep the run inert and offline-safe.
    env: { ...process.env, npm_config_ignore_scripts: 'true' },
  });
  if (packed.error !== undefined || packed.status !== 0) {
    return { skipped: true, reason: String(packed.error?.message ?? packed.stderr ?? 'npm pack failed') };
  }
  const parsed = JSON.parse(packed.stdout);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  return { skipped: false, files: entry.files.map((file) => file.path), count: entry.entryCount ?? entry.files.length };
}

test('npm pack ships the runtime, the patch layer and the installer — and nothing else', (t) => {
  const result = packDryRun();
  if (result.skipped) {
    t.skip(`npm is unavailable here: ${result.reason}`);
    return;
  }
  const files = result.files ?? [];

  for (const required of [
    'package.json',
    'README.md',
    'LICENSE',
    'cordis.patch.yml',
    'lib/index.js',
    'lib/client.js',
    'scripts/cli.mjs',
  ]) {
    assert.equal(files.includes(required), true, `${required} is missing from the published tarball`);
  }

  for (const excluded of ['tests/cli.test.mjs', 'src/types/index.ts', 'tsconfig.json', '.env.example']) {
    assert.equal(files.includes(excluded), false, `${excluded} must not be published`);
  }
  assert.equal(
    files.some((file) => file.startsWith('docs/') || file.startsWith('.github/')),
    false,
    'screenshots and CI config stay in the repository',
  );

  // A small tarball is a feature: the runtime is prebuilt and hand-written.
  assert.equal(files.length <= 12, true, `unexpected publish surface: ${files.join(', ')}`);
});
