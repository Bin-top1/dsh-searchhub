#!/usr/bin/env node
/**
 * Keep the two hand-written attribution `USER_AGENT` strings in step with
 * package.json's version.
 *
 * `npm version <bump>` runs this through the `version` lifecycle script: npm
 * rewrites the manifest first, then runs `version`, then creates the release
 * commit. npm stages only the manifest and lockfile itself, so this script also
 * stages the files it rewrites — otherwise the tag would point at a commit whose
 * `USER_AGENT` strings are one release behind, and the CI check on that tag
 * would fail. Without the hook a release needs three hand edits (the manifest
 * plus both runtime halves), and `tests/manifest.test.mjs` fails loudly whenever
 * one is missed. Because `lib/index.js` is a published file, a missed edit also
 * ships a wrong attribution header to users.
 *
 * @module dsh-searchhub/scripts/sync-user-agent
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** This repository's root directory. */
const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The runtime halves that carry a hand-written `USER_AGENT`, each with the
 * pattern matching the whole assignment and the text that should replace it.
 * `src/types/provider.ts` is the documentation mirror of the host half.
 */
const TARGETS = [
  {
    file: 'lib/index.js',
    pattern: /const USER_AGENT = "dsh-searchhub\/[^"]*"/u,
    format: (version) => `const USER_AGENT = "dsh-searchhub/${version}"`,
  },
  {
    file: 'src/types/provider.ts',
    pattern: /const USER_AGENT = 'dsh-searchhub\/[^']*'/u,
    format: (version) => `const USER_AGENT = 'dsh-searchhub/${version}'`,
  },
];

/**
 * Rewrite every `USER_AGENT` string to one version and stage the result.
 * @param {{root?: string, version?: string}} [options] - `root` redirects the work (tests use a temp copy); `version` overrides the manifest read.
 * @returns {{version: string, changed: string[], staged: boolean}} the version applied, the files rewritten, and whether git staged them.
 * @throws {Error} when the manifest has no usable version, or a target lost its `USER_AGENT` line.
 */
export function syncUserAgent({ root = repoDir, version } = {}) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const applied = version ?? manifest.version;
  if (typeof applied !== 'string' || applied.length === 0) {
    throw new Error('sync-user-agent: package.json has no usable version');
  }
  const changed = [];
  for (const { file, pattern, format } of TARGETS) {
    const path = join(root, file);
    const before = readFileSync(path, 'utf8');
    if (!pattern.test(before)) {
      throw new Error(`sync-user-agent: no USER_AGENT assignment found in ${file}`);
    }
    const after = before.replace(pattern, format(applied));
    if (after !== before) {
      writeFileSync(path, after);
      changed.push(file);
    }
  }
  return { version: applied, changed, staged: stageInGit(root, changed) };
}

/**
 * Stage the rewritten files so the release commit carries them.
 *
 * npm stages only the manifest and the lockfile itself; a `version` script's own
 * edits are left dirty in the working tree. The tag would then point at a commit
 * whose `USER_AGENT` strings are one release behind, and the CI check on that
 * very tag fails. Staging here is what makes the one-command release atomic.
 *
 * @param {string} root - repository root.
 * @param {string[]} files - repo-relative paths to stage.
 * @returns {boolean} whether git staged them (false when nothing changed or git is unavailable).
 */
function stageInGit(root, files) {
  if (files.length === 0) return false;
  try {
    execFileSync('git', ['add', '--', ...files], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * True when this module is the process entry point rather than an import, so
 * importing it from a test has no side effect.
 * @returns {boolean} whether to run the CLI body.
 */
function invokedDirectly() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  }
}

if (invokedDirectly()) {
  const { version, changed, staged } = syncUserAgent();
  const detail = changed.length === 0
    ? 'already in sync'
    : `updated ${changed.join(', ')}${staged ? ' (staged for the release commit)' : ' (NOT staged — run git add)'}`;
  console.log(`sync-user-agent: USER_AGENT -> dsh-searchhub/${version} (${detail})`);
}

export { TARGETS, repoDir };
