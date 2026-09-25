/**
 * Tests for the npm-only installer (`scripts/cli.mjs`).
 *
 * Everything here runs offline against temporary directories: no package
 * manager is spawned, no registry is contacted. The pieces that matter are the
 * ones that decide *where* things happen (home/profile resolution), *what* is
 * written (profile init, `dsh.profile.bundles` reconcile) and *how* a bad
 * invocation fails (argument parsing, exit codes).
 *
 * @module dsh-searchhub/tests/cli
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  apiKeyState,
  defaultSpec,
  ensureProfile,
  inspectProfile,
  isBundle,
  main,
  parseArgs,
  reconcileBundles,
  resolveHome,
  resolvePackageDir,
  resolveProfileDir,
  usage,
} from '../scripts/cli.mjs';

/** This repository's root directory. */
const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Create a throwaway directory.
 * @param {string} label - a readable suffix for the directory name.
 * @returns {string} the absolute directory path.
 */
function scratch(label) {
  return mkdtempSync(join(tmpdir(), `dsh-searchhub-${label}-`));
}

/**
 * Write a package manifest, creating parent directories.
 * @param {string} dir - the package directory.
 * @param {object} manifest - the manifest to write.
 * @returns {string} the package directory.
 */
function writeManifest(dir, manifest) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`);
  return dir;
}

/**
 * Install a fake bundle package into a profile's `node_modules`.
 * @param {string} profileDir - the profile directory.
 * @param {string} name - the package name.
 * @param {object} [options] - package options.
 * @param {boolean} [options.bundle] - whether it declares `dsh.bundle.patch`.
 * @returns {string} the fake package directory.
 */
function fakePackage(profileDir, name, options = {}) {
  const dir = join(profileDir, 'node_modules', ...name.split('/'));
  writeManifest(dir, {
    name,
    version: '1.2.3',
    ...(options.bundle === false ? {} : { dsh: { bundle: { patch: './cordis.patch.yml' } } }),
  });
  return dir;
}

test('resolveHome prefers the explicit override, then $DSH_HOME, then ~/.dsh', () => {
  assert.equal(resolveHome('/explicit', { DSH_HOME: '/from-env' }), resolve('/explicit'));
  assert.equal(resolveHome(undefined, { DSH_HOME: '/from-env' }), resolve('/from-env'));
  assert.equal(resolveHome(undefined, { DSH_HOME: '   ' }).endsWith(join('.dsh')), true);
  assert.equal(resolveHome('~/harness', {}).endsWith(join('harness')), true);
});

test('resolveProfileDir joins under profiles/ and rejects unsafe names', () => {
  const home = scratch('home');
  assert.equal(resolveProfileDir(home, 'web'), join(home, 'profiles', 'web'));
  for (const bad of ['', '.', '..', 'node_modules', 'a/b', 'a\\b']) {
    assert.throws(() => resolveProfileDir(home, bad), /invalid profile name/u);
  }
});

test('ensureProfile writes the DSH profile template once and never clobbers it', () => {
  const home = scratch('init');
  const dir = resolveProfileDir(home, 'web');

  const first = ensureProfile(dir, 'web');
  assert.deepEqual(first.created.sort(), ['cordis.patch.yml', 'package.json', 'pnpm-workspace.yaml']);

  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'dsh-profile-web');
  assert.equal(manifest.private, true);
  assert.deepEqual(manifest.dependencies, {});
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']);
  assert.equal(manifest.dsh.profile.patchReload, 'live');

  // A user-owned edit survives a second run, and nothing is reported as created.
  manifest.dsh.profile.bundles.push('hand-added');
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`);
  const second = ensureProfile(dir, 'web');
  assert.deepEqual(second.created, []);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dsh.profile.bundles, [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    'hand-added',
  ]);
});

test('ensureProfile uses the shipped template for unknown profile names', () => {
  const home = scratch('custom');
  const dir = resolveProfileDir(home, 'tui');
  ensureProfile(dir, 'tui');
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base']);
  assert.equal(manifest.dsh.profile.patchReload, 'live');
});

