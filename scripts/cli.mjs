#!/usr/bin/env node
/**
 * dsh-searchhub installer — install this plugin into a DeepSeek Harness profile
 * with **npm only**, without the pnpm-backed `dsh plugin` forwarder.
 *
 * Why this exists: `dsh plugin --profile <name> add <pkg>` is a thin pnpm
 * forwarder (`spawnSync("pnpm", ...)` plus a `dsh.profile.bundles` reconcile),
 * so it cannot run on a machine that only has npm — it exits with "pnpm not
 * found on PATH". This script performs the same three steps with the package
 * manager you actually have:
 *
 *   1. initialize the profile when it does not exist yet (package.json,
 *      cordis.patch.yml, pnpm-workspace.yaml — exactly what DSH's own
 *      `initProfile` writes, so a later `dsh plugin` run stays compatible);
 *   2. install the package into the profile directory;
 *   3. reconcile `dsh.profile.bundles` from the installed state, so this
 *      package's `cordis.patch.yml` layer is applied on the next boot.
 *
 * Usage:
 *   npx dsh-searchhub install   [--profile web] [--home <dir>] [--spec <spec>]
 *   npx dsh-searchhub status    [--profile web]
 *   npx dsh-searchhub uninstall [--profile web]
 *
 * Running it from a checkout (`node scripts/cli.mjs install`) packs the
 * checkout into a tarball and installs that copy. That matters: a `file:`
 * **directory** install becomes a symlink, and Node resolves a symlinked
 * package's imports from its real path, where the DSH peer packages
 * (`@deepseek-ai/*`) are not resolvable.
 *
 * @module dsh-searchhub/cli
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

//#region constants (mirrors @deepseek-ai/dsh-app-boot, so profiles stay compatible)

/** Directory under the Harness home holding every profile. */
const PROFILES_DIR = 'profiles';
/** The user patch layer inside a profile directory. */
const PROFILE_PATCH_FILENAME = 'cordis.patch.yml';
/** Profile name used when `--profile` is omitted (`dsh web` is `--profile web`). */
const DEFAULT_PROFILE = 'web';
/** The shipped profile templates auto-initialized on first use, by name. */
const PROFILE_TEMPLATES = {
  acp: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'], patchReload: 'startup' },
  web: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], patchReload: 'live' },
  headless: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'], patchReload: 'startup' },
  sdk: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app'], patchReload: 'startup' },
  'sdk-minimal': { bundles: ['@deepseek-ai/dsh-sdk-minimal'], patchReload: 'startup' },
};
/** The bundle list an init uses for a name with no shipped template. */
const DEFAULT_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base'];
/** Custom profiles retain the historical live patch-file behavior. */
const DEFAULT_PROFILE_PATCH_RELOAD = 'live';
const PROFILE_PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`;
const PROFILE_PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`;
/** Profile-local staging directory for a packed checkout (keeps `file:` specs valid). */
const STAGING_DIR = '.dsh-searchhub';
/** Quiet, telemetry-free install flags. */
const INSTALL_FLAGS = ['--no-audit', '--no-fund'];
/** Environment variable this plugin's API key is read from by default. */
const DEFAULT_API_KEY_ENV = 'TAVILY_API_KEY';
/** Commands this CLI accepts. */
const COMMANDS = ['install', 'uninstall', 'status', 'help'];

//#endregion

//#region pure helpers (dependency-free, covered by tests/cli.test.mjs)

/**
 * Expand a leading `~`, `~/`, or `~\` against the OS home.
 * @param {string} path - a possibly tilde-prefixed path.
 * @returns {string} the expanded path.
 */
