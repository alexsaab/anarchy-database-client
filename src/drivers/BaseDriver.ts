import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, QueryResult, TableInfo, PageParams } from '../model/QueryTypes.js';

export interface ForeignKeyInfo {
  columnName: string;
  foreignTableName: string;
  foreignColumnName: string;
}

export abstract class BaseDriver {
  protected config: ConnectionConfig;
  protected password?: string;
  protected isConnected: boolean = false;

  constructor(config: ConnectionConfig, password?: string) {
    this.config = config;
    this.password = password;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract testConnection(): Promise<{ success: boolean; message?: string }>;

  abstract getDatabases(): Promise<string[]>;
  async getSchemas(databaseName?: string): Promise<string[]> {
    return ['public'];
  }
  abstract getTables(databaseName?: string, schemaName?: string): Promise<TableInfo[]>;
  abstract getColumns(tableName: string, databaseName?: string, schemaName?: string): Promise<ColumnInfo[]>;

  async getForeignKeys(tableName: string, databaseName?: string, schemaName?: string): Promise<ForeignKeyInfo[]> {
    return [];
  }
  
  abstract executeQuery(sql: string): Promise<QueryResult>;
  abstract getTableData(tableName: string, params: PageParams, schemaName?: string): Promise<QueryResult>;
  
  public getIsConnected(): boolean {
    return this.isConnected;
  }
}