test('isBundle and resolvePackageDir follow the node_modules walk', () => {
  const home = scratch('resolve');
  const dir = resolveProfileDir(home, 'web');
  ensureProfile(dir, 'web');
  const bundleDir = fakePackage(dir, 'dsh-searchhub');
  const plainDir = fakePackage(dir, '@scope/plain', { bundle: false });

  assert.equal(resolvePackageDir(dir, 'dsh-searchhub'), bundleDir);
  assert.equal(resolvePackageDir(dir, '@scope/plain'), plainDir);
  assert.equal(resolvePackageDir(dir, 'missing-package'), undefined);
  assert.equal(isBundle(bundleDir), true);
  assert.equal(isBundle(plainDir), false);
  assert.equal(isBundle(undefined), false);

  // A package in the parent (installation-owned) closure is reachable too.
  const parentPackage = fakePackage(home, 'from-installation');
  assert.equal(resolvePackageDir(dir, 'from-installation'), parentPackage);
});

test('reconcileBundles activates a freshly installed bundle dependency', () => {
  const home = scratch('reconcile');
  const dir = resolveProfileDir(home, 'web');
  ensureProfile(dir, 'web');
  const before = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  manifest.dependencies['dsh-searchhub'] = '^1.0.0';
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`);
  fakePackage(dir, 'dsh-searchhub');

  const result = reconcileBundles(dir, { before });
  assert.equal(result.changed, true);
  assert.deepEqual(result.added, ['dsh-searchhub']);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-searchhub']);

  const written = readFileSync(join(dir, 'package.json'), 'utf8');
  assert.equal(written.endsWith('\n'), true);
  assert.match(written, /\n  "dsh": \{/u);
  assert.deepEqual(JSON.parse(written).dsh.profile.bundles, result.bundles);
});

test('reconcileBundles leaves in-box bundles alone and drops removed layers', () => {
  const home = scratch('reconcile-remove');
  const dir = resolveProfileDir(home, 'web');
  ensureProfile(dir, 'web');
  fakePackage(dir, 'dsh-searchhub');
  fakePackage(dir, '@deepseek-ai/dsh-tool-extra');

  const seeded = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  seeded.dsh.profile.bundles.push('dsh-searchhub', '@deepseek-ai/dsh-tool-extra');
  seeded.dependencies = { 'dsh-searchhub': '^1.0.0', '@deepseek-ai/dsh-tool-extra': '^1.0.0' };
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(seeded, undefined, 2)}\n`);
  const before = JSON.parse(JSON.stringify(seeded));

  // The plugin dependency disappears (uninstall), the other stays.
  const afterUninstall = JSON.parse(JSON.stringify(seeded));
  delete afterUninstall.dependencies['dsh-searchhub'];
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(afterUninstall, undefined, 2)}\n`);

  const result = reconcileBundles(dir, { before });
  assert.deepEqual(result.removed, ['dsh-searchhub']);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-tool-extra']);

  // A non-bundle dependency is never added as a layer.
  const plain = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  plain.dependencies['plain-lib'] = '^1.0.0';
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(plain, undefined, 2)}\n`);
  fakePackage(dir, 'plain-lib', { bundle: false });
  const second = reconcileBundles(dir, { before: plain });
  assert.equal(second.changed, false);
  assert.deepEqual(second.bundles, result.bundles);
});

test('parseArgs handles commands, flags, positional specs and failures', () => {
  assert.deepEqual(parseArgs([]), {
    command: 'install',
    profile: 'web',
    pm: 'npm',
    dryRun: false,
    json: false,
    help: false,
  });
  const parsed = parseArgs(['install', '--profile', 'tui', '--home', '/tmp/home', '--pm', 'pnpm', '--dry-run', '--json']);
  assert.equal(parsed.command, 'install');
  assert.equal(parsed.profile, 'tui');
  assert.equal(parsed.home, '/tmp/home');
  assert.equal(parsed.pm, 'pnpm');
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.json, true);

  assert.equal(parseArgs(['status']).command, 'status');
  assert.equal(parseArgs(['install', 'github:Bin-top1/dsh-searchhub']).spec, 'github:Bin-top1/dsh-searchhub');
  assert.equal(parseArgs(['--spec', 'dsh-searchhub@1.0.0']).spec, 'dsh-searchhub@1.0.0');
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['-y']).command, 'install');

  assert.throws(() => parseArgs(['--nope']), /unknown flag/u);
  assert.throws(() => parseArgs(['--profile']), /needs a value/u);
  assert.throws(() => parseArgs(['status', 'extra']), /unexpected argument/u);
  assert.throws(() => parseArgs(['install', 'a', '--spec', 'b']), /not both/u);
});