function expandHomePath(path) {
  if (path === '~') return homedir();
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Resolve the Harness home exactly like `resolveDshHome`: explicit override,
 * then a non-blank `$DSH_HOME`, then `~/.dsh`.
 * @param {string} [configured] - an explicit `--home` value.
 * @param {NodeJS.ProcessEnv} [env] - the environment to read `DSH_HOME` from.
 * @returns {string} the absolute Harness home.
 */
function resolveHome(configured, env = process.env) {
  const fromEnv = env.DSH_HOME;
  const chosen =
    configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh'));
  return resolve(expandHomePath(chosen));
}

/**
 * Resolve a profile directory under the Harness home, rejecting the names DSH
 * itself rejects.
 * @param {string} home - the resolved Harness home.
 * @param {string} name - the profile name.
 * @returns {string} the absolute profile directory (which may not exist yet).
 */
function resolveProfileDir(home, name) {
  if (
    name === '' ||
    name.includes('/') ||
    name.includes('\\') ||
    name === '.' ||
    name === '..' ||
    name === 'node_modules'
  ) {
    throw new Error(`invalid profile name ${JSON.stringify(name)}`);
  }
  return join(home, PROFILES_DIR, name);
}

/**
 * Read one JSON document.
 * @param {string} path - the file to read.
 * @returns {any} the parsed value.
 */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Write one JSON document the way DSH writes profile manifests: two-space
 * indentation and a trailing newline.
 * @param {string} path - the file to write.
 * @param {unknown} value - the value to serialize.
 * @returns {void}
 */
function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, undefined, 2) + '\n');
}

/**
 * Create the profile files DSH's `initProfile` creates, never touching an
 * existing file.
 * @param {string} dir - the profile directory.
 * @param {string} name - the profile name (template key).
 * @returns {{created: string[]}} the file names that were created.
 */
function ensureProfile(dir, name) {
  mkdirSync(dir, { recursive: true });
  const created = [];
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) {
    const template = PROFILE_TEMPLATES[name];
    writeJson(manifestPath, {
      name: `dsh-profile-${basename(dir)}`,
      private: true,
      dependencies: {},
      dsh: {
        profile: {
          bundles: [...(template?.bundles ?? DEFAULT_PROFILE_BUNDLES)],
          patchReload: template?.patchReload ?? DEFAULT_PROFILE_PATCH_RELOAD,
        },
      },
    });
    created.push('package.json');
  }
  const patchPath = join(dir, PROFILE_PATCH_FILENAME);
  if (!existsSync(patchPath)) {
    writeFileSync(patchPath, PROFILE_PATCH_TEMPLATE);
    created.push(PROFILE_PATCH_FILENAME);
  }
  const workspacePath = join(dir, 'pnpm-workspace.yaml');
  if (!existsSync(workspacePath)) {
    writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE);
    created.push('pnpm-workspace.yaml');
  }
  return { created };
}

/**
 * Resolve a package directory the way Node resolves a bare specifier: walk
 * `node_modules` from `from` up to the filesystem root, which is what makes the
 * installation-owned `$DSH_HOME/profiles/node_modules` closure reachable too.
 * @param {string} from - the directory resolution starts at (a profile dir).
 * @param {string} name - the package name.
 * @returns {string | undefined} the package directory, when it holds a manifest.
 */
function resolvePackageDir(from, name) {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
  }
}

/**
 * Whether a resolved package directory declares a DSH bundle patch layer.
 * @param {string | undefined} packageDir - the resolved package directory.
 * @returns {boolean} true when the manifest declares `dsh.bundle.patch`.
 */
function isBundle(packageDir) {
  if (packageDir === undefined) return false;
  try {
    return readJson(join(packageDir, 'package.json')).dsh?.bundle?.patch !== undefined;
  } catch {
    return false;
  }
}

/**
 * Reconcile `dsh.profile.bundles` against the installed state, mirroring
 * `dsh plugin`'s own reconcile: a dependency resolving to a `dsh.bundle`
 * package joins the layer list (appended in dependency order), and a listed
 * dependency that no longer resolves to one leaves it. In-box bundles from the
 * profile template are not dependencies and are never touched.
 * @param {string} dir - the profile directory.
 * @param {object} [options] - reconciliation options.
 * @param {Record<string, unknown>} [options.before] - the manifest read before the package manager ran.
 * @returns {{changed: boolean, added: string[], removed: string[], bundles: string[], manifest: any}} the outcome.
 */
