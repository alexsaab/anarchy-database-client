// Bundles each test/*.test.ts into out-test/, stubbing the `vscode` module so
// the suite runs under plain Node.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const testDir = path.join(__dirname, '..', 'test');
const outDir = path.join(__dirname, '..', 'out-test');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const entries = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.ts')).map((f) => path.join(testDir, f));
if (entries.length === 0) {
  console.error('no tests found');
  process.exit(1);
}

esbuild
  .build({
    entryPoints: entries,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outdir: outDir,
    sourcemap: 'inline',
    logLevel: 'warning',
    alias: { vscode: path.join(testDir, 'stubs', 'vscode.js') },
    external: ['esbuild', 'pg-native', 'cardinal', 'cpu-features', 'duckdb'],
  })
  .then(() => {
    // node-sqlite3-wasm resolves its engine from __dirname, which for the test
    // bundles is out-test/ -- the same arrangement as out/ in production.
    const wasm = require.resolve('node-sqlite3-wasm/dist/node-sqlite3-wasm.wasm');
    fs.copyFileSync(wasm, path.join(outDir, 'node-sqlite3-wasm.wasm'));
    console.log(`built ${entries.length} test bundle(s) -> out-test/`);
  })
  .catch(() => process.exit(1));