test('defaultSpec picks the registry for an installed copy and a checkout otherwise', () => {
  // Read the real manifest instead of hard-coding name/version, so renaming the
  // package or bumping the version does not fail this test.
  const manifest = JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8'));
  assert.deepEqual(defaultSpec(repoDir), {
    kind: 'checkout',
    name: manifest.name,
    version: manifest.version,
  });

  const installed = join(scratch('installed'), 'node_modules', 'dsh-searchhub');
  writeManifest(installed, { name: 'dsh-searchhub', version: '1.0.0' });
  assert.deepEqual(defaultSpec(installed), {
    kind: 'registry',
    spec: 'dsh-searchhub@1.0.0',
    name: 'dsh-searchhub',
    version: '1.0.0',
  });
});

test('inspectProfile and apiKeyState report what is actually installed', () => {
  const home = scratch('status');
  const dir = resolveProfileDir(home, 'web');
  const absent = inspectProfile({ dir, name: 'dsh-searchhub' });
  assert.equal(absent.profileExists, false);
  assert.equal(absent.activated, false);

  ensureProfile(dir, 'web');
  const notInstalled = inspectProfile({ dir, name: 'dsh-searchhub' });
  assert.equal(notInstalled.profileExists, true);
  assert.equal(notInstalled.installedVersion, undefined);
  assert.equal(notInstalled.activated, false);

  fakePackage(dir, 'dsh-searchhub');
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  manifest.dependencies['dsh-searchhub'] = 'file:./x.tgz';
  manifest.dsh.profile.bundles.push('dsh-searchhub');
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`);

  const installed = inspectProfile({ dir, name: 'dsh-searchhub' });
  assert.equal(installed.installedVersion, '1.2.3');
  assert.equal(installed.isBundle, true);
  assert.equal(installed.activated, true);

  assert.deepEqual(apiKeyState(home, {}), { env: false, credentials: false });
  assert.deepEqual(apiKeyState(home, { TAVILY_API_KEY: 'tvly-x' }), { env: true, credentials: false });
  writeFileSync(join(home, '.credentials.yaml'), 'TAVILY_API_KEY: encrypted\n');
  assert.deepEqual(apiKeyState(home, {}), { env: false, credentials: true });
});

test('main: help, status, dry-run and argument failures use documented exit codes', async () => {
  const lines = [];
  const io = { info: (line) => lines.push(line), error: (line) => lines.push(line) };
  const home = scratch('main');

  assert.equal(await main(['status', '--home', home], io), 0);
  assert.equal(lines.some((line) => line.includes('does not exist yet')), true);

  lines.length = 0;
  assert.equal(await main(['install', '--home', home, '--dry-run'], io), 0);
  assert.equal(lines.some((line) => line.includes('plan: npm install')), true);
  assert.equal(existsSync(join(home, 'profiles')), false, 'a dry run must not create the profile');

  assert.equal(await main(['nope'], io), 2);
  assert.equal(await main(['install', '--pm', 'yarn'], io), 2);
  assert.equal(await main(['status', '--profile', 'a/b'], io), 1);
});

test('usage documents every command and the key environment variable', () => {
  const text = usage();
  for (const fragment of ['install', 'uninstall', 'status', '--profile', '--dry-run', 'TAVILY_API_KEY']) {
    assert.equal(text.includes(fragment), true, `usage should mention ${fragment}`);
  }
});