function reconcileBundles(dir, options = {}) {
  const manifestPath = join(dir, 'package.json');
  const manifest = readJson(manifestPath);
  const before = options.before ?? manifest;
  const beforeDeps = new Set(Object.keys(before.dependencies ?? {}));
  const dependencies = Object.keys(manifest.dependencies ?? {});
  const bundles = [...(manifest.dsh?.profile?.bundles ?? [])];
  const added = [];
  const removed = [];

  for (const packageName of dependencies) {
    if (isBundle(resolvePackageDir(dir, packageName)) && !bundles.includes(packageName)) {
      bundles.push(packageName);
      added.push(packageName);
    }
  }
  const dependencySet = new Set(dependencies);
  for (const packageName of [...bundles]) {
    const wasDependency = beforeDeps.has(packageName) || dependencySet.has(packageName);
    const stillBundle = dependencySet.has(packageName) && isBundle(resolvePackageDir(dir, packageName));
    if (wasDependency && !stillBundle) {
      bundles.splice(bundles.indexOf(packageName), 1);
      removed.push(packageName);
    }
  }

  const changed = added.length > 0 || removed.length > 0;
  if (changed) {
    writeJson(manifestPath, {
      ...manifest,
      dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } },
    });
  }
  return { changed, added, removed, bundles, manifest };
}

/**
 * Decide what to install when `--spec` is absent: this package's registry
 * coordinates when the script runs from an installed copy, otherwise a tarball
 * packed from the checkout it lives in.
 * @param {string} packageDir - this script's own package directory.
 * @returns {{kind: 'registry'|'checkout', spec?: string, name: string, version: string}} the choice.
 */
function defaultSpec(packageDir) {
  const manifest = readJson(join(packageDir, 'package.json'));
  const installed = resolve(packageDir).split(/[\\/]/u).includes('node_modules');
  if (installed) {
    return { kind: 'registry', spec: `${manifest.name}@${manifest.version}`, name: manifest.name, version: manifest.version };
  }
  return { kind: 'checkout', name: manifest.name, version: manifest.version };
}

/**
 * Classify an explicit `--spec` that points at the local filesystem, so the CLI
 * can anchor it to the invoking directory (npm itself runs with the profile as
 * its working directory) and pack directories instead of letting npm symlink
 * them.
 *
 * A `file:` directory spec becomes a **junction** under npm, and a symlinked
 * package resolves its `@deepseek-ai/*` imports from the checkout's real path —
 * where the DSH peer packages are absent (or worse, where a duplicate copy of
 * them lives). Packing the directory avoids both.
 * @param {string} spec - the raw spec.
 * @param {string} [cwd] - the directory relative specs are anchored to.
 * @returns {{kind: 'directory'|'file', path: string} | undefined} the classification.
 */
