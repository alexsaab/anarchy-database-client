import http from 'http';
import https from 'https';
import { BaseDriver, ForeignKeyInfo } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';

export class ClickhouseDriver extends BaseDriver {
  constructor(config: ConnectionConfig, password?: string) {
    super(config, password);
  }

  async connect(): Promise<void> {
    this.isConnected = true;
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      await this.executeQuery('SELECT 1');
      return { success: true, message: 'Successfully connected to ClickHouse database!' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    }
  }

  private async httpQuery(query: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const host = this.config.host || 'localhost';
      const port = this.config.port || 8123;
      const user = this.config.user || 'default';
      const pass = this.password || '';

      const isSsl = !!this.config.ssl;
      const protocol = isSsl ? https : http;

      const path = `/?query=${encodeURIComponent(query)}`;
      const authHeader = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

      const req = protocol.request(
        {
          hostname: host,
          port: port,
          path: path,
          method: 'GET',
          headers: {
            Authorization: authHeader,
          },
          timeout: 5000,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsed = JSON.parse(body);
                resolve(parsed);
              } catch (e) {
                resolve(body);
              }
            } else {
              reject(new Error(`ClickHouse error (${res.statusCode}): ${body.trim()}`));
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('ClickHouse request timed out'));
      });
      req.end();
    });
  }

  async getDatabases(): Promise<string[]> {
    const res = await this.httpQuery('SHOW DATABASES FORMAT JSON;');
    if (res && res.data) {
      return res.data.map((r: any) => r.name);
    }
    return ['default'];
  }

  async getTables(databaseName?: string): Promise<TableInfo[]> {
    const db = databaseName || this.config.database || 'default';
    const res = await this.httpQuery(`SHOW TABLES FROM \`${db}\` FORMAT JSON;`);
    if (res && res.data) {
      return res.data.map((r: any) => ({
        name: r.name,
        type: 'table',
      }));
    }
    return [];
  }

  async getColumns(tableName: string, databaseName?: string): Promise<ColumnInfo[]> {
    const db = databaseName || this.config.database || 'default';
    const res = await this.httpQuery(`DESCRIBE TABLE \`${db}\`.\`${tableName}\` FORMAT JSON;`);
    if (res && res.data) {
      return res.data.map((r: any) => ({
        name: r.name,
        type: r.type,
        nullable: r.type.includes('Nullable'),
        isPrimaryKey: r.is_in_primary_key === 1 || r.is_in_sorting_key === 1,
        defaultValue: r.default_expression || undefined,
        comment: r.comment || undefined,
      }));
    }
    return [];
  }

  async getForeignKeys(tableName: string, databaseName?: string): Promise<ForeignKeyInfo[]> {
    return [];
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    const startTime = Date.now();
    let queryToRun = sql.trim();
    if (!queryToRun.toUpperCase().includes('FORMAT JSON')) {
      if (queryToRun.toUpperCase().startsWith('SELECT') || queryToRun.toUpperCase().startsWith('SHOW') || queryToRun.toUpperCase().startsWith('DESCRIBE')) {
        if (queryToRun.endsWith(';')) {
          queryToRun = queryToRun.slice(0, -1) + ' FORMAT JSON;';
        } else {
          queryToRun += ' FORMAT JSON;';
        }
      }
    }

    const res = await this.httpQuery(queryToRun);
    const costTimeMs = Date.now() - startTime;

    if (typeof res === 'object' && res.data) {
      const fields: ColumnInfo[] = (res.meta || []).map((m: any) => ({
        name: m.name,
        type: m.type,
        nullable: true,
      }));

      return {
        rows: res.data || [],
        fields,
        affectedRows: res.rows || res.data.length || 0,
        costTimeMs,
      };
    }

    return {
      rows: [],
      fields: [],
      affectedRows: 0,
      costTimeMs,
    };
  }

  async getTableData(tableName: string, params: PageParams, schemaName?: string): Promise<QueryResult> {
    const offset = (params.page - 1) * params.pageSize;
    const db = this.config.database || 'default';
    let sql = `SELECT * FROM \`${db}\`.\`${tableName}\``;

    if (params.filterSql) {
      sql += ` WHERE ${params.filterSql}`;
    }

    sql += ` LIMIT ${params.pageSize} OFFSET ${offset} FORMAT JSON;`;

    const countRes = await this.httpQuery(`SELECT count() as total FROM \`${db}\`.\`${tableName}\` FORMAT JSON;`);
    const totalCount = parseInt(countRes?.data?.[0]?.total || '0', 10);

    const queryResult = await this.executeQuery(sql);
    queryResult.totalCount = totalCount;
    return queryResult;
  }
}
