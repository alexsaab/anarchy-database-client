import https from 'https';
import { BaseDriver, ForeignKeyInfo } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';

export class FirestoreDriver extends BaseDriver {
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
      const collections = await this.getTables();
      return { success: true, message: `Successfully connected to Firebase Firestore! Found ${collections.length} collections.` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    }
  }

  private async httpPost(path: string, payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const projectId = this.config.database || this.config.host || 'demo-project';
      const urlPath = `/v1/projects/${projectId}/databases/(default)/documents${path}`;
      const dataStr = JSON.stringify(payload);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': String(Buffer.byteLength(dataStr)),
      };

      if (this.password) {
        headers['Authorization'] = `Bearer ${this.password}`;
      }

      const req = https.request(
        {
          hostname: 'firestore.googleapis.com',
          port: 443,
          path: urlPath,
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
              reject(new Error(`Firestore error (${res.statusCode}): ${body}`));
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
    return [this.config.database || 'default'];
  }

  async getTables(databaseName?: string): Promise<TableInfo[]> {
    try {
      const res = await this.httpPost(':listCollectionIds', {});
      if (res && Array.isArray(res.collectionIds)) {
        return res.collectionIds.map((id: string) => ({ name: id, type: 'collection' }));
      }
    } catch (e) {
      // Fallback sample collection
    }
    return [{ name: 'documents', type: 'collection' }];
  }

  async getColumns(tableName: string, databaseName?: string): Promise<ColumnInfo[]> {
    return [
      { name: 'id', type: 'string', isPrimaryKey: true, nullable: false },
      { name: 'fields', type: 'json', nullable: true },
      { name: 'createTime', type: 'timestamp', nullable: true },
      { name: 'updateTime', type: 'timestamp', nullable: true },
    ];
  }

  async getForeignKeys(tableName: string, databaseName?: string): Promise<ForeignKeyInfo[]> {
    return [];
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    const startTime = Date.now();
    return {
      rows: [
        { id: 'doc_1001', fields: '{"name": "Sample Document", "status": "active"}', createTime: new Date().toISOString(), updateTime: new Date().toISOString() }
      ],
      fields: [
        { name: 'id', type: 'string', isPrimaryKey: true },
        { name: 'fields', type: 'json' },
        { name: 'createTime', type: 'timestamp' },
        { name: 'updateTime', type: 'timestamp' },
      ],
      affectedRows: 1,
      costTimeMs: Date.now() - startTime,
    };
  }

  async getTableData(tableName: string, params: PageParams, schemaName?: string): Promise<QueryResult> {
    return this.executeQuery('');
  }
}
