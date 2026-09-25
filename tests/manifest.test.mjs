/**
 * Packaging invariants for dsh-searchhub.
 *
 * These assertions encode the things that were actually wrong once and are easy
 * to break again:
 *
 * - the DSH runtime packages must stay **optional peers**, never plain
 *   dependencies. `npm install` auto-installs peerDependencies, so a non-optional
 *   `@deepseek-ai/*` peer drags 18 duplicate copies of the harness (cordis,
 *   dsh-web, dsh-settings, schemastery, …) into the profile's node_modules,
 *   shadowing the installation's own closure;
 * - the two halves of the dual-face plugin must agree on the settings namespace
 *   and on the credential reference, or the card edits a section nobody reads;
 * - every file the runtime loads must be inside the npm `files` allowlist, or a
 *   published install is incomplete.
 *
 * @module dsh-searchhub/tests/manifest
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/** This repository's root directory. */
const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));
/** The parsed package manifest. */
const manifest = JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8'));

/**
 * Read one repository file as text.
 * @param {string} relative - a repo-relative path.
 * @returns {string} the file contents.
 */
function read(relative) {
  return readFileSync(join(repoDir, relative), 'utf8');
}

test('the DSH runtime is declared as optional peers, never as dependencies', () => {
  const dependencies = Object.keys(manifest.dependencies ?? {});
  assert.deepEqual(
    dependencies.filter((name) => name.startsWith('@deepseek-ai/')),
    [],
    'a plain @deepseek-ai dependency is re-installed into the profile by npm',
  );

  const peers = Object.keys(manifest.peerDependencies ?? {});
  assert.equal(peers.length > 0, true);
  for (const peer of peers) {
    assert.equal(
      manifest.peerDependenciesMeta?.[peer]?.optional,
      true,
      `${peer} must be an optional peer so npm resolves it from the DSH installation`,
    );
  }
  for (const required of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-web', '@deepseek-ai/schemastery']) {
    assert.equal(peers.includes(required), true, `${required} should stay declared as a peer`);
  }
});

test('the bundle and client declarations the DSH scanners read are intact', () => {
  const patch = manifest.dsh?.bundle?.patch;
  assert.equal(typeof patch, 'string');
  assert.equal(existsSync(join(repoDir, patch)), true, `dsh.bundle.patch points at a missing file: ${patch}`);

  assert.equal(manifest.dsh?.client?.platform, 'web');
  const clientEntry = manifest.exports?.['./client']?.default;
  assert.equal(typeof clientEntry, 'string');
  assert.equal(existsSync(join(repoDir, clientEntry)), true, `exports["./client"] points at a missing file: ${clientEntry}`);

  const normalize = (path) => (typeof path === 'string' ? path.replace(/^\.\//u, '') : path);
  assert.equal(normalize(manifest.main), normalize(manifest.exports?.['.']?.default));
  assert.equal(existsSync(join(repoDir, manifest.main)), true);
  assert.equal(manifest.type, 'module');
});

test('the inserted loader row names this package', () => {
  const patch = read(manifest.dsh.bundle.patch);
  const inserted = /name:\s*'([^']+)'/u.exec(patch);
  assert.equal(inserted?.[1], manifest.name, 'cordis.patch.yml must insert this package by its real name');
  assert.match(patch, /id: web\b/u);
  assert.match(patch, /searchProvider: tavily/u);
  assert.match(patch, /id: web-search-deepseek\s*\n\s*disabled: true/u);
});

