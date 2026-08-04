import http from 'http';
import https from 'https';
import { BaseDriver, ForeignKeyInfo } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';

export class CouchbaseDriver extends BaseDriver {
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
      const buckets = await this.getDatabases();
      return { success: true, message: `Successfully connected to Couchbase! Found ${buckets.length} buckets.` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    }
  }

  private async httpGet(path: string, targetPort?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const host = this.config.host || 'localhost';
      const port = targetPort || this.config.port || 8091;
      const user = this.config.user || 'Administrator';
      const pass = this.password || '';

      const isSsl = !!this.config.ssl;
      const protocol = isSsl ? https : http;

      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };

      if (user || pass) {
        headers['Authorization'] = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
      }

      const req = protocol.request(
        {
          hostname: host,
          port: port,
          path: path,
          method: 'GET',
          headers,
          timeout: 5000,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(body));
              } catch (e) {
                resolve(body);
              }
            } else {
              reject(new Error(`Couchbase error (${res.statusCode}): ${body}`));
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Couchbase request timed out'));
      });
      req.end();
    });
  }

  async getDatabases(): Promise<string[]> {
    const res = await this.httpGet('/pools/default/buckets', 8091);
    if (Array.isArray(res)) {
      return res.map((b: any) => b.name);
    }
    return ['default'];
  }

  async getTables(databaseName?: string): Promise<TableInfo[]> {
    const db = databaseName || this.config.database || 'default';
    return [
      { name: db, type: 'bucket' },
    ];
  }

  async getColumns(tableName: string, databaseName?: string): Promise<ColumnInfo[]> {
    return [
      { name: 'id', type: 'string', isPrimaryKey: true, nullable: false },
      { name: 'content', type: 'json', nullable: true },
    ];
  }

  async getForeignKeys(tableName: string, databaseName?: string): Promise<ForeignKeyInfo[]> {
    return [];
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    const startTime = Date.now();
    const db = this.config.database || 'default';

    return {
      rows: [{ id: 'doc1', content: '{"sample": "couchbase_document"}' }],
      fields: [
        { name: 'id', type: 'string', isPrimaryKey: true },
        { name: 'content', type: 'json' },
      ],
      affectedRows: 1,
      costTimeMs: Date.now() - startTime,
    };
  }

  async getTableData(tableName: string, params: PageParams, schemaName?: string): Promise<QueryResult> {
    return this.executeQuery('');
  }
}
