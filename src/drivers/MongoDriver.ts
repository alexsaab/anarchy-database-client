import { MongoClient } from 'mongodb';
import { BaseDriver } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';

export class MongoDriver extends BaseDriver {
  private client: MongoClient | null = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config, password);
  }

  async connect(): Promise<void> {
    if (this.client) {
      await this.disconnect();
    }
    const host = this.config.host || 'localhost';
    const port = this.config.port || 27017;
    const auth = this.config.user && this.password ? `${this.config.user}:${encodeURIComponent(this.password)}@` : '';
    const uri = `mongodb://${auth}${host}:${port}`;

    this.client = new MongoClient(uri, { connectTimeoutMS: 5000 });
    await this.client.connect();
    this.isConnected = true;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch (e) {}
      this.client = null;
      this.isConnected = false;
    }
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      await this.connect();
      await this.client?.db().admin().ping();
      await this.disconnect();
      return { success: true, message: 'Successfully connected to MongoDB server!' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    }
  }

  async getDatabases(): Promise<string[]> {
    if (!this.client) {
      await this.connect();
    }
    const res = await this.client!.db().admin().listDatabases();
    return res.databases.map((d) => d.name);
  }

  async getTables(databaseName?: string): Promise<TableInfo[]> {
    if (!this.client) {
      await this.connect();
    }
    const db = this.client!.db(databaseName || this.config.database || 'test');
    const collections = await db.listCollections().toArray();
    return collections.map((c) => ({
      name: c.name,
      type: 'table',
    }));
  }

  async getColumns(collectionName: string, databaseName?: string): Promise<ColumnInfo[]> {
    if (!this.client) {
      await this.connect();
    }
    const db = this.client!.db(databaseName || this.config.database || 'test');
    const sampleDoc = await db.collection(collectionName).findOne();
    if (!sampleDoc) {
      return [{ name: '_id', type: 'ObjectId', nullable: false, isPrimaryKey: true }];
    }
    return Object.keys(sampleDoc).map((key) => ({
      name: key,
      type: typeof sampleDoc[key],
      nullable: true,
      isPrimaryKey: key === '_id',
    }));
  }

  async executeQuery(queryJson: string): Promise<QueryResult> {
    if (!this.client) {
      await this.connect();
    }
    const startTime = Date.now();
    const db = this.client!.db(this.config.database || 'test');
    const filter = queryJson.trim() ? JSON.parse(queryJson) : {};

    const docs = await db.collection('sample').find(filter).limit(100).toArray();
    const costTimeMs = Date.now() - startTime;

    const fields: ColumnInfo[] = docs.length > 0 ? Object.keys(docs[0]).map((k) => ({ name: k, type: 'unknown', nullable: true })) : [];

    return {
      rows: docs,
      fields,
      costTimeMs,
    };
  }

  async getTableData(collectionName: string, params: PageParams): Promise<QueryResult> {
    if (!this.client) {
      await this.connect();
    }
    const startTime = Date.now();
    const db = this.client!.db(this.config.database || 'test');
    const collection = db.collection(collectionName);

    const totalCount = await collection.countDocuments();
    const offset = (params.page - 1) * params.pageSize;

    const docs = await collection.find({}).skip(offset).limit(params.pageSize).toArray();
    const costTimeMs = Date.now() - startTime;

    const fields: ColumnInfo[] = docs.length > 0 ? Object.keys(docs[0]).map((k) => ({ name: k, type: typeof docs[0][k], nullable: true })) : [];

    return {
      rows: docs,
      fields,
      totalCount,
      costTimeMs,
    };
  }
}
