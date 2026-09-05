# 🗺️ Anarchy Database Client — Feature Roadmap & Quality Assurance Guide

This document outlines the architectural enhancements, high-value feature proposals, and the end-to-end testing strategy for the **Anarchy Database Client for VS Code**.

---

## 📑 Table of Contents
1. [🌟 Category 1: Schema-Aware SQL Editor & IntelliSense](#-category-1-schema-aware-sql-editor--intellisense)
2. [🛡️ Category 2: Safe Mode & Production Guard](#️-category-2-safe-mode--production-guard)
3. [🤖 Category 3: Real LLM AI Assistant & Natural Language SQL](#-category-3-real-llm-ai-assistant--natural-language-sql)
4. [📊 Category 4: Data Grid Visualizations & Rich Viewers](#-category-4-data-grid-visualizations--rich-viewers)
5. [🔄 Category 5: Multi-Format Data Formatter & Quick Actions](#-category-5-multi-format-data-formatter--quick-actions)
6. [🔌 Category 6: Modern Engines & Analytics Drivers](#-category-6-modern-engines--analytics-drivers)
7. [🧪 Testing & Verification Strategy](#-testing--verification-strategy)

---

## 🌟 Category 1: Schema-Aware SQL Editor & IntelliSense

### Motivation
Developers spend the majority of their time writing SQL queries. A static keyword-only completion is insufficient; developers need dynamic completion for database schemas, tables, columns, aliases, foreign key joins, and function signatures.

### Features
* ✅ **Dynamic Table & Column Completion**: Intercept typing inside active SQL documents and webview consoles to offer tables and columns from the active connection.
* ✅ **Smart Join Path Suggestions**: Automatically suggest `JOIN other_table ON other_table.id = current_table.other_id` by inspecting foreign key relationships.
* ✅ **Hover Documentation & Column Definitions**: Hovering over table and column identifiers displays data types, nullability, default values, and primary/foreign key metadata.
* ✅ **Parameter Binding**: `:named`, `@named`, `$1` and `?` placeholders are collected through input prompts before execution, in the editor (`Run Query`, `Explain`) and the query console. Literals, comments, `::` casts and dollar-quoted bodies are skipped. See `src/sql/QueryParameters.ts` and the `anarchyDbClient.promptForQueryParameters` setting.

---

## 🛡️ Category 2: Safe Mode & Production Guard

### Motivation
Accidental `UPDATE` or `DELETE` statements without a `WHERE` clause or unintended mutations on a production database can cause catastrophic data loss.

### Features
* ✅ **Environment Tags & Protection**: If a connection has `color: 'red'` or `group: 'Production'`, enable **Production Guard**.
* ✅ **Destructive Query Interceptor**: Detect `DROP`, `TRUNCATE`, or unconstrained `UPDATE`/`DELETE` queries and prompt a modal confirmation with a required confirmation phrase.
* ✅ **Read-Only Enforced Mode**: Option per connection to block all write statements directly at the driver proxy level.

---

## 🤖 Category 3: Real LLM AI Assistant & Natural Language SQL

### Motivation
Replace static hardcoded mock prompts with real AI integration, supporting cloud providers, local offline models (Ollama), and VS Code native AI Copilot APIs.

### Features
* **Multi-Backend AI Engine**:
  - ✅ VS Code Native Language Model API (`vscode.lm`)
  - ✅ OpenAI / Anthropic API keys, persisted in VS Code Secrets (`Set AI Provider API Key...`); the provider is inferred from the key prefix
  - ✅ Local Ollama / vLLM HTTP endpoints for privacy-sensitive offline environments
* ✅ **Schema-Injected Prompting**: Automatically construct compact, token-efficient schema contexts (`CREATE TABLE` DDL or table summaries) to yield high-accuracy SQL generation.
* ✅ **AI Error Fixer & Query Explainer**: "Explain Query" and "Fix with AI" buttons for failed queries.

---

## 📊 Category 4: Data Grid Visualizations & Rich Viewers

### Motivation
Tabular rows alone make spotting trends and inspecting non-primitive data (JSON, Images, Geometries) difficult.

### Features
* ✅ **Chart View in Data Grid**: One-click toggle from Grid to Chart view (Bar, Line, Pie, Scatter) powered by Chart.js / SVG rendering.
* ✅ **Foreign Key Quick Peek / Jump**: Clicking on foreign key values opens a preview popover or navigates directly to the target record in the referenced table.
* **Rich In-Cell Modals**:
  - ✅ **JSON Tree Viewer**: Formatted, collapsible JSON tree with search and syntax highlighting.
  - ✅ **Image / Media Previewer**: Base64 / binary image viewer.
  - ✅ **UUID & Timestamp Formatter**: a 🕓 badge decodes UUID version/variant, the timestamp embedded in v1 and v7, and epoch seconds/milliseconds/microseconds or ISO text into UTC, local and relative time. See `src/util/ValueInsight.ts`.
* ✅ **Aggregation Summary Bar**: Instant calculation of `COUNT`, `SUM`, `AVG`, `MIN`, `MAX` for selected columns in the grid footer.

---

## 🔄 Category 5: Multi-Format Data Formatter & Quick Actions

### Features
* **Copy As Formatter**:
  - ✅ Copy selected rows as **Markdown Table**
  - ✅ Copy as **SQL INSERT Statements** (with the real, schema-qualified table name)
  - ✅ Copy as **JSON Array**
  - ✅ Copy as **TypeScript Interface / Go Struct / Python Dataclass** — all rendered by `DataFormatService` in the extension host
* ✅ **Staged Batch Editing**: Edit multiple cells across rows with colored diff highlights and a batch `Apply Changes` / `Revert All` staging bar.

---

## 🔌 Category 6: Modern Engines & Analytics Drivers

### Features
* ✅ **DuckDB Driver**: Local file querying (`.parquet`, `.csv`, `.arrow`, `.duckdb`) for high-performance analytical queries.
* ✅ **Vector DB / pgvector Visualizer**: `Vector Similarity Search...` on any table with a `vector`/`halfvec`/`sparsevec` column builds a k-NN query — cosine (`<=>`), L2 (`<->`) or inner product (`<#>`) — anchored either on a pasted embedding or on an existing row. See `src/sql/VectorQuery.ts`.

---

## 🧪 Testing & Verification Strategy

Every feature is accompanied by automated unit and integration tests under `test/`:

1. **TypeScript Type Safety**: `npm run typecheck`
2. **Unit Test Suite**: `npm test` running Node.js native test runner against esbuild test bundles in `out-test/`.
3. **VS Code API Mocking**: Comprehensive mock stubs in `test/stubs/vscode.js` ensuring headless test execution.
4. **Driver & SQL Writing Tests**: Parameterization tests in `test/rowWriter.test.ts` and `test/searchClause.test.ts`.
5. **Webview Scripts & Sanitization**: Cross-Site Scripting (XSS) prevention and JSON/BigInt sanitization tests.
6. **Bundle Integrity**: `test/bundleIntegrity.test.ts` bundles a probe with the production esbuild config and requires every runtime module with no `node_modules` in reach, so a dependency missing from the shipped bundle fails the suite rather than production.

---

---

## ✅ Status

Every feature listed above is implemented. The suite covering them runs with `npm test`
(type check, production bundle, test bundles, then the Node test runner).

Feature work that is deliberately *not* here: nothing in this document is outstanding.
New proposals should be added as a fresh category rather than appended to a completed one.