function classifyLocalSpec(spec, cwd = process.cwd()) {
  const raw = spec.startsWith('file:') ? spec.slice('file:'.length) : spec;
  if (raw === '') return undefined;
  const isWindowsPath = /^[a-zA-Z]:[\\/]/u.test(raw);
  if (!isWindowsPath && /^[a-z][a-z\d+.-]*:/iu.test(raw)) return undefined;
  const candidate = resolve(cwd, expandHomePath(raw));
  try {
    const stats = statSync(candidate);
    if (stats.isDirectory()) return { kind: 'directory', path: candidate };
    if (stats.isFile()) return { kind: 'file', path: candidate };
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse this CLI's arguments.
 * @param {string[]} argv - arguments after the node executable and script path.
 * @returns {{command: string, profile: string, home?: string, spec?: string, pm: string, dryRun: boolean, json: boolean, help: boolean}} the parsed invocation.
 */
function parseArgs(argv) {
  const parsed = { command: 'install', profile: DEFAULT_PROFILE, pm: 'npm', dryRun: false, json: false, help: false };
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = (flag) => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`${flag} needs a value`);
      index += 1;
      return value;
    };
    if (arg === '-h' || arg === '--help') parsed.help = true;
    else if (arg === '-p' || arg === '--profile') parsed.profile = take(arg);
    else if (arg === '--home') parsed.home = take(arg);
    else if (arg === '-s' || arg === '--spec' || arg === '--package') parsed.spec = take(arg);
    else if (arg === '--pm') parsed.pm = take(arg);
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '-y' || arg === '--yes') {
      /* non-interactive by design; accepted so scripts can pass it */
    } else if (arg.startsWith('-')) throw new Error(`unknown flag ${arg}`);
    else rest.push(arg);
  }
  if (rest.length > 0) {
    const [command, ...extra] = rest;
    parsed.command = command;
    if (extra.length > 0) {
      if (command !== 'install') throw new Error(`unexpected argument ${JSON.stringify(extra[0])}`);
      if (parsed.spec !== undefined) throw new Error('pass the package to install either positionally or as --spec, not both');
      parsed.spec = extra[0];
    }
  }
  return parsed;
}

/**
 * Render the usage text.
 * @returns {string} the help body.
 */
function usage() {
  return `dsh-searchhub — install this plugin into a DeepSeek Harness profile with npm

Usage
  dsh-searchhub install   [options]     install + activate (default command)
  dsh-searchhub status    [options]     show profile, install and key state
  dsh-searchhub uninstall [options]     remove it from the profile again

Options
  -p, --profile <name>   profile under $DSH_HOME/profiles (default: ${DEFAULT_PROFILE})
      --home <dir>       Harness home (default: $DSH_HOME, else ~/.dsh)
  -s, --spec <spec>      what to install (default: this package) — a registry
                         name, github:Bin-top1/dsh-searchhub, a tarball, or a
                         path to a checkout to pack
      --pm <npm|pnpm>    package manager to run            (default: npm)
      --dry-run          print the plan, change nothing
      --json             machine-readable result on stdout
  -y, --yes              assume yes (this CLI never prompts)
  -h, --help             this text

Examples
  npx @wilson.liu.cn/dsh-searchhub install --profile web
  node scripts/cli.mjs install --spec github:Bin-top1/dsh-searchhub
  dsh-searchhub install --dry-run --profile web

After installing, restart the profile (for example \`dsh web\`) and open
Settings -> Plugins -> SearchHub to paste a Tavily API key, or export
${DEFAULT_API_KEY_ENV} before launching DSH.
`;
}

/**
 * Quote one argument for a `cmd.exe` command line.
 * @param {string} value - the raw argument.
 * @returns {string} the argument, quoted when it contains cmd metacharacters.
 */
