import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';

export interface ForeignKeyInfo {
  constraintName: string;
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface RoutineInfo {
  name: string;
  type: 'FUNCTION' | 'PROCEDURE';
  comment?: string;
}

export interface TriggerInfo {
  name: string;
  table: string;
  event?: string;
  timing?: string;
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
  abstract getTables(databaseName?: string): Promise<TableInfo[]>;
  abstract getColumns(tableName: string, databaseName?: string, schemaName?: string): Promise<ColumnInfo[]>;
  abstract getForeignKeys(tableName: string, databaseName?: string, schemaName?: string): Promise<ForeignKeyInfo[]>;

  async getSchemas(databaseName?: string): Promise<string[]> {
    return ['public'];
  }

  async getViews(databaseName?: string, schemaName?: string): Promise<TableInfo[]> {
    return [];
  }

  async getFunctions(databaseName?: string, schemaName?: string): Promise<RoutineInfo[]> {
    return [];
  }

  async getProcedures(databaseName?: string, schemaName?: string): Promise<RoutineInfo[]> {
    return [];
  }

  async getTriggers(databaseName?: string, schemaName?: string): Promise<TriggerInfo[]> {
    return [];
  }

  async getScript(name: string, type: 'view' | 'function' | 'procedure' | 'trigger', databaseName?: string, schemaName?: string): Promise<string> {
    return `-- DDL for ${type} ${name}\n-- Not implemented for this driver`;
  }

  abstract executeQuery(sql: string): Promise<QueryResult>;
  abstract getTableData(tableName: string, params: PageParams, schemaName?: string): Promise<QueryResult>;
}
