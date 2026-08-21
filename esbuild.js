const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { external } = require('./scripts/bundle-config.js');

/**
 * node-sqlite3-wasm loads its .wasm from `__dirname`, which after bundling is
 * out/. Copy it there so the packaged extension carries its SQLite engine.
 */
function copySqliteWasm() {
  const src = require.resolve('node-sqlite3-wasm/dist/node-sqlite3-wasm.wasm');
  const destDir = path.join(__dirname, 'out');
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, 'node-sqlite3-wasm.wasm');
  fs.copyFileSync(src, dest);
  console.log(`copied ${path.basename(dest)} (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)}mb) -> out/`);
}

const isWatch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: false,
    sourcemap: true,
    sourcesContent: false,
    platform: 'node',
    outfile: 'out/extension.js',
    external,
    logLevel: 'info',
  });

  copySqliteWasm();

  if (isWatch) {
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
