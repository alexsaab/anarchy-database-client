import fs from 'fs';
import { BaseDriver, ForeignKeyInfo } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';
import { buildPagedQuery, finishPage } from '../sql/PagedQuery.js';
import { quoteId } from '../sql/RowWriter.js';

export class DuckdbDriver extends BaseDriver {
  private db: any = null;
  private con: any = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config, password);
  }

  private static loadDuckdb(): any {
    try {
      return require('duckdb');
    } catch (e: any) {
      throw new Error(`The DuckDB engine could not be loaded: ${e?.message || e}`);
    }
  }

  private get dbPath(): string {
    return this.config.dbPath || this.config.database || ':memory:';
  }

  get supportsParameterizedQueries(): boolean {
    return true;
  }

  get supportsRowWrites(): boolean {
    return true;
  }

  get supportsSqlWrites(): boolean {
    return true;
  }

  placeholder(_index: number): string {
    return '?';
  }

  async connect(): Promise<void> {
    if (this.isConnected && this.db && this.con) {
      return;
    }

    await this.connectOnce(async () => {
      if (this.isConnected && this.db && this.con) {
        return;
      }
      await this.disconnect().catch(() => {});

      const dbPath = this.dbPath;
      if (dbPath !== ':memory:' && !fs.existsSync(dbPath)) {
        const dir = dbPath.includes('/') ? dbPath.substring(0, dbPath.lastIndexOf('/')) : '.';
        if (dir && !fs.existsSync(dir)) {
          throw new Error(`DuckDB database directory not found: ${dir}`);
        }
      }

      const duckdb = DuckdbDriver.loadDuckdb();
      try {
        this.db = new duckdb.Database(dbPath);
        this.con = this.db.connect();
        this.isConnected = true;
      } catch (err: any) {
        this.isConnected = false;
        throw new Error(`Failed to initialize DuckDB database at ${dbPath}: ${err.message || err}`);
      }
    });
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    if (this.con) {
      try {
        this.con.close();
      } catch {}
      this.con = null;
    }
    if (this.db) {
      try {
        this.db.close();
      } catch {}
      this.db = null;
    }
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      await this.connect();
      await this.allAsync('SELECT 1;');
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err?.message || String(err) };
    }
  }

  private allAsync(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.con) {
        return reject(new Error('DuckDB is not connected.'));
      }
      const cb = (err: any, res: any) => {
        if (err) return reject(err);
        const rows = res || [];
        const sanitized = rows.map((row: any) => {
          if (!row || typeof row !== 'object') return row;
          const clean: any = {};
          for (const k of Object.keys(row)) {
            const val = row[k];
            clean[k] = typeof val === 'bigint' ? Number(val) : val;
          }
          return clean;
        });
        resolve(sanitized);
      };

      if (params.length > 0) {
        this.con.all(sql, ...params, cb);
      } else {
        this.con.all(sql, cb);
      }
    });
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    return this.executeParameterized(sql, []);
  }

  async executeParameterized(sql: string, params: any[]): Promise<QueryResult> {
    const startTime = Date.now();
    await this.connect();

    const rows = await this.allAsync(sql, params);
    const costTimeMs = Date.now() - startTime;

    const fields: ColumnInfo[] =
      rows.length > 0
        ? Object.keys(rows[0]).map((k) => ({
            name: k,
            type: typeof rows[0][k],
            nullable: true,
          }))
        : [];

    let affectedRows = rows.length;
    if (rows.length === 1 && typeof rows[0].Count === 'number') {
      affectedRows = rows[0].Count;
    }

    return {
      rows,
      fields,
      costTimeMs,
      affectedRows,
    };
  }

  async getDatabases(): Promise<string[]> {
    return ['main'];
  }

  async getTables(_databaseName?: string): Promise<TableInfo[]> {
    await this.connect();
    try {
      const rows = await this.allAsync(
        `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name;`
      );
      return rows.map((r: any) => ({
        name: r.table_name,
        type: r.table_type === 'VIEW' ? 'view' : 'table',
      }));
    } catch {
      const rows = await this.allAsync('SHOW TABLES;');
      return rows.map((r: any) => ({
        name: r.name,
        type: 'table',
      }));
    }
  }

  async getColumns(tableName: string, _databaseName?: string, _schemaName?: string): Promise<ColumnInfo[]> {
    await this.connect();
    let pks = new Set<string>();
    try {
      const constraints = await this.allAsync(
        `SELECT constraint_type, constraint_column_names FROM duckdb_constraints() WHERE table_name = ?;`,
        [tableName]
      );
      for (const c of constraints) {
        if (c.constraint_type === 'PRIMARY KEY' && Array.isArray(c.constraint_column_names)) {
          for (const col of c.constraint_column_names) {
            pks.add(String(col).toLowerCase());
          }
        }
      }
    } catch {}

    const rows = await this.allAsync(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = ? ORDER BY ordinal_position;`,
      [tableName]
    );

    return rows.map((r: any) => ({
      name: r.column_name,
      type: r.data_type || 'VARCHAR',
      nullable: r.is_nullable === 'YES',
      isPrimaryKey: pks.has(String(r.column_name).toLowerCase()),
    }));
  }

  async getForeignKeys(tableName: string, _databaseName?: string, _schemaName?: string): Promise<ForeignKeyInfo[]> {
    await this.connect();
    try {
      const rows = await this.allAsync(
        `SELECT constraint_name, constraint_column_names, referenced_table, referenced_column_names FROM duckdb_constraints() WHERE table_name = ? AND constraint_type = 'FOREIGN KEY';`,
        [tableName]
      );
      const fks: ForeignKeyInfo[] = [];
      for (const r of rows) {
        const cols = r.constraint_column_names || [];
        const refCols = r.referenced_column_names || [];
        for (let i = 0; i < cols.length; i++) {
          fks.push({
            constraintName: r.constraint_name || 'fk',
            columnName: cols[i],
            referencedTable: r.referenced_table,
            referencedColumn: refCols[i] || 'id',
          });
        }
      }
      return fks;
    } catch {
      return [];
    }
  }

  async getTableData(tableName: string, params: PageParams, schemaName?: string): Promise<QueryResult> {
    await this.connect();
    const tableRef = quoteId('DuckDB', tableName);
    const columns = await this.getColumns(tableName, undefined, schemaName);

    const query = buildPagedQuery({
      dbType: 'DuckDB',
      tableRef,
      params,
      columns,
    });

    const countRes = await this.executeParameterized(query.countSql, query.countParams);
    const totalCount = countRes.rows[0]?.total ?? 0;

    const result = await this.executeParameterized(query.rowsSql, query.rowsParams);
    result.totalCount = totalCount;
    if (columns && columns.length > 0) {
      result.fields = columns;
    }
    return finishPage(result, query.reversed);
  }
}