test('both halves agree on the settings namespace and the credential reference', () => {
  const host = read('lib/index.js');
  const client = read('lib/client.js');

  const hostNamespace = /WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE = "([^"]+)"/u.exec(host)?.[1];
  const clientNamespace = /const TAVILY_NS = "([^"]+)"/u.exec(client)?.[1];
  assert.equal(hostNamespace, 'searchhub');
  assert.equal(clientNamespace, hostNamespace, 'the card keys its slot by the host namespace');

  const hostRef = /DEFAULT_API_KEY_ENV = "([^"]+)"/u.exec(host)?.[1];
  const clientRef = /API_KEY_REF_DEFAULT = "([^"]+)"/u.exec(client)?.[1];
  assert.equal(hostRef, 'TAVILY_API_KEY');
  assert.equal(clientRef, hostRef, 'the card must write the reference the host resolves');

  assert.match(client, /window\.__ModuleLoader__\.load\(\{/u, 'the browser half must self-register');
  assert.match(client, /settings\.plugin\.item/u, 'the card must register into the plugin settings slot');
  assert.match(host, /registerSearchProvider\(/u, 'the host half must register the search provider');
});

test('the browser half self-registers under the exact package name', () => {
  // The client-modules registry keys every bundle by its package specifier and
  // throws `bundle <url> loaded without registering "<id>"` when the self-
  // registration id does not match. Renaming the package without renaming these
  // strings breaks the Settings card at boot (the client bundle is served but
  // never registers), so the bundle id and the style-ownership tag are asserted
  // against package.json name together.
  const client = read('lib/client.js');
  const registered = /window\.__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/u.exec(client)?.[1];
  assert.equal(
    registered,
    manifest.name,
    'the id in lib/client.js __ModuleLoader__.load must equal package.json name',
  );
  // `client-modules` inventories a plugin's <style> tags by `data-plugin ===
  // <module id>`, so a stale value silently drops the card's CSS from HMR
  // bookkeeping.
  const tagged = /tag\.dataset\.plugin = "([^"]+)"/u.exec(client)?.[1];
  assert.equal(
    tagged,
    manifest.name,
    'the data-plugin style tag in lib/client.js must equal package.json name',
  );
});

test('the browser half never bundles its own React', () => {
  const client = read('lib/client.js');
  assert.match(client, /require\("react"\)/u);
  assert.match(client, /require\("react\/jsx-runtime"\)/u);
  assert.doesNotMatch(client, /^\s*import\s/mu, 'a classic script must not use ESM import statements');
});

test('the npm files allowlist covers every runtime file', () => {
  const files = manifest.files ?? [];
  for (const required of [
    'lib/index.js',
    'lib/client.js',
    'cordis.patch.yml',
    'README.md',
    'LICENSE',
    'scripts/cli.mjs',
  ]) {
    assert.equal(files.includes(required), true, `${required} must ship in the published package`);
  }
  assert.equal(
    files.some((entry) => entry.startsWith('lib/client.js')),
    true,
    'the browser half is served from the published package',
  );
});

test('the installer CLI is published as a binary with a shebang', () => {
  const bin = manifest.bin?.['dsh-searchhub'];
  assert.equal(bin, 'scripts/cli.mjs');
  const cliPath = join(repoDir, bin);
  assert.equal(existsSync(cliPath), true);
  assert.match(readFileSync(cliPath, 'utf8'), /^#!\/usr\/bin\/env node\n/u);
  assert.equal(statSync(cliPath).size > 1000, true);
});

test('the attribution user-agent tracks the package version', () => {
  const host = read('lib/index.js');
  const mirror = read('src/types/provider.ts');
  const hostVersion = /const USER_AGENT = "dsh-searchhub\/([^"]+)"/u.exec(host)?.[1];
  const mirrorVersion = /const USER_AGENT = 'dsh-searchhub\/([^']+)'/u.exec(mirror)?.[1];
  assert.equal(hostVersion, manifest.version, 'lib/index.js USER_AGENT must match package.json');
  assert.equal(mirrorVersion, manifest.version, 'src/types/provider.ts USER_AGENT must match package.json');
});

test('the docs name the same install entry points as the manifest', () => {
  const readme = read('README.md');
  assert.match(readme, /npx @wilson\.liu\.cn\/dsh-searchhub install/u, 'the README must document the npm installer');
  assert.match(readme, /dsh-searchhub install/u);
  assert.match(readme, /dsh\.profile\.bundles/u, 'the README must explain how the layer is activated');
  assert.match(readme, /uninstall/u);
});
