import Redis from 'ioredis';
import { BaseDriver } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';

export class RedisDriver extends BaseDriver {
  private client: Redis | null = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config, password);
  }

  async connect(): Promise<void> {
    if (this.client) {
      await this.disconnect();
    }
    this.client = new Redis({
      host: this.config.host || '127.0.0.1',
      port: this.config.port || 6379,
      password: this.password || undefined,
      db: parseInt(this.config.database || '0', 10),
      connectTimeout: 5000,
      lazyConnect: true,
    });
    await this.client.connect();
    this.isConnected = true;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch (e) {}
      this.client = null;
      this.isConnected = false;
    }
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      await this.connect();
      await this.client?.ping();
      await this.disconnect();
      return { success: true, message: 'Successfully connected to Redis instance!' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    }
  }

  async getDatabases(): Promise<string[]> {
    return Array.from({ length: 16 }, (_, i) => `db${i}`);
  }

  async getTables(): Promise<TableInfo[]> {
    if (!this.client) {
      await this.connect();
    }
    const keys = await this.client!.keys('*');
    return keys.slice(0, 100).map((k) => ({
      name: k,
      type: 'table',
    }));
  }

  async getColumns(keyName: string): Promise<ColumnInfo[]> {
    return [
      { name: 'key', type: 'string', nullable: false, isPrimaryKey: true },
      { name: 'type', type: 'string', nullable: false },
      { name: 'value', type: 'string', nullable: true },
      { name: 'ttl', type: 'number', nullable: true },
    ];
  }

  async executeQuery(commandString: string): Promise<QueryResult> {
    if (!this.client) {
      await this.connect();
    }
    const startTime = Date.now();
    const parts = commandString.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    const rawResult = await (this.client as any)[cmd](...args);
    const costTimeMs = Date.now() - startTime;

    const rows = Array.isArray(rawResult)
      ? rawResult.map((v, i) => ({ index: i, value: typeof v === 'object' ? JSON.stringify(v) : v }))
      : [{ result: typeof rawResult === 'object' ? JSON.stringify(rawResult) : rawResult }];

    const fields: ColumnInfo[] = rows.length > 0 ? Object.keys(rows[0]).map((k) => ({ name: k, type: 'string', nullable: true })) : [];

    return {
      rows,
      fields,
      costTimeMs,
    };
  }

  async getTableData(keyName: string, params: PageParams): Promise<QueryResult> {
    if (!this.client) {
      await this.connect();
    }
    const startTime = Date.now();
    const type = await this.client!.type(keyName);
    const ttl = await this.client!.ttl(keyName);
    let val: any = '';

    if (type === 'string') {
      val = await this.client!.get(keyName);
    } else if (type === 'hash') {
      val = JSON.stringify(await this.client!.hgetall(keyName));
    } else if (type === 'list') {
      val = JSON.stringify(await this.client!.lrange(keyName, 0, 50));
    } else if (type === 'set') {
      val = JSON.stringify(await this.client!.smembers(keyName));
    }

    return {
      rows: [{ key: keyName, type, value: val, ttl }],
      fields: [
        { name: 'key', type: 'string', nullable: false, isPrimaryKey: true },
        { name: 'type', type: 'string', nullable: false },
        { name: 'value', type: 'string', nullable: true },
        { name: 'ttl', type: 'number', nullable: true },
      ],
      totalCount: 1,
      costTimeMs: Date.now() - startTime,
    };
  }
}
