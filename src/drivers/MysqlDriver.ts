import mysql from 'mysql2/promise';
import { BaseDriver } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';

export class MysqlDriver extends BaseDriver {
  private connection: mysql.Connection | null = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config, password);
  }

  private async getClient(databaseName?: string): Promise<mysql.Connection> {
    return await mysql.createConnection({
      host: this.config.host || 'localhost',
      port: this.config.port || 3306,
      user: this.config.user || 'root',
      password: this.password || '',
      database: databaseName || this.config.database,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
      connectTimeout: 5000,
    });
  }

  async connect(): Promise<void> {
    if (this.connection) {
      await this.disconnect();
    }
    this.connection = await this.getClient();
    this.isConnected = true;
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      try {
        await this.connection.end();
      } catch (e) {}
      this.connection = null;
      this.isConnected = false;
    }
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      const conn = await this.getClient();
      await conn.query('SELECT 1');
      await conn.end();
      return { success: true, message: 'Successfully connected to MySQL database!' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    }
  }

  async getDatabases(): Promise<string[]> {
    const res = await this.executeQuery('SHOW DATABASES;');
    return res.rows.map((r) => Object.values(r)[0] as string);
  }

  async getTables(databaseName?: string): Promise<TableInfo[]> {
    const db = databaseName || this.config.database;
    const sql = db ? `SHOW FULL TABLES FROM \`${db}\`;` : 'SHOW FULL TABLES;';
    const res = await this.executeQuery(sql);
    return res.rows.map((r) => {
      const vals = Object.values(r);
      return {
        name: vals[0] as string,
        type: vals[1] === 'VIEW' ? 'view' : 'table',
      };
    });
  }

  async getColumns(tableName: string, databaseName?: string): Promise<ColumnInfo[]> {
    const db = databaseName || this.config.database;
    const sql = `
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = '${db}' AND TABLE_NAME = '${tableName}'
      ORDER BY ORDINAL_POSITION ASC;
    `;
    const res = await this.executeQuery(sql);
    return res.rows.map((r) => ({
      name: r.COLUMN_NAME,
      type: r.DATA_TYPE,
      nullable: r.IS_NULLABLE === 'YES',
      isPrimaryKey: r.COLUMN_KEY === 'PRI',
      defaultValue: r.COLUMN_DEFAULT,
    }));
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    if (!this.connection) {
      await this.connect();
    }
    const startTime = Date.now();
    const [rows, fields] = await this.connection!.query(sql);
    const costTimeMs = Date.now() - startTime;

    const columnInfos: ColumnInfo[] = Array.isArray(fields)
      ? fields.map((f: any) => ({
          name: f.name,
          type: 'unknown',
          nullable: true,
        }))
      : [];

    return {
      rows: Array.isArray(rows) ? (rows as Record<string, any>[]) : [],
      fields: columnInfos,
      affectedRows: (rows as any)?.affectedRows || (Array.isArray(rows) ? rows.length : 0),
      costTimeMs,
    };
  }

  async getTableData(tableName: string, params: PageParams): Promise<QueryResult> {
    const offset = (params.page - 1) * params.pageSize;
    let sql = `SELECT * FROM \`${tableName}\``;

    if (params.filterSql) {
      sql += ` WHERE ${params.filterSql}`;
    }

    if (params.sortField && params.sortOrder) {
      sql += ` ORDER BY \`${params.sortField}\` ${params.sortOrder}`;
    }

    sql += ` LIMIT ${params.pageSize} OFFSET ${offset};`;

    const countSql = `SELECT COUNT(*) as total FROM \`${tableName}\`;`;
    const countRes = await this.executeQuery(countSql);
    const totalCount = parseInt(Object.values(countRes.rows[0] || {})[0] as string || '0', 10);

    const queryResult = await this.executeQuery(sql);
    queryResult.totalCount = totalCount;
    return queryResult;
  }
}
