import http from 'http';
import https from 'https';
import { BaseDriver, ForeignKeyInfo } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';

export class CouchdbDriver extends BaseDriver {
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
      const res = await this.httpGet('/_up');
      if (res && res.status === 'ok') {
        return { success: true, message: 'Successfully connected to Apache CouchDB!' };
      }
      return { success: true, message: 'Connected to CouchDB!' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    }
  }

  private async httpGet(path: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const host = this.config.host || 'localhost';
      const port = this.config.port || 5984;
      const user = this.config.user || '';
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
              reject(new Error(`CouchDB error (${res.statusCode}): ${body}`));
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('CouchDB request timed out'));
      });
      req.end();
    });
  }

  private async httpPost(path: string, payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const host = this.config.host || 'localhost';
      const port = this.config.port || 5984;
      const user = this.config.user || '';
      const pass = this.password || '';

      const isSsl = !!this.config.ssl;
      const protocol = isSsl ? https : http;
      const dataStr = JSON.stringify(payload);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': String(Buffer.byteLength(dataStr)),
      };

      if (user || pass) {
        headers['Authorization'] = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
      }

      const req = protocol.request(
        {
          hostname: host,
          port: port,
          path: path,
          method: 'POST',
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
              reject(new Error(`CouchDB error (${res.statusCode}): ${body}`));
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.write(dataStr);
      req.end();
    });
  }

  async getDatabases(): Promise<string[]> {
    const res = await this.httpGet('/_all_dbs');
    if (Array.isArray(res)) {
      return res.filter((db) => !db.startsWith('_'));
    }
    return ['_users'];
  }

  async getTables(databaseName?: string): Promise<TableInfo[]> {
    const db = databaseName || this.config.database || '_users';
    return [
      { name: 'all_docs', type: 'collection' },
    ];
  }

  async getColumns(tableName: string, databaseName?: string): Promise<ColumnInfo[]> {
    return [
      { name: '_id', type: 'string', isPrimaryKey: true, nullable: false },
      { name: '_rev', type: 'string', nullable: false },
      { name: 'document', type: 'json', nullable: true },
    ];
  }

  async getForeignKeys(tableName: string, databaseName?: string): Promise<ForeignKeyInfo[]> {
    return [];
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    const startTime = Date.now();
    const db = this.config.database || '_users';

    try {
      const res = await this.httpPost(`/${db}/_find`, {
        selector: {},
        limit: 50,
      });

      const docs = res.docs || [];
      const costTimeMs = Date.now() - startTime;

      const fields: ColumnInfo[] = [
        { name: '_id', type: 'string', isPrimaryKey: true, nullable: false },
        { name: '_rev', type: 'string', nullable: false },
        { name: 'document', type: 'json', nullable: true },
      ];

      const rows = docs.map((doc: any) => ({
        _id: doc._id,
        _rev: doc._rev,
        document: JSON.stringify(doc),
      }));

      return {
        rows,
        fields,
        totalCount: docs.length,
        affectedRows: docs.length,
        costTimeMs,
      };
    } catch (e) {
      const res = await this.httpGet(`/${db}/_all_docs?include_docs=true&limit=50`);
      const docs = (res.rows || []).map((r: any) => r.doc || { _id: r.id, _rev: r.value?.rev });
      const costTimeMs = Date.now() - startTime;

      const fields: ColumnInfo[] = [
        { name: '_id', type: 'string', isPrimaryKey: true, nullable: false },
        { name: '_rev', type: 'string', nullable: false },
        { name: 'document', type: 'json', nullable: true },
      ];

      const rows = docs.map((doc: any) => ({
        _id: doc._id,
        _rev: doc._rev,
        document: JSON.stringify(doc),
      }));

      return {
        rows,
        fields,
        totalCount: docs.length,
        affectedRows: docs.length,
        costTimeMs,
      };
    }
  }

  async getTableData(tableName: string, params: PageParams, schemaName?: string): Promise<QueryResult> {
    return this.executeQuery('');
  }
}
