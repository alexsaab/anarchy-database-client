# AGENTS.md — Developer & AI Agent Guide

Welcome to the **Anarchy Database Client for VS Code** codebase. This guide provides AI agents and human contributors with essential context on the architecture, conventions, workflows, and testing practices.

---

## 🏛 Architecture Overview

This project is a VS Code database client extension supporting multiple SQL and NoSQL database engines. It provides connection management, tree explorer navigation, interactive grid views, visual designers, ER diagrams, data/schema diffing, and export/import capabilities.

### Directory Structure

```
├── src/
│   ├── extension.ts             # Extension activation, command registration, lifecycle hooks
│   ├── drivers/                 # DBMS drivers & connection management
│   │   ├── BaseDriver.ts        # Abstract driver base class (reconnects, transactions, query execution)
│   │   ├── DriverManager.ts     # Driver instance caching, lifecycle, and pooling
│   │   ├── ConnectionState.ts   # Live connection health tracking & event emitter
│   │   ├── PostgresDriver.ts    # PostgreSQL driver (pg)
│   │   ├── MysqlDriver.ts       # MySQL / MariaDB driver (mysql2)
│   │   ├── SqliteDriver.ts      # SQLite driver (node-sqlite3-wasm)
│   │   ├── RedisDriver.ts       # Redis driver (ioredis / redis)
│   │   ├── MongoDriver.ts       # MongoDB driver (mongodb)
│   │   ├── ElasticsearchDriver.ts # Elasticsearch driver (@elastic/elasticsearch)
│   │   ├── ClickhouseDriver.ts  # ClickHouse driver (@clickhouse/client)
│   │   ├── MssqlDriver.ts       # SQL Server driver (mssql)
│   │   ├── CouchdbDriver.ts     # CouchDB driver
│   │   ├── CouchbaseDriver.ts   # Couchbase driver
│   │   └── FirestoreDriver.ts   # Firebase Firestore driver
│   ├── storage/                 # State & secret persistence
│   │   ├── ConnectionStorage.ts # Connection configs in globalState & passwords in secrets
│   │   ├── QueryFileStorage.ts  # Workspace & local query files
│   │   └── QueryHistoryStorage.ts # Query execution history and saved snippets
│   ├── tree/                    # VS Code TreeDataProvider implementation
│   │   ├── DatabaseTreeProvider.ts # Root TreeDataProvider with group & node hierarchy
│   │   ├── BaseNode.ts          # Base tree node
│   │   ├── ConnectionNode.ts    # Connection node with health status & context menus
│   │   ├── GroupNode.ts         # Connection folder/grouping node
│   │   ├── DatabaseNode.ts      # Database level node
│   │   ├── TableGroupNode.ts    # Tables group node
│   │   ├── TableNode.ts         # Table node (inline view, designer, compare)
│   │   ├── ColumnNode.ts        # Column definitions & types
│   │   └── ... (ViewGroup, FunctionGroup, ProcedureGroup, TriggerGroup, QueryGroup)
│   ├── webview/                 # Interactive Webview panels
│   │   ├── ConnectWebviewProvider.ts      # Connection add/edit/test dialog
│   │   ├── TableWebviewProvider.ts        # Table data grid & query console
│   │   ├── TableDesignWebviewProvider.ts  # Visual table structure designer
│   │   ├── ErdWebviewProvider.ts          # ER diagram visualizer
│   │   ├── SchemaDiffWebviewProvider.ts   # Schema difference & migration tool
│   │   ├── DataSyncWebviewProvider.ts     # Data diff & sync
│   │   ├── ProcessListWebviewProvider.ts  # DBMS process monitor
│   │   ├── QueryBuilderWebviewProvider.ts # Visual query builder
│   │   ├── ExplainWebviewProvider.ts      # Query EXPLAIN plan analyzer
│   │   ├── RedisWebviewProvider.ts        # Redis key/value editor
│   │   └── AiSqlAssistantWebviewProvider.ts # AI SQL assistant
│   ├── sql/                     # Query builders & pagination
│   │   ├── Keyset.ts            # Keyset (cursor-based) pagination for high performance
│   │   ├── PagedQuery.ts        # General pagination abstraction
│   │   ├── RowWriter.ts         # Safe parameterized UPDATE/INSERT/DELETE builder
│   │   └── SearchClause.ts      # Multi-column parameterized server-side search
│   ├── export/                  # ExportService (CSV, JSON, Excel streaming via exceljs)
│   ├── import/                  # ImportService (CSV, Excel parsing & insertion)
│   ├── dump/                    # DatabaseDumpService (SQL dump & restore)
│   ├── mock/                    # MockDataGenerator (Realistic mock data generation)
│   ├── diagram/                 # MermaidService (Mermaid ER diagram generation)
│   ├── ssh/                     # SshTunnelManager (SSH port forwarding via ssh2)
│   ├── status/                  # StatusBarHealthMonitor (Status bar connection indicators)
│   ├── model/                   # Data types & interfaces (ConnectionConfig, QueryTypes)
│   └── util/                    # Helpers (i18n.ts, IconHelper.ts)
├── test/                        # Unit and integration tests
│   ├── stubs/vscode.js          # Mock implementation of the VS Code API
│   ├── connectionClone.test.ts  # Connection cloning unit tests
│   ├── connectionState.test.ts  # ConnectionState & reconnect tests
│   ├── export.test.ts           # Data export unit tests
│   ├── importRoundTrip.test.ts  # Import/export round-trip tests
│   ├── keyset.test.ts           # Keyset pagination tests
│   ├── rowWriter.test.ts        # SQL row writer & injection protection tests
│   └── ...
├── scripts/
│   └── build-tests.js           # Test bundling script using esbuild & vscode stub
├── esbuild.js                   # Extension production bundler
├── package.json                 # Extension manifest (contributes, commands, menus)
├── package.nls.json             # English localization keys
├── package.nls.ru.json          # Russian localization keys
├── package.nls.zh-cn.json       # Chinese localization keys
└── package.nls.de.json          # German localization keys
```