function quoteForCmd(value) {
  return /[\s"&|<>^()]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
}

/**
 * Spawn a command with an argument array. On Windows the command is handed to
 * `cmd.exe`, because npm/pnpm ship as `.cmd` shims that Node refuses to spawn
 * directly (EINVAL) and `shell: true` with an args array is deprecated.
 * @param {string} command - the command to run (`npm`, `pnpm`, …).
 * @param {string[]} args - its arguments.
 * @param {import('node:child_process').SpawnSyncOptionsWithStringEncoding} [options] - spawn options.
 * @returns {import('node:child_process').SpawnSyncReturns<any>} the spawn result.
 */
function spawnCommand(command, args, options = {}) {
  if (process.platform === 'win32') {
    const line = [command, ...args].map(quoteForCmd).join(' ');
    return spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', line], options);
  }
  return spawnSync(command, args, options);
}

/**
 * Test whether a package manager is runnable.
 * @param {string} pm - the command to probe.
 * @returns {boolean} true when `<pm> --version` succeeds.
 */
function packageManagerAvailable(pm) {
  const probe = spawnCommand(pm, ['--version'], { stdio: 'ignore' });
  return probe.error === undefined && probe.status === 0;
}

/**
 * Run one package-manager invocation inside the profile directory.
 * @param {string} pm - the package manager command.
 * @param {string[]} args - its arguments.
 * @param {string} dir - the working directory (the profile).
 * @returns {number} the exit code.
 */
function runPackageManager(pm, args, dir) {
  const result = spawnCommand(pm, args, { cwd: dir, stdio: 'inherit' });
  if (result.error !== undefined) {
    if (result.error.code === 'ENOENT') {
      throw new Error(`${pm} not found on PATH — install ${pm} or pass --pm <npm|pnpm>`);
    }
    throw result.error;
  }
  return result.status ?? 1;
}

/**
 * Pack a checkout into the profile's staging directory and return a
 * profile-relative `file:` spec for the resulting tarball, so the install is a
 * real copy that resolves the DSH peer packages through the profile's own
 * `node_modules` chain.
 * @param {string} packageDir - the checkout directory.
 * @param {string} dir - the profile directory.
 * @returns {{spec: string, tarball: string, name: string, version: string}} the staged spec.
 */
function stageCheckout(packageDir, dir) {
  const { name, version } = readJson(join(packageDir, 'package.json'));
  const staging = join(dir, STAGING_DIR);
  mkdirSync(staging, { recursive: true });
  const packed = spawnCommand('npm', ['pack', packageDir, '--pack-destination', staging, ...INSTALL_FLAGS], {
    cwd: dir,
    encoding: 'utf8',
  });
  if (packed.status !== 0) {
    throw new Error(`npm pack failed for ${packageDir}: ${packed.stderr || packed.stdout || 'unknown error'}`);
  }
  const tarball = (packed.stdout ?? '')
    .trim()
    .split(/\r?\n/u)
    .filter((line) => line.endsWith('.tgz'))
    .pop();
  if (tarball === undefined) throw new Error(`npm pack produced no tarball for ${packageDir}`);
  return { spec: `file:./${STAGING_DIR}/${basename(tarball)}`, tarball: join(staging, basename(tarball)), name, version };
}

//#endregion

//#region profile inspection

/**
 * Report whether the plugin's API key looks configured, from the environment
 * or the managed credentials document. The value itself is never read out.
 * @param {string} home - the Harness home.
 * @param {NodeJS.ProcessEnv} [env] - the environment.
 * @returns {{env: boolean, credentials: boolean}} what is known to be set.
 */
function apiKeyState(home, env = process.env) {
  const fromEnv = env[DEFAULT_API_KEY_ENV];
  let credentials = false;
  try {
    credentials = readFileSync(join(home, '.credentials.yaml'), 'utf8').includes(DEFAULT_API_KEY_ENV);
  } catch {
    credentials = false;
  }
  return { env: fromEnv !== undefined && fromEnv.length > 0, credentials };
}

/**
 * Describe one package's install state inside a profile.
 * @param {object} options - status inputs.
 * @param {string} options.dir - the profile directory.
 * @param {string} options.name - the package name to report on.
 * @returns {{profileExists: boolean, dependencies: string[], bundles: string[], installedVersion?: string, isBundle: boolean, activated: boolean}} the state.
 */
function inspectProfile({ dir, name }) {
  if (!existsSync(join(dir, 'package.json'))) {
    return { profileExists: false, dependencies: [], bundles: [], isBundle: false, activated: false };
  }
  const manifest = readJson(join(dir, 'package.json'));
  const packageDir = resolvePackageDir(dir, name);
  let installedVersion;
  try {
    installedVersion = packageDir === undefined ? undefined : readJson(join(packageDir, 'package.json')).version;
  } catch {
    installedVersion = undefined;
  }
  const bundles = manifest.dsh?.profile?.bundles ?? [];
  const bundle = isBundle(packageDir);
  return {
    profileExists: true,
    dependencies: Object.keys(manifest.dependencies ?? {}),
    bundles,
    ...(installedVersion === undefined ? {} : { installedVersion }),
    isBundle: bundle,
    activated: bundle && installedVersion !== undefined && bundles.includes(name),
  };
}

//#endregion

//#region commands

/**
 * `install`: init the profile, install the package, reconcile the bundle list.
 * @param {object} options - the run.
 * @param {string} options.home - the Harness home.
 * @param {string} options.profile - the profile name.
 * @param {string} [options.spec] - an explicit install spec.
 * @param {string} options.pm - the package manager to run.
 * @param {boolean} options.dryRun - whether to change nothing.
 * @param {string} options.packageDir - this script's own package directory.
 * @param {(message: string) => void} options.info - progress sink.
 * @returns {Promise<object>} the machine-readable result.
 */
async function commandInstall({ home, profile, spec, pm, dryRun, packageDir, info }) {
  const dir = resolveProfileDir(home, profile);
  const choice = spec === undefined ? defaultSpec(packageDir) : { kind: 'explicit', spec, name: undefined, version: undefined };
  const plan = { home, profile, dir, pm, dryRun };
  if (!packageManagerAvailable(pm)) throw new Error(`${pm} not found on PATH — install ${pm} or pass --pm <npm|pnpm>`);

  const manifestPath = join(dir, 'package.json');
  const before = existsSync(manifestPath) ? readJson(manifestPath) : undefined;
  if (before === undefined) info(`profile ${profile} does not exist yet — it will be created at ${dir}`);

  let chosen = choice.spec;
  let staged;
  const explicitLocal = choice.spec === undefined ? undefined : classifyLocalSpec(choice.spec);
  const localDirectory =
    choice.kind === 'checkout' ? packageDir : explicitLocal?.kind === 'directory' ? explicitLocal.path : undefined;
  if (localDirectory !== undefined) {
    if (dryRun) {
      info(`plan: pack ${localDirectory} into ${join(dir, STAGING_DIR)} and install that tarball`);
      chosen = `file:./${STAGING_DIR}/<packed>.tgz`;
    } else {
      ensureProfile(dir, profile);
      staged = stageCheckout(localDirectory, dir);
      chosen = staged.spec;
      info(`packed ${localDirectory} into ${staged.tarball}`);
    }
  } else if (explicitLocal?.kind === 'file') {
    // Anchor a relative tarball spec to the invoking directory: npm runs with
    // the profile as its working directory, where `./x.tgz` means nothing.
    chosen = explicitLocal.path;
  }

  if (dryRun) {
    info(`plan: ${pm} install ${[...INSTALL_FLAGS, chosen].join(' ')}   (cwd ${dir})`);
    info('plan: append every dependency whose package.json declares dsh.bundle to dsh.profile.bundles');
    return { ...plan, spec: chosen, changed: false };
  }

  const { created } = ensureProfile(dir, profile);
  if (created.length > 0) info(`initialized profile files: ${created.join(', ')}`);

  info(`installing ${chosen} with ${pm} in ${dir}`);
  const code = runPackageManager(pm, ['install', ...INSTALL_FLAGS, chosen], dir);
  if (code !== 0) throw new Error(`${pm} install failed in ${dir} (exit ${code})`);

  const after = readJson(manifestPath);
  const beforeDeps = new Set(Object.keys(before?.dependencies ?? {}));
  const freshDeps = Object.keys(after.dependencies ?? {}).filter((dependency) => !beforeDeps.has(dependency));
  const candidates = freshDeps.length > 0 ? freshDeps : Object.keys(after.dependencies ?? {});
  const reconciled = reconcileBundles(dir, { before });

  const installed = [];
  for (const candidate of candidates) {
    const candidateDir = resolvePackageDir(dir, candidate);
    if (candidateDir === undefined) continue;
    const candidateManifest = readJson(join(candidateDir, 'package.json'));
    const bundle = isBundle(candidateDir);
    installed.push({ name: candidateManifest.name, version: candidateManifest.version, bundle });
    if (freshDeps.includes(candidate) && !bundle) {
      info(`warning: ${candidateManifest.name} declares no dsh.bundle — installed as a plain dependency, not a profile layer`);
    }
  }
  const plugin = installed.find((entry) => entry.bundle);
  if (plugin !== undefined) info(`profile bundle layers now: ${reconciled.bundles.join(', ')}`);

  return {
    ...plan,
    spec: chosen,
    ...(staged === undefined ? {} : { staged: staged.tarball }),
    changed: true,
    installed,
    bundles: reconciled.bundles,
    added: reconciled.added,
    removed: reconciled.removed,
  };
}

/**
 * `uninstall`: remove the package; the bundle reconcile drops its layer.
 * @param {object} options - the run.
 * @param {string} options.home - the Harness home.
 * @param {string} options.profile - the profile name.
 * @param {string} options.pm - the package manager to run.
 * @param {boolean} options.dryRun - whether to change nothing.
 * @param {string} options.packageDir - this script's own package directory.
 * @param {(message: string) => void} options.info - progress sink.
 * @returns {object} the machine-readable result.
 */
function commandUninstall({ home, profile, pm, dryRun, packageDir, info }) {
  const dir = resolveProfileDir(home, profile);
  const name = readJson(join(packageDir, 'package.json')).name;
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) throw new Error(`profile ${profile} does not exist at ${dir}`);
  const before = readJson(manifestPath);
  if ((before.dependencies ?? {})[name] === undefined) {
    info(`${name} is not a dependency of profile ${profile} — nothing to do`);
    return { home, profile, dir, pm, removed: false, bundles: before.dsh?.profile?.bundles ?? [] };
  }
  if (dryRun) {
    info(`plan: ${pm} uninstall ${name}   (cwd ${dir})`);
    return { home, profile, dir, pm, removed: false, dryRun: true };
  }
  const code = runPackageManager(pm, ['uninstall', '--no-audit', '--no-fund', name], dir);
  if (code !== 0) throw new Error(`${pm} uninstall failed in ${dir} (exit ${code})`);
  const reconciled = reconcileBundles(dir, { before });
  info(
    `removed ${name} from profile ${profile}` +
      (reconciled.removed.length > 0 ? ` (layer list dropped ${reconciled.removed.join(', ')})` : ''),
  );
  return { home, profile, dir, pm, removed: true, bundles: reconciled.bundles, removedBundles: reconciled.removed };
}

