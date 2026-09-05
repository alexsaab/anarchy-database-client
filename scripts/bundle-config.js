// Shared by the production build and the bundle-integrity test so the two can
// never drift apart.
//
// Only genuinely unbundlable modules belong here: 'vscode' is provided by the
// host, and the rest are optional native/peer deps that are require()d
// conditionally. Anything else MUST be bundled -- the packaged extension ships
// no node_modules, so an external dependency is simply missing at runtime.
const path = require('path');

/**
 * Prebuilt native addons (.node) cannot be bundled, and shipping one would tie
 * the VSIX to the build machine's OS, arch and Node ABI. Every .node we pull in
 * is an *optional* accelerator: ssh2 requires its sshcrypto binding inside a
 * try/catch and falls back to pure-JS crypto when it is absent. esbuild resolves
 * such a require() statically and fails the build regardless of the try/catch,
 * so leave the call in the bundle as-is -- it throws at runtime, gets caught,
 * and the fallback path takes over.
 *
 * Only relative/absolute specifiers count, which is how addons are loaded.
 * A bare specifier ending in .node is a package subpath, not a binary --
 * @elastic/elasticsearch imports 'apache-arrow/Arrow.node', ordinary JS that
 * must stay bundled.
 *
 * A factory, because esbuild plugin objects must not be shared between builds.
 */
function nativeAddonsExternal() {
  return {
    name: 'native-addons-external',
    setup(build) {
      build.onResolve({ filter: /\.node$/ }, (args) =>
        args.path.startsWith('.') || path.isAbsolute(args.path) ? { path: args.path, external: true } : null
      );
    },
  };
}

module.exports = {
  external: ['vscode', 'pg-native', 'cardinal', 'cpu-features', 'duckdb'],
  nativeAddonsExternal,
  // Modules the drivers require() at runtime; all must be reachable from the bundle.
  runtimeModules: [
    '@elastic/elasticsearch',
    'ioredis',
    'node-sqlite3-wasm',
    'exceljs',
    'pg',
    'mysql2/promise',
    'mongodb',
    '@clickhouse/client',
    'ssh2',
    'mssql',
  ],
};
