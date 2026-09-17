import fs from 'fs';
import { BaseDriver, ForeignKeyInfo } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { BoundStatement, ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';
import { buildPagedQuery, finishPage, renumber } from '../sql/PagedQuery.js';

export class SqliteDriver extends BaseDriver {
  private db: any = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config, password);
  }

  /**
   * SQLite runs on the WebAssembly build rather than the native addon: the
   * packaged extension ships no node_modules, and a native binary would have to
   * match the extension host's ABI on every platform. The WASM build is bundled
   * with the extension and works everywhere.
   */
  private static loadSqlite(): any {
    try {
      return require('node-sqlite3-wasm');
    } catch (e: any) {
      throw new Error(`The bundled SQLite engine could not be loaded: ${e?.message || e}`);
    }
  }

  private get dbPath(): string {
    return this.config.dbPath || this.config.database || ':memory:';
  }

  async connect(): Promise<void> {
    if (this.isConnected && this.db) {
      return;
    }

    await this.connectOnce(async () => {
      if (this.isConnected && this.db) {
        return;
      }
      await this.disconnect().catch(() => {});

      const dbPath = this.dbPath;
      if (dbPath !== ':memory:' && !fs.existsSync(dbPath)) {
        throw new Error(`SQLite database file not found: ${dbPath}`);
      }

      const { Database } = SqliteDriver.loadSqlite();
      try {
        this.db = new Database(dbPath);
      } catch (err: any) {
        throw new Error(`Could not open SQLite database "${dbPath}": ${err?.message || err}`);
      }
      this.isConnected = true;
    });
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
      } catch (e) {}
      this.db = null;
    }
    this.isConnected = false;
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      await this.connect();
      const res = await this.executeQuery('SELECT sqlite_version() AS version;');
      const version = res.rows[0]?.version;
      const tables = await this.getTables();
      return {
        success: true,
        message: `Opened SQLite ${version || ''} database "${this.dbPath}" (${tables.length} tables).`,
      };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    } finally {
      await this.disconnect();
    }
  }

  async getDatabases(): Promise<string[]> {
    return ['main'];
  }

  async getTables(databaseName?: string): Promise<TableInfo[]> {
    const res = await this.executeQuery("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
    return res.rows.map((r: any) => ({
      name: r.name,
      type: 'table',
    }));
  }

  async getViews(databaseName?: string): Promise<TableInfo[]> {
    const res = await this.executeQuery("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name;");
    return res.rows.map((r: any) => ({
      name: r.name,
      type: 'view',
    }));
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    const res = await this.executeQuery(`PRAGMA table_info("${tableName}");`);
    return res.rows.map((r: any) => ({
      name: r.name,
      type: String(r.type || 'TEXT').toUpperCase(),
      nullable: r.notnull === 0,
      isPrimaryKey: r.pk === 1,
      defaultValue: r.dflt_value !== null ? String(r.dflt_value) : undefined,
    }));
  }

  async getForeignKeys(tableName: string): Promise<ForeignKeyInfo[]> {
    try {
      const res = await this.executeQuery(`PRAGMA foreign_key_list("${tableName}");`);
      return res.rows.map((r: any) => ({
        // PRAGMA groups the columns of one constraint under a shared id.
        constraintName: `fk_${tableName}_${r.id}`,
        columnName: r.from,
        referencedTable: r.table,
        // A reference to the parent's primary key leaves "to" null.
        referencedColumn: r.to || 'rowid',
      }));
    } catch (e) {
      return [];
    }
  }

  override async getTableDdl(tableName: string): Promise<string> {
    try {
      const escaped = tableName.replace(/'/g, "''");
      const res = await this.executeQuery(`SELECT sql FROM sqlite_master WHERE type IN ('table', 'view') AND name = '${escaped}';`);
      const sql = res.rows[0]?.sql;
      if (typeof sql === 'string' && sql.trim()) {
        const trimmed = sql.trim();
        return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
      }
    } catch (e) {}
    return super.getTableDdl(tableName);
  }

  override async getScript(name: string, type: 'table' | 'view' | 'function' | 'procedure' | 'trigger'): Promise<string> {
    if (type === 'table' || type === 'view') {
      return this.getTableDdl(name);
    }
    return `-- DDL for ${type} ${name}`;
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    await this.connect();
    const startTime = Date.now();

    const trimmed = sql.trim().replace(/^\(+/, '').toUpperCase();
    const returnsRows =
      trimmed.startsWith('SELECT') ||
      trimmed.startsWith('PRAGMA') ||
      trimmed.startsWith('EXPLAIN') ||
      trimmed.startsWith('WITH') ||
      trimmed.startsWith('VALUES') ||
      / RETURNING /.test(trimmed);

    if (returnsRows) {
      const rows: any[] = this.db.all(sql) || [];
      const costTimeMs = Date.now() - startTime;

      // Column names come from the union of the returned rows: SQLite omits
      // nothing per row, but a NULL-only column still needs a header.
      const names: string[] = [];
      for (const row of rows.slice(0, 50)) {
        for (const k of Object.keys(row)) {
          if (!names.includes(k)) {
            names.push(k);
          }
        }
      }
      const fields: ColumnInfo[] = names.map((k) => ({ name: k, type: 'TEXT', nullable: true }));

      return { rows, fields, affectedRows: rows.length, costTimeMs };
    }

    const result = this.db.run(sql);
    return {
      rows: [],
      fields: [],
      affectedRows: result?.changes || 0,
      costTimeMs: Date.now() - startTime,
    };
  }

  public get supportsParameterizedQueries(): boolean {
    return true;
  }

  public async executeParameterized(sql: string, params: any[]): Promise<QueryResult> {
    await this.connect();
    const startTime = Date.now();
    // node-sqlite3-wasm rejects undefined; NULL must be an explicit null.
    const bound = params.map((p) => (p === undefined ? null : p));

    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH') || / RETURNING /.test(trimmed)) {
      const rows: any[] = this.db.all(sql, bound) || [];
      return {
        rows,
        fields: Object.keys(rows[0] || {}).map((k) => ({ name: k, type: 'TEXT', nullable: true })),
        affectedRows: rows.length,
        costTimeMs: Date.now() - startTime,
      };
    }

    const result = this.db.run(sql, bound);
    return { rows: [], fields: [], affectedRows: result?.changes || 0, costTimeMs: Date.now() - startTime };
  }

  public override async executeTransaction(statements: BoundStatement[]): Promise<void> {
    if (statements.length === 0) return;
    await this.connect();
    this.db.run('BEGIN TRANSACTION;');
    try {
      for (const stmt of statements) {
        const bound = (stmt.params || []).map((p) => (p === undefined ? null : p));
        if (bound.length > 0) {
          this.db.run(stmt.sql, bound);
        } else {
          this.db.run(stmt.sql);
        }
      }
      this.db.run('COMMIT;');
    } catch (err) {
      try {
        this.db.run('ROLLBACK;');
      } catch {}
      throw err;
    }
  }

  async getTableData(tableName: string, params: PageParams, schemaName?: string): Promise<QueryResult> {
    const tableRef = `"${tableName}"`;
    const columns = await this.getColumns(tableName);
    const query = buildPagedQuery({ dbType: 'SQLite', tableRef, params, columns });

    const countRes = query.countParams.length
      ? await this.executeParameterized(query.countSql, query.countParams)
      : await this.executeQuery(query.countSql);
    const totalCount = parseInt(countRes.rows[0]?.total || '0', 10);

    const result = query.rowsParams.length
      ? await this.executeParameterized(query.rowsSql, query.rowsParams)
      : await this.executeQuery(query.rowsSql);
    result.totalCount = totalCount;
    if (columns && columns.length > 0) {
      result.fields = columns;
    }
    return finishPage(result, query.reversed);
  }
}