---

## 🔑 Core Design Patterns & Conventions

### 1. Connection & Credential Storage
- Connection configuration profiles are saved in `vscode.ExtensionContext.globalState` under key `database_client_connections`.
- Sensitive passwords and SSH passwords are **never** stored in plain JSON config in `globalState`; they are stored in `vscode.ExtensionContext.secrets` with keys `password_${id}` and `ssh_password_${id}`.
- Always use `ConnectionStorageService` to retrieve or persist connections and passwords.

### 2. Driver Layer (`src/drivers/`)
- All DBMS drivers inherit from `BaseDriver`.
- `BaseDriver` handles connection locking, reconnect retry loops (`withReconnect`), query execution metrics (`costTimeMs`), and dialect quoting.
- Drivers are managed as singletons via `DriverManager.getInstance()`. Never instantiate drivers directly outside `DriverManager`.
- Driver handles are isolated per connection ID. If connection configuration changes, the old driver instance is disconnected and removed.

### 3. Tree Provider & Context Menus
- `DatabaseTreeProvider` implements `vscode.TreeDataProvider<BaseNode>`.
- Context menus in `package.json` are bound to `viewItem` conditions (`connectionNode`, `databaseNode`, `tableNode`, `queryFileNode`, etc.).
- When adding commands, make sure to register both in `contributes.commands` and `contributes.menus` in `package.json`, along with localization entries in `package.nls.*.json`.

### 4. Localization (i18n)
- Runtime strings use `t(englishText, russianText)` from `src/util/i18n.ts`.
- Manifest declarations (commands, views) use `%key%` placeholders resolved from `package.nls.json`, `package.nls.ru.json`, `package.nls.zh-cn.json`, and `package.nls.de.json`.

### 5. Safe SQL Generation & Pagination
- All queries constructed by the UI must use parameterized values to prevent SQL injection (see `RowWriter.ts` and `SearchClause.ts`).
- Keyset (cursor-based) pagination (`Keyset.ts`) is preferred for large tables when a primary key is available, falling back to `LIMIT/OFFSET` when necessary.

---

## 🛠 Build and Test Workflows

### Prerequisites
- Node.js >= 18.x
- npm

### Common Commands

```bash
# 1. Typecheck the TypeScript codebase
npm run typecheck

# 2. Build the extension bundle (outputs to out/)
npm run build

# 3. Build the test suite (bundles test files with esbuild and vscode stub into out-test/)
npm run build:tests

# 4. Run standalone unit tests
node --test "out-test/connectionClone.test.js" "out-test/connectionState.test.js" "out-test/keyset.test.js" "out-test/rowWriter.test.js"

# 5. Run complete test suite
npm test

# 6. Package into a .vsix extension file
npm run package
```

---

## 🤖 Guidelines for AI Agents

1. **Strict TypeScript Compliance**: Always run `npm run typecheck` after modifying source code. Ensure types are properly imported and used with `.js` extensions as per ESM project settings.
2. **Preserve Secret Handling**: When adding or updating connection operations (e.g., clone, export, migrate), always handle secrets via `context.secrets` and clean up deleted connection secrets.
3. **Keep UI Responsive & Localized**: Add both English and Russian strings via `t(...)` for user-facing runtime messages and update all `package.nls.*.json` files for new commands.
4. **Maintain Test Coverage**: Whenever adding new business logic or storage methods, write corresponding unit tests under `test/` and run `npm run build:tests && node --test "out-test/<testName>.test.js"`.