/**
 * `status`: report profile, install, activation and key state.
 * @param {object} options - the run.
 * @param {string} options.home - the Harness home.
 * @param {string} options.profile - the profile name.
 * @param {string} options.packageDir - this script's own package directory.
 * @param {(message: string) => void} options.info - report sink.
 * @returns {object} the machine-readable result.
 */
function commandStatus({ home, profile, packageDir, info }) {
  const dir = resolveProfileDir(home, profile);
  const name = readJson(join(packageDir, 'package.json')).name;
  const state = inspectProfile({ dir, name });
  const key = apiKeyState(home);
  info(`home           ${home}`);
  info(`profile        ${profile} (${dir})`);
  if (!state.profileExists) {
    info('profile state  does not exist yet — run: dsh-searchhub install');
  } else {
    info(`dependencies   ${state.dependencies.length === 0 ? '(none)' : state.dependencies.join(', ')}`);
    info(`bundle layers  ${state.bundles.length === 0 ? '(none)' : state.bundles.join(', ')}`);
    info(
      `installed      ${state.installedVersion === undefined ? `${name} is NOT installed` : `${name}@${state.installedVersion}`}`,
    );
    info(
      `activated      ${state.activated ? 'yes — its cordis.patch.yml layer applies on the next boot' : 'no — activate it with: dsh-searchhub install'}`,
    );
  }
  info(
    `API key        ${
      key.env
        ? `${DEFAULT_API_KEY_ENV} is set in this environment`
        : key.credentials
          ? `${DEFAULT_API_KEY_ENV} is stored in the credentials document`
          : `not configured — paste it in Settings -> Plugins -> SearchHub, or export ${DEFAULT_API_KEY_ENV}`
    }`,
  );
  return { home, profile, dir, ...state, apiKey: key };
}

