/**
 * Release-hook test: the `version` lifecycle script that keeps both
 * hand-written `USER_AGENT` strings in step with package.json.
 *
 * `npm version <bump>` rewrites the manifest, then runs `version`, then commits,
 * so a release needs no hand edits as long as this hook does its job. The work
 * happens against a throwaway copy of the two runtime halves — the repository's
 * own files are never touched here.
 *
 * @module dsh-searchhub/tests/version
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { syncUserAgent } from '../scripts/sync-user-agent.mjs';

/** This repository's root directory. */
const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Build a throwaway tree holding only what the hook reads and writes.
 * @param {string} version - the version to seed the manifest with.
 * @returns {string} the temporary root.
 */
function scratchRoot(version) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-searchhub-version-'));
  mkdirSync(join(root, 'lib'), { recursive: true });
  mkdirSync(join(root, 'src', 'types'), { recursive: true });
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'scratch', version }, undefined, 2)}\n`);
  writeFileSync(join(root, 'lib', 'index.js'), 'const USER_AGENT = "dsh-searchhub/0.0.1";\n');
  writeFileSync(join(root, 'src', 'types', 'provider.ts'), "const USER_AGENT = 'dsh-searchhub/0.0.1';\n");
  return root;
}

test('the version hook rewrites both USER_AGENT strings from the manifest', (t) => {
  const root = scratchRoot('9.9.9');
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = syncUserAgent({ root });

  assert.equal(result.version, '9.9.9');
  assert.deepEqual(result.changed.sort(), ['lib/index.js', 'src/types/provider.ts']);
  assert.match(readFileSync(join(root, 'lib', 'index.js'), 'utf8'), /const USER_AGENT = "dsh-searchhub\/9\.9\.9";/u);
  assert.match(
    readFileSync(join(root, 'src', 'types', 'provider.ts'), 'utf8'),
    /const USER_AGENT = 'dsh-searchhub\/9\.9\.9';/u,
  );
});

test('the version hook is idempotent and reports nothing to change', (t) => {
  const root = scratchRoot('1.2.3');
  t.after(() => rmSync(root, { recursive: true, force: true }));

  syncUserAgent({ root });
  assert.deepEqual(syncUserAgent({ root }).changed, [], 'a second run must be a no-op');
});

test('the version hook refuses to guess when a USER_AGENT line is missing', (t) => {
  const root = scratchRoot('1.0.0');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'lib', 'index.js'), '// the attribution line was removed\n');

  assert.throws(() => syncUserAgent({ root }), /no USER_AGENT assignment found in lib\/index\.js/u);
});

test('the version hook targets files that actually exist in this repository', () => {
  // The hook points at real published files; a rename that leaves the targets
  // stale would only surface at release time, so pin them here.
  for (const file of ['lib/index.js', 'src/types/provider.ts']) {
    const body = readFileSync(join(repoDir, file), 'utf8');
    assert.match(
      body,
      /const USER_AGENT = ['"]dsh-searchhub\/[^'"]+['"];/u,
      `${file} must keep the USER_AGENT line the version hook rewrites`,
    );
  }
});

test('the version hook stages its edits so the release commit carries them', (t) => {
  // npm stages only the manifest and lockfile; a `version` script's own edits
  // stay dirty unless it stages them, and the tag would then point at a commit
  // whose USER_AGENT strings are one release behind — failing the CI check on
  // exactly the tag being released.
  let git = true;
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
  } catch {
    git = false;
  }
  if (!git) {
    t.skip('git is unavailable here');
    return;
  }

  const root = scratchRoot('4.5.6');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const gitArgs = ['-c', 'user.name=version-test', '-c', 'user.email=version-test@example.invalid'];
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', [...gitArgs, 'commit', '-qm', 'baseline'], { cwd: root });

  const result = syncUserAgent({ root });
  assert.equal(result.staged, true, 'the hook must report that it staged its edits');

  const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  const staged = porcelain
    .split('\n')
    .filter((line) => line.startsWith('M '))
    .map((line) => line.slice(3).trim().replaceAll('\\', '/'))
    .sort();
  assert.deepEqual(staged, ['lib/index.js', 'src/types/provider.ts'], `unexpected index state:\n${porcelain}`);
});
