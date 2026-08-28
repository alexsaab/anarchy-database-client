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
* **Dynamic Table & Column Completion**: Intercept typing inside active SQL documents and webview consoles to offer tables and columns from the active connection.
* **Smart Join Path Suggestions**: Automatically suggest `JOIN other_table ON other_table.id = current_table.other_id` by inspecting foreign key relationships.
* **Hover Documentation & Column Definitions**: Hovering over table and column identifiers displays data types, nullability, default values, and primary/foreign key metadata.
* **SQL Query Formatting & Parameter Binding**: Support parameterized queries with prompt modals (`:param`, `$1`, `?`).

---

## 🛡️ Category 2: Safe Mode & Production Guard

### Motivation
Accidental `UPDATE` or `DELETE` statements without a `WHERE` clause or unintended mutations on a production database can cause catastrophic data loss.

### Features
* **Environment Tags & Protection**: If a connection has `color: 'red'` or `group: 'Production'`, enable **Production Guard**.
* **Destructive Query Interceptor**: Detect `DROP`, `TRUNCATE`, or unconstrained `UPDATE`/`DELETE` queries and prompt a modal confirmation with a required confirmation phrase.
* **Read-Only Enforced Mode**: Option per connection to block all write statements directly at the driver proxy level.

---

## 🤖 Category 3: Real LLM AI Assistant & Natural Language SQL

### Motivation
Replace static hardcoded mock prompts with real AI integration, supporting cloud providers, local offline models (Ollama), and VS Code native AI Copilot APIs.

### Features
* **Multi-Backend AI Engine**:
  - VS Code Native Language Model API (`vscode.lm`)
  - OpenAI / Anthropic API keys (persisted securely in VS Code Secrets)
  - Local Ollama / vLLM HTTP endpoints for privacy-sensitive offline environments
* **Schema-Injected Prompting**: Automatically construct compact, token-efficient schema contexts (`CREATE TABLE` DDL or table summaries) to yield high-accuracy SQL generation.
* **AI Error Fixer & Query Explainer**: "Explain Query" and "Fix with AI" buttons for failed queries.

---

## 📊 Category 4: Data Grid Visualizations & Rich Viewers

### Motivation
Tabular rows alone make spotting trends and inspecting non-primitive data (JSON, Images, Geometries) difficult.

### Features
* **Chart View in Data Grid**: One-click toggle from Grid to Chart view (Bar, Line, Pie, Scatter) powered by Chart.js / SVG rendering.
* **Foreign Key Quick Peek / Jump**: Clicking on foreign key values opens a preview popover or navigates directly to the target record in the referenced table.
* **Rich In-Cell Modals**:
  - **JSON Tree Viewer**: Formatted, collapsible JSON tree with search and syntax highlighting.
  - **Image / Media Previewer**: Base64 / binary image viewer.
  - **UUID & Timestamp Formatter**: Instant human-readable date/time conversions.
* **Aggregation Summary Bar**: Instant calculation of `COUNT`, `SUM`, `AVG`, `MIN`, `MAX` for selected columns in the grid footer.

---

## 🔄 Category 5: Multi-Format Data Formatter & Quick Actions

### Features
* **Copy As Formatter**:
  - Copy selected rows as **Markdown Table**
  - Copy as **SQL INSERT Statements**
  - Copy as **JSON Array**
  - Copy as **TypeScript Interface / Go Struct / Python Dataclass**
* **Staged Batch Editing**: Edit multiple cells across rows with colored diff highlights and a batch `Apply Changes` / `Revert All` staging bar.

---

## 🔌 Category 6: Modern Engines & Analytics Drivers

### Features
* **DuckDB Driver**: Local file querying (`.parquet`, `.csv`, `.arrow`, `.duckdb`) for high-performance analytical queries.
* **Vector DB / pgvector Visualizer**: Search and inspect embeddings and cosine distance metrics.

---

## 🧪 Testing & Verification Strategy

Every feature is accompanied by automated unit and integration tests under `test/`:

1. **TypeScript Type Safety**: `npm run typecheck`
2. **Unit Test Suite**: `npm test` running Node.js native test runner against esbuild test bundles in `out-test/`.
3. **VS Code API Mocking**: Comprehensive mock stubs in `test/stubs/vscode.js` ensuring headless test execution.
4. **Driver & SQL Writing Tests**: Parameterization tests in `test/rowWriter.test.ts` and `test/searchClause.test.ts`.
5. **Webview Scripts & Sanitization**: Cross-Site Scripting (XSS) prevention and JSON/BigInt sanitization tests.

---
