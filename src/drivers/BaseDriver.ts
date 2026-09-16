import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { BoundStatement, ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';
import { ConnectionState } from './ConnectionState.js';

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

  /** Guards connect() so parallel callers share one handshake instead of racing. */
  private connecting: Promise<void> | null = null;

  constructor(config: ConnectionConfig, password?: string) {
    this.config = config;
    this.password = password;
  }

  public get connectionId(): string {
    return this.config.id;
  }

  protected markConnected(): void {
    ConnectionState.getInstance().markConnected(this.connectionId);
  }

  protected markLost(err: any): void {
    ConnectionState.getInstance().markLost(this.connectionId, String(err?.message || err || 'Connection lost'));
  }

  /**
   * Runs connect() at most once at a time. The tree expands many nodes in
   * parallel, and without this every one of them would tear down and rebuild the
   * shared client underneath the others -- which is how a query ends up calling
   * .query() on a handle another caller just set to null.
   */
  protected async connectOnce(doConnect: () => Promise<void>): Promise<void> {
    if (this.connecting) {
      return this.connecting;
    }
    this.connecting = (async () => {
      try {
        await doConnect();
        this.markConnected();
      } catch (err) {
        this.markLost(err);
        throw err;
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  /**
   * Runs an operation, and on a genuine connection failure drops the dead
   * session and tries once more on a fresh one.
   */
  protected async withReconnect<T>(run: () => Promise<T>): Promise<T> {
    try {
      const result = await run();
      this.markConnected();
      return result;
    } catch (err: any) {
      if (!ConnectionState.isConnectionError(err)) {
        throw err;
      }
      this.markLost(err);
      await this.disconnect().catch(() => {});
      try {
        const result = await run();
        this.markConnected();
        return result;
      } catch (retryErr: any) {
        if (ConnectionState.isConnectionError(retryErr)) {
          this.markLost(retryErr);
        }
        throw retryErr;
      }
    }
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract testConnection(): Promise<{ success: boolean; message?: string }>;

  abstract getDatabases(): Promise<string[]>;
  abstract getTables(databaseName?: string, schemaName?: string): Promise<TableInfo[]>;
  abstract getColumns(tableName: string, databaseName?: string, schemaName?: string): Promise<ColumnInfo[]>;
  async getForeignKeys(tableName: string, databaseName?: string, schemaName?: string): Promise<ForeignKeyInfo[]> {
    return [];
  }

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

  abstract executeQuery(sql: string, queryId?: number): Promise<QueryResult>;

  /** True when a running statement can be cancelled server-side. */
  public get supportsCancellation(): boolean {
    return false;
  }

  /** Allocates an id used to track and later cancel one statement. */
  public beginQueryId(): number {
    return 0;
  }

  public async cancelQuery(queryId: number): Promise<boolean> {
    return false;
  }
  abstract getTableData(tableName: string, params: PageParams, schemaName?: string): Promise<QueryResult>;

  /**
   * True when the grid may generate SQL INSERT/UPDATE/DELETE for this store.
   * Document stores and key-value stores override this: generating SQL for them
   * produces statements the server cannot parse. Such a driver can still accept
   * edits by overriding the row-write methods below with its native API.
   */
  public get supportsSqlWrites(): boolean {
    return true;
  }

  /** True when the grid may offer editing at all, by whatever mechanism. */
  public get supportsRowWrites(): boolean {
    return this.supportsSqlWrites;
  }

  /**
   * Native row writes for stores that are not SQL. SQL drivers leave these
   * alone; the grid builds bound statements for them instead.
   *
   * Each returns the number of rows affected.
   */
  public async updateRowNative(
    tableName: string,
    rowKey: Record<string, any>,
    columnName: string,
    value: any,
    schemaName?: string
  ): Promise<number> {
    throw new Error(`${this.config.type} does not support row updates.`);
  }

  public async deleteRowNative(
    tableName: string,
    rowKey: Record<string, any>,
    schemaName?: string
  ): Promise<number> {
    throw new Error(`${this.config.type} does not support row deletion.`);
  }

  public async insertRowNative(
    tableName: string,
    rowData: Record<string, any>,
    schemaName?: string
  ): Promise<number> {
    throw new Error(`${this.config.type} does not support row insertion.`);
  }

  /**
   * Placeholder for the nth (1-based) bound parameter in this dialect.
   * PostgreSQL numbers them; most others use a positional question mark.
   */
  public placeholder(index: number): string {
    return '?';
  }

  /**
   * Runs a statement with bound parameters. Values are never interpolated into
   * SQL, so quoting, numeric precision and NULL semantics are the driver's job
   * rather than a string-escaping guess.
   *
   * Drivers without a binding API must override this or leave it unsupported.
   */
  public async executeParameterized(sql: string, params: any[], queryId?: number): Promise<QueryResult> {
    throw new Error(`${this.config.type} does not support parameterized statements.`);
  }

  public get supportsParameterizedQueries(): boolean {
    return false;
  }

  /**
   * Executes multiple statements atomically within a transaction where supported.
   * If any statement fails, the entire batch is rolled back.
   */
  public async executeTransaction(statements: BoundStatement[]): Promise<void> {
    if (statements.length === 0) return;
    for (const stmt of statements) {
      if (this.supportsParameterizedQueries) {
        await this.executeParameterized(stmt.sql, stmt.params);
      } else {
        await this.executeQuery(stmt.sql);
      }
    }
  }
}
