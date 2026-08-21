// Shared by the production build and the bundle-integrity test so the two can
// never drift apart.
//
// Only genuinely unbundlable modules belong here: 'vscode' is provided by the
// host, and the rest are optional native/peer deps that are require()d
// conditionally. Anything else MUST be bundled -- the packaged extension ships
// no node_modules, so an external dependency is simply missing at runtime.
module.exports = {
  external: ['vscode', 'pg-native', 'cardinal', 'cpu-features'],
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
  ],
};
