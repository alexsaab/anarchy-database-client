import { BaseDriver } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';

export class SqliteDriver extends BaseDriver {
  private db: any = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config, password);
  }

  async connect(): Promise<void> {
    if (this.db) {
      await this.disconnect();
    }

    let sqlite3: any;
    try {
      sqlite3 = require('sqlite3');
    } catch (e) {
      throw new Error('sqlite3 native module is not available in this environment.');
    }

    const dbPath = this.config.dbPath || this.config.database || ':memory:';
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(dbPath, (err: any) => {
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
      return new Promise((resolve, reject) => {
        this.db.close((err: any) => {
          this.db = null;
          this.isConnected = false;
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      await this.connect();
      return { success: true, message: 'Successfully connected to SQLite database!' };
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
    const res = await this.executeQuery("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';");
    return res.rows.map((r: any) => ({
      name: r.name,
      type: 'table',
    }));
  }

  async getViews(databaseName?: string): Promise<TableInfo[]> {
    const res = await this.executeQuery("SELECT name FROM sqlite_master WHERE type='view';");
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

  async getForeignKeys(tableName: string): Promise<any[]> {
    return [];
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    await this.connect();
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('EXPLAIN')) {
        this.db.all(sql, [], (err: any, rows: any[]) => {
          const costTimeMs = Date.now() - startTime;
          if (err) return reject(err);

          const sampleRow = rows && rows[0] ? rows[0] : {};
          const fields: ColumnInfo[] = Object.keys(sampleRow).map((k) => ({
            name: k,
            type: 'TEXT',
            nullable: true,
          }));

          resolve({
            rows: rows || [],
            fields,
            affectedRows: rows ? rows.length : 0,
            costTimeMs,
          });
        });
      } else {
        this.db.run(sql, [], function (this: any, err: any) {
          const costTimeMs = Date.now() - startTime;
          if (err) return reject(err);

          resolve({
            rows: [],
            fields: [],
            affectedRows: this.changes || 0,
            costTimeMs,
          });
        });
      }
    });
  }

  async getTableData(tableName: string, params: PageParams, schemaName?: string): Promise<QueryResult> {
    const offset = (params.page - 1) * params.pageSize;
    let sql = `SELECT * FROM "${tableName}"`;
    let countSql = `SELECT COUNT(*) as total FROM "${tableName}"`;

    if (params.filterSql) {
      sql += ` WHERE ${params.filterSql}`;
      countSql += ` WHERE ${params.filterSql}`;
    }

    sql += ` LIMIT ${params.pageSize} OFFSET ${offset};`;

    const countRes = await this.executeQuery(countSql);
    const totalCount = parseInt(countRes.rows[0]?.total || '0', 10);

    const queryResult = await this.executeQuery(sql);
    queryResult.totalCount = totalCount;
    return queryResult;
  }
}
