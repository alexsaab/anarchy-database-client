import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';

/**
 * The packaged extension ships no node_modules (vsce --no-dependencies), so any
 * runtime dependency left out of the bundle is simply missing in production --
 * which is how Elasticsearch, Redis and SQLite were all broken at once, while
 * tsc, esbuild and every local run stayed green.
 *
 * This bundles a probe with the production esbuild config, runs it from a
 * directory with no node_modules anywhere above it, and requires each module
 * the drivers require() at runtime.
 */
const root = path.join(__dirname, '..');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { external, nativeAddonsExternal, runtimeModules } = require(path.join(root, 'scripts', 'bundle-config.js'));

test('the extension bundle and its sqlite engine exist', () => {
  assert.ok(fs.existsSync(path.join(root, 'out', 'extension.js')), 'run `npm run build` first');
  assert.ok(fs.existsSync(path.join(root, 'out', 'node-sqlite3-wasm.wasm')));
});

test('every runtime module is reachable from the bundle with no node_modules present', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundlecheck-'));
  // The probe entry must live inside the repo so esbuild resolves modules from
  // the repo's node_modules, exactly as the real build does.
  const probeSrc = path.join(root, `.probe-${process.pid}.js`);
  try {
    // Literal require() calls: esbuild only inlines statically analysable ones,
    // which is also the only form the drivers use.
    const checks = runtimeModules
      .map(
        (m: string) =>
          `try { require(${JSON.stringify(m)}); } catch (e) { missing.push(${JSON.stringify(m)} + ' (' + (e.code || e.message) + ')'); }`
      )
      .join('\n');
    fs.writeFileSync(probeSrc, `const missing = [];\n${checks}\nconsole.log('RESULT:' + JSON.stringify(missing));`);

    // Same bundler settings as the shipped extension.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const esbuild = require('esbuild');
    await esbuild.build({
      entryPoints: [probeSrc],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: path.join(dir, 'probe.bundle.js'),
      external,
      plugins: [nativeAddonsExternal()],
      logLevel: 'silent',
      absWorkingDir: root,
    });

    fs.copyFileSync(path.join(root, 'out', 'node-sqlite3-wasm.wasm'), path.join(dir, 'node-sqlite3-wasm.wasm'));

    // The temp dir has no node_modules above it, so anything that resolves is inlined.
    const out = execFileSync(process.execPath, ['probe.bundle.js'], { cwd: dir, encoding: 'utf8' });
    const line = out.split('\n').find((l) => l.startsWith('RESULT:'));
    assert.ok(line, `probe produced no result: ${out}`);
    const missing = JSON.parse(line.slice('RESULT:'.length));
    assert.deepEqual(missing, [], `not reachable from the bundle: ${missing.join(', ')}`);
  } finally {
    fs.rmSync(probeSrc, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
