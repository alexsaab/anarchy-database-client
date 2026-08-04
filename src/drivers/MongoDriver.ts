import { BaseDriver, ForeignKeyInfo } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';

export class MongoDriver extends BaseDriver {
  private client: any = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config, password);
  }

  async connect(): Promise<void> {
    if (!this.isConnected) {
      let mongodb: any;
      try {
        mongodb = require('mongodb');
      } catch (e) {
        throw new Error('mongodb driver module is not available in this environment.');
      }

      const host = this.config.host || 'localhost';
      const port = this.config.port || 27017;
      const user = this.config.user ? `${this.config.user}:${this.password || ''}@` : '';
      const uri = `mongodb://${user}${host}:${port}`;

      this.client = new mongodb.MongoClient(uri);
      await this.client.connect();
      this.isConnected = true;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.isConnected = false;
    }
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      await this.connect();
      await this.client.db().admin().ping();
      return { success: true, message: 'Successfully connected to MongoDB server!' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    } finally {
      await this.disconnect();
    }
  }

  async getDatabases(): Promise<string[]> {
    await this.connect();
    const adminDb = this.client.db().admin();
    const res = await adminDb.listDatabases();
    return res.databases.map((db: any) => db.name).filter((name: string) => !['admin', 'local', 'config'].includes(name));
  }

  async getTables(databaseName?: string): Promise<TableInfo[]> {
    await this.connect();
    const dbName = databaseName || this.config.database || 'test';
    const db = this.client.db(dbName);
    const collections = await db.listCollections().toArray();
    return collections.map((col: any) => ({
      name: col.name,
      type: 'collection',
    }));
  }

  async getColumns(tableName: string, databaseName?: string): Promise<ColumnInfo[]> {
    await this.connect();
    const dbName = databaseName || this.config.database || 'test';
    const db = this.client.db(dbName);
    const sample = await db.collection(tableName).findOne();

    if (!sample) {
      return [{ name: '_id', type: 'ObjectId', isPrimaryKey: true, nullable: false }];
    }

    return Object.keys(sample).map((key) => ({
      name: key,
      type: typeof sample[key] === 'object' ? 'Object/JSON' : typeof sample[key],
      isPrimaryKey: key === '_id',
      nullable: true,
    }));
  }

  async getForeignKeys(tableName: string, databaseName?: string): Promise<ForeignKeyInfo[]> {
    return [];
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    const startTime = Date.now();
    await this.connect();
    const dbName = this.config.database || 'test';
    const db = this.client.db(dbName);

    try {
      const collections = await db.listCollections().toArray();
      const colName = collections[0]?.name || 'test';
      const docs = await db.collection(colName).find().limit(50).toArray();
      const costTimeMs = Date.now() - startTime;

      const sample = docs[0] || {};
      const fields: ColumnInfo[] = Object.keys(sample).map((k) => ({
        name: k,
        type: typeof sample[k],
        nullable: true,
      }));

      return {
        rows: docs,
        fields,
        affectedRows: docs.length,
        costTimeMs,
      };
    } catch (e: any) {
      return {
        rows: [],
        fields: [],
        affectedRows: 0,
        costTimeMs: Date.now() - startTime,
      };
    }
  }

  async getTableData(tableName: string, params: PageParams, schemaName?: string): Promise<QueryResult> {
    const startTime = Date.now();
    await this.connect();
    const dbName = this.config.database || 'test';
    const db = this.client.db(dbName);
    const skip = (params.page - 1) * params.pageSize;

    const totalCount = await db.collection(tableName).countDocuments();
    const docs = await db.collection(tableName).find().skip(skip).limit(params.pageSize).toArray();
    const costTimeMs = Date.now() - startTime;

    const sample = docs[0] || {};
    const fields: ColumnInfo[] = Object.keys(sample).map((k) => ({
      name: k,
      type: typeof sample[k],
      nullable: true,
    }));

    return {
      rows: docs,
      fields,
      totalCount,
      affectedRows: docs.length,
      costTimeMs,
    };
  }
}
