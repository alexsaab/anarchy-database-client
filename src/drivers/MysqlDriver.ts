import mysql from 'mysql2/promise';
import { BaseDriver, ForeignKeyInfo } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';

export class MysqlDriver extends BaseDriver {
  private connection: mysql.Connection | null = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config, password);
  }

  async connect(): Promise<void> {
    if (this.connection) {
      await this.disconnect();
    }
    this.connection = await mysql.createConnection({
      host: this.config.host || 'localhost',
      port: this.config.port || 3306,
      user: this.config.user || 'root',
      password: this.password || '',
      database: this.config.database || undefined,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
      connectTimeout: 5000,
    });
    this.isConnected = true;
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      try {
        await this.connection.end();
      } catch (e) {
        // Ignore disconnect errors
      }
      this.connection = null;
      this.isConnected = false;
    }
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      const conn = await mysql.createConnection({
        host: this.config.host || 'localhost',
        port: this.config.port || 3306,
        user: this.config.user || 'root',
        password: this.password || '',
        database: this.config.database || undefined,
        ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
        connectTimeout: 5000,
      });
      await conn.query('SELECT 1');
      await conn.end();
      return { success: true, message: 'Successfully connected to MySQL database!' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    }
  }

  async getDatabases(): Promise<string[]> {
    const res = await this.executeQuery("SHOW DATABASES WHERE `Database` NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys');");
    return res.rows.map((r) => r.Database);
  }

  async getTables(databaseName?: string): Promise<TableInfo[]> {
    if (databaseName) {
      await this.executeQuery(`USE \`${databaseName}\`;`);
    }
    const res = await this.executeQuery('SHOW FULL TABLES;');
    return res.rows.map((r) => {
      const keys = Object.keys(r);
      const tableName = r[keys[0]];
      const tableType = r[keys[1]];
      return {
        name: tableName,
        type: tableType === 'VIEW' ? 'view' : 'table',
      };
    });
  }

  async getColumns(tableName: string, databaseName?: string): Promise<ColumnInfo[]> {
    if (databaseName) {
      await this.executeQuery(`USE \`${databaseName}\`;`);
    }
    const res = await this.executeQuery(`DESCRIBE \`${tableName}\`;`);
    return res.rows.map((r) => ({
      name: r.Field,
      type: r.Type,
      nullable: r.Null === 'YES',
      isPrimaryKey: r.Key === 'PRI',
      defaultValue: r.Default,
    }));
  }

  async getForeignKeys(tableName: string, databaseName?: string): Promise<ForeignKeyInfo[]> {
    const db = databaseName || this.config.database;
    if (!db) return [];
    const sql = `
      SELECT 
        column_name, 
        referenced_table_name AS foreign_table_name, 
        referenced_column_name AS foreign_column_name
      FROM information_schema.key_column_usage
      WHERE table_schema = '${db}' AND table_name = '${tableName}' AND referenced_table_name IS NOT NULL;
    `;
    try {
      const res = await this.executeQuery(sql);
      return res.rows.map((r) => ({
        columnName: r.column_name,
        foreignTableName: r.foreign_table_name,
        foreignColumnName: r.foreign_column_name,
      }));
    } catch (e) {
      return [];
    }
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    if (!this.connection) {
      await this.connect();
    }
    const startTime = Date.now();
    const [rows, fields] = await this.connection!.query(sql);
    const costTimeMs = Date.now() - startTime;

    const columnFields: ColumnInfo[] = (fields || []).map((f) => ({
      name: f.name,
      type: 'unknown',
      nullable: true,
    }));

    const resultRows = Array.isArray(rows) ? rows : [];
    const affected = (rows as mysql.ResultSetHeader).affectedRows || 0;

    return {
      rows: resultRows,
      fields: columnFields,
      affectedRows: affected,
      costTimeMs,
    };
  }

  async getTableData(tableName: string, params: PageParams, schemaName?: string): Promise<QueryResult> {
    const offset = (params.page - 1) * params.pageSize;
    let sql = `SELECT * FROM \`${tableName}\``;

    if (params.filterSql) {
      sql += ` WHERE ${params.filterSql}`;
    }

    if (params.sortField && params.sortOrder) {
      sql += ` ORDER BY \`${params.sortField}\` ${params.sortOrder}`;
    }

    sql += ` LIMIT ${params.pageSize} OFFSET ${offset};`;

    const countSql = `SELECT COUNT(*) as total FROM \`${tableName}\``;
    const countRes = await this.executeQuery(countSql);
    const totalCount = parseInt(countRes.rows[0]?.total || '0', 10);

    const queryResult = await this.executeQuery(sql);
    queryResult.totalCount = totalCount;
    return queryResult;
  }
}