//#endregion

//#region entry point

/**
 * Run one CLI invocation.
 * @param {string[]} argv - arguments after the script path.
 * @param {object} [io] - injectable IO for tests.
 * @param {(message: string) => void} [io.info] - human progress sink.
 * @param {(message: string) => void} [io.error] - error sink.
 * @param {string} [io.packageDir] - this script's package directory.
 * @returns {Promise<number>} the process exit code.
 */
async function main(argv, io = {}) {
  // Human progress goes to stdout: Windows PowerShell renders a native
  // program's stderr as a red error block, which reads as a failure.
  const info = io.info ?? ((message) => process.stdout.write(`${message}\n`));
  const error = io.error ?? ((message) => process.stderr.write(`${message}\n`));
  const packageDir = io.packageDir ?? dirname(dirname(fileURLToPath(import.meta.url)));

  let options;
  try {
    options = parseArgs(argv);
  } catch (caught) {
    error(`dsh-searchhub: ${caught.message}`);
    error(usage());
    return 2;
  }
  if (options.help || options.command === 'help') {
    process.stdout.write(usage());
    return 0;
  }
  if (!COMMANDS.includes(options.command)) {
    error(`dsh-searchhub: unknown command ${JSON.stringify(options.command)} (expected ${COMMANDS.join(', ')})`);
    return 2;
  }
  if (options.pm !== 'npm' && options.pm !== 'pnpm') {
    error(`dsh-searchhub: --pm must be npm or pnpm, got ${JSON.stringify(options.pm)}`);
    return 2;
  }

  const home = resolveHome(options.home);
  let result;
  try {
    if (options.command === 'install') {
      result = await commandInstall({
        home,
        profile: options.profile,
        spec: options.spec,
        pm: options.pm,
        dryRun: options.dryRun,
        packageDir,
        info,
      });
    } else if (options.command === 'uninstall') {
      result = commandUninstall({ home, profile: options.profile, pm: options.pm, dryRun: options.dryRun, packageDir, info });
    } else {
      result = commandStatus({ home, profile: options.profile, packageDir, info });
    }
  } catch (caught) {
    error(`dsh-searchhub: ${caught.message}`);
    return 1;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ command: options.command, ...result }, undefined, 2)}\n`);
  } else if (options.command === 'install' && !options.dryRun) {
    info('');
    info('next steps');
    info(`  1. restart the profile, for example:  dsh --profile ${options.profile}`);
    info('  2. open Settings -> Plugins -> SearchHub and paste your Tavily key');
    info(`     (or export ${DEFAULT_API_KEY_ENV}); a free key: https://app.tavily.com/`);
  }
  return 0;
}

/**
 * True when this file is the process entry point rather than an imported module.
 * @returns {boolean} whether to run the CLI.
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
  process.exitCode = await main(process.argv.slice(2));
}

export {
  COMMANDS,
  DEFAULT_API_KEY_ENV,
  DEFAULT_PROFILE,
  DEFAULT_PROFILE_BUNDLES,
  INSTALL_FLAGS,
  PROFILE_TEMPLATES,
  STAGING_DIR,
  apiKeyState,
  classifyLocalSpec,
  commandInstall,
  commandStatus,
  commandUninstall,
  defaultSpec,
  ensureProfile,
  inspectProfile,
  isBundle,
  main,
  packageManagerAvailable,
  parseArgs,
  reconcileBundles,
  resolveHome,
  resolvePackageDir,
  resolveProfileDir,
  runPackageManager,
  spawnCommand,
  stageCheckout,
  usage,
  writeJson,
};

//#endregion
