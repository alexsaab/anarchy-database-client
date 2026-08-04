import { Client } from '@elastic/elasticsearch';
import { BaseDriver } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';

export class ElasticsearchDriver extends BaseDriver {
  private client: Client | null = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config, password);
  }

  async connect(): Promise<void> {
    if (this.client) {
      await this.disconnect();
    }
    const protocol = this.config.ssl ? 'https' : 'http';
    const host = this.config.host || 'localhost';
    const port = this.config.port || 9200;
    const node = `${protocol}://${host}:${port}`;

    const headers: Record<string, string> = {};
    if (this.config.user && this.password) {
      const basicAuth = Buffer.from(`${this.config.user}:${this.password}`).toString('base64');
      headers['authorization'] = `Basic ${basicAuth}`;
    }

    this.client = new Client({
      node,
      headers,
      auth:
        this.config.user && this.password
          ? { username: this.config.user, password: this.password }
          : undefined,
      tls: this.config.ssl ? { rejectUnauthorized: false } : undefined,
    });
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
      try {
        await this.client?.ping();
      } catch (e) {
        await this.client?.info();
      }
      await this.disconnect();
      return { success: true, message: 'Successfully connected to Elasticsearch via HTTP Basic Auth!' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    }
  }

  async getDatabases(): Promise<string[]> {
    return ['cluster'];
  }

  async getTables(): Promise<TableInfo[]> {
    if (!this.client) {
      await this.connect();
    }
    const catIndices = await this.client!.cat.indices({ format: 'json' });
    const indices = Array.isArray(catIndices) ? catIndices : [];
    return indices
      .filter((idx: any) => !idx.index.startsWith('.'))
      .map((idx: any) => ({
        name: idx.index,
        type: 'table',
      }));
  }

  async getColumns(indexName: string): Promise<ColumnInfo[]> {
    if (!this.client) {
      await this.connect();
    }
    try {
      const mapping = await this.client!.indices.getMapping({ index: indexName });
      const properties = (mapping as any)[indexName]?.mappings?.properties || {};
      return Object.keys(properties).map((prop) => ({
        name: prop,
        type: properties[prop].type || 'object',
        nullable: true,
        isPrimaryKey: prop === '_id',
      }));
    } catch (e) {
      return [{ name: '_id', type: 'keyword', nullable: false, isPrimaryKey: true }];
    }
  }

  async executeQuery(queryJson: string): Promise<QueryResult> {
    if (!this.client) {
      await this.connect();
    }
    const startTime = Date.now();
    const body = queryJson.trim() ? JSON.parse(queryJson) : { query: { match_all: {} } };

    const searchRes = await this.client!.search({
      index: this.config.database || '_all',
      body,
    });
    const costTimeMs = Date.now() - startTime;

    const hits = searchRes.hits.hits.map((h: any) => ({
      _id: h._id,
      _index: h._index,
      ...h._source,
    }));

    const fields: ColumnInfo[] =
      hits.length > 0 ? Object.keys(hits[0]).map((k) => ({ name: k, type: 'unknown', nullable: true })) : [];

    return {
      rows: hits,
      fields,
      totalCount: typeof searchRes.hits.total === 'number' ? searchRes.hits.total : (searchRes.hits.total as any)?.value || 0,
      costTimeMs,
    };
  }

  async getTableData(indexName: string, params: PageParams): Promise<QueryResult> {
    if (!this.client) {
      await this.connect();
    }
    const startTime = Date.now();
    const from = (params.page - 1) * params.pageSize;

    const searchRes = await this.client!.search({
      index: indexName,
      from,
      size: params.pageSize,
    });
    const costTimeMs = Date.now() - startTime;

    const hits = searchRes.hits.hits.map((h: any) => ({
      _id: h._id,
      _score: h._score,
      ...h._source,
    }));

    const fields: ColumnInfo[] =
      hits.length > 0 ? Object.keys(hits[0]).map((k) => ({ name: k, type: typeof hits[0][k], nullable: true })) : [];

    const totalCount =
      typeof searchRes.hits.total === 'number' ? searchRes.hits.total : (searchRes.hits.total as any)?.value || 0;

    return {
      rows: hits,
      fields,
      totalCount,
      costTimeMs,
    };
  }
}
