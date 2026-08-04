import sqlite3 from 'sqlite3';
import { BaseDriver } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';

export class SqliteDriver extends BaseDriver {
  private db: sqlite3.Database | null = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config, password);
  }

  async connect(): Promise<void> {
    if (this.db) {
      await this.disconnect();
    }
    const dbPath = this.config.dbPath || this.config.database || ':memory:';
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          this.isConnected = true;
          resolve();
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      return new Promise((resolve) => {
        this.db?.close(() => {
          this.db = null;
          this.isConnected = false;
          resolve();
        });
      });
    }
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      await this.connect();
      await this.executeQuery('SELECT 1');
      await this.disconnect();
      return { success: true, message: 'Successfully connected to SQLite database!' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    }
  }

  async getDatabases(): Promise<string[]> {
    return ['main'];
  }

  async getTables(): Promise<TableInfo[]> {
    const res = await this.executeQuery(
      "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name ASC;"
    );
    return res.rows.map((r) => ({
      name: r.name,
      type: r.type === 'view' ? 'view' : 'table',
    }));
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    const res = await this.executeQuery(`PRAGMA table_info("${tableName}");`);
    return res.rows.map((r) => ({
      name: r.name,
      type: r.type,
      nullable: r.notnull === 0,
      isPrimaryKey: r.pk === 1,
      defaultValue: r.dflt_value,
    }));
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    if (!this.db) {
      await this.connect();
    }
    const startTime = Date.now();
    return new Promise((resolve, reject) => {
      this.db!.all(sql, [], (err, rows: any[]) => {
        if (err) {
          return reject(err);
        }
        const costTimeMs = Date.now() - startTime;
        const fields: ColumnInfo[] =
          rows && rows.length > 0
            ? Object.keys(rows[0]).map((k) => ({ name: k, type: 'unknown', nullable: true }))
            : [];

        resolve({
          rows: rows || [],
          fields,
          affectedRows: rows ? rows.length : 0,
          costTimeMs,
        });
      });
    });
  }

  async getTableData(tableName: string, params: PageParams): Promise<QueryResult> {
    const offset = (params.page - 1) * params.pageSize;
    let sql = `SELECT * FROM "${tableName}"`;

    if (params.filterSql) {
      sql += ` WHERE ${params.filterSql}`;
    }

    if (params.sortField && params.sortOrder) {
      sql += ` ORDER BY "${params.sortField}" ${params.sortOrder}`;
    }

    sql += ` LIMIT ${params.pageSize} OFFSET ${offset};`;

    const countRes = await this.executeQuery(`SELECT COUNT(*) as total FROM "${tableName}";`);
    const totalCount = parseInt(countRes.rows[0]?.total || '0', 10);

    const queryResult = await this.executeQuery(sql);
    queryResult.totalCount = totalCount;
    return queryResult;
  }
}
