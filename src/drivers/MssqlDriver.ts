import { BaseDriver, ForeignKeyInfo, RoutineInfo, TriggerInfo } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { BoundStatement, ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';
import { buildPagedQuery, finishPage, renumber } from '../sql/PagedQuery.js';

/** Microsoft SQL Server / Azure SQL. */
export class MssqlDriver extends BaseDriver {
  private pool: any = null;
  private running: Map<number, any> = new Map();
  private nextQueryId = 1;

  constructor(config: ConnectionConfig, password?: string) {
    super(config, password);
  }

  private static lib(): any {
    try {
      return require('mssql');
    } catch (e: any) {
      throw new Error(`The "mssql" module could not be loaded: ${e?.message || e}`);
    }
  }

  async connect(): Promise<void> {
    if (this.isConnected && this.pool) {
      return;
    }

    await this.connectOnce(async () => {
      if (this.isConnected && this.pool) {
        return;
      }
      await this.disconnect().catch(() => {});

      const sql = MssqlDriver.lib();
      const pool = new sql.ConnectionPool({
        server: this.config.host || 'localhost',
        port: this.config.port || 1433,
        user: this.config.user || 'sa',
        password: this.password || '',
        database: this.config.database || undefined,
        pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
        options: {
          // Developer and on-premise instances usually present a self-signed
          // certificate; encryption stays on.
          encrypt: true,
          trustServerCertificate: true,
          enableArithAbort: true,
        },
        connectionTimeout: 15000,
        requestTimeout: 0,
      });

      pool.on('error', (err: any) => {
        if (this.pool === pool) {
          this.markLost(err);
        }
      });

      await pool.connect();
      this.pool = pool;
      this.isConnected = true;
    });
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    this.running.clear();
    if (this.pool) {
      const pool = this.pool;
      this.pool = null;
      try {
        await pool.close();
      } catch (e) {}
    }
  }

  private async acquirePool(): Promise<any> {
    await this.connect();
    if (!this.pool) {
      throw Object.assign(new Error('Connection to the database was lost.'), { code: 'CONNECTION_CLOSED' });
    }
    return this.pool;
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      await this.connect();
      const res = await this.executeQuery('SELECT @@VERSION AS version');
      const version = String(res.rows[0]?.version || '').split('\n')[0];
      return { success: true, message: `Connected to ${version || 'SQL Server'}.` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    } finally {
      await this.disconnect();
    }
  }

  public get supportsCancellation(): boolean {
    return true;
  }

  public beginQueryId(): number {
    return this.nextQueryId++;
  }

  public async cancelQuery(queryId: number): Promise<boolean> {
    const request = this.running.get(queryId);
    if (!request) {
      return false;
    }
    try {
      request.cancel();
      return true;
    } catch (e) {
      return false;
    }
  }

  private toResult(result: any, startTime: number): QueryResult {
    const recordset = result?.recordset || [];
    const columns = result?.recordset?.columns || {};
    const fields: ColumnInfo[] = Object.keys(columns).map((name) => ({
      name,
      type: String(columns[name]?.type?.name || 'VARCHAR').toUpperCase(),
      nullable: columns[name]?.nullable !== false,
    }));

    return {
      rows: recordset,
      fields:
        fields.length > 0
          ? fields
          : Object.keys(recordset[0] || {}).map((name) => ({ name, type: 'VARCHAR', nullable: true })),
      affectedRows: Array.isArray(result?.rowsAffected)
        ? result.rowsAffected.reduce((a: number, b: number) => a + b, 0)
        : recordset.length,
      costTimeMs: Date.now() - startTime,
    };
  }

  async executeQuery(sql: string, queryId?: number): Promise<QueryResult> {
    return this.withReconnect(async () => {
      const pool = await this.acquirePool();
      const startTime = Date.now();
      const request = pool.request();
      if (queryId != null) {
        this.running.set(queryId, request);
      }
      try {
        return this.toResult(await request.query(sql), startTime);
      } finally {
        if (queryId != null) {
          this.running.delete(queryId);
        }
      }
    });
  }

  public get supportsParameterizedQueries(): boolean {
    return true;
  }

  public placeholder(index: number): string {
    return `@p${index}`;
  }

  public async executeParameterized(sql: string, params: any[], queryId?: number): Promise<QueryResult> {
    return this.withReconnect(async () => {
      const pool = await this.acquirePool();
      const startTime = Date.now();
      const request = pool.request();
      params.forEach((value, i) => request.input(`p${i + 1}`, value));
      if (queryId != null) {
        this.running.set(queryId, request);
      }
      try {
        return this.toResult(await request.query(sql), startTime);
      } finally {
        if (queryId != null) {
          this.running.delete(queryId);
        }
      }
    });
  }

  public override async executeTransaction(statements: BoundStatement[]): Promise<void> {
    if (statements.length === 0) return;
    return this.withReconnect(async () => {
      const pool = await this.acquirePool();
      const transaction = pool.transaction();
      await transaction.begin();
      try {
        for (const stmt of statements) {
          const request = transaction.request();
          if (stmt.params && stmt.params.length > 0) {
            stmt.params.forEach((value, i) => request.input(`p${i + 1}`, value));
          }
          await request.query(stmt.sql);
        }
        await transaction.commit();
      } catch (err) {
        await transaction.rollback().catch(() => {});
        throw err;
      }
    });
  }

  async getDatabases(): Promise<string[]> {
    const res = await this.executeQuery(
      "SELECT name FROM sys.databases WHERE name NOT IN ('master','tempdb','model','msdb') ORDER BY name"
    );
    return res.rows.map((r: any) => r.name);
  }

  async getSchemas(): Promise<string[]> {
    const res = await this.executeQuery(
      "SELECT name FROM sys.schemas WHERE name NOT IN ('sys','INFORMATION_SCHEMA') ORDER BY name"
    );
    return res.rows.map((r: any) => r.name);
  }

  async getTables(databaseName?: string, schemaName: string = 'dbo'): Promise<TableInfo[]> {
    const res = await this.executeParameterized(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA = @p1 ORDER BY TABLE_NAME`,
      [schemaName]
    );
    return res.rows.map((r: any) => ({ name: r.TABLE_NAME, type: 'table', schema: schemaName }));
  }

  async getViews(databaseName?: string, schemaName: string = 'dbo'): Promise<TableInfo[]> {
    const res = await this.executeParameterized(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA = @p1 ORDER BY TABLE_NAME`,
      [schemaName]
    );
    return res.rows.map((r: any) => ({ name: r.TABLE_NAME, type: 'view', schema: schemaName }));
  }

  async getColumns(tableName: string, databaseName?: string, schemaName: string = 'dbo'): Promise<ColumnInfo[]> {
    const res = await this.executeParameterized(
      `SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT
       FROM INFORMATION_SCHEMA.COLUMNS c
       WHERE c.TABLE_SCHEMA = @p1 AND c.TABLE_NAME = @p2
       ORDER BY c.ORDINAL_POSITION`,
      [schemaName, tableName]
    );

    const pk = await this.executeParameterized(
      `SELECT kcu.COLUMN_NAME
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
       JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
         ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
       WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = @p1 AND tc.TABLE_NAME = @p2`,
      [schemaName, tableName]
    );
    const primaryKeys = new Set(pk.rows.map((r: any) => r.COLUMN_NAME));

    return res.rows.map((r: any) => ({
      name: r.COLUMN_NAME,
      type: String(r.DATA_TYPE).toUpperCase(),
      nullable: r.IS_NULLABLE === 'YES',
      isPrimaryKey: primaryKeys.has(r.COLUMN_NAME),
      defaultValue: r.COLUMN_DEFAULT || undefined,
    }));
  }

  async getForeignKeys(tableName: string, databaseName?: string, schemaName: string = 'dbo'): Promise<ForeignKeyInfo[]> {
    const res = await this.executeParameterized(
      `SELECT fk.name AS constraint_name,
              pc.name AS column_name,
              rt.name AS referenced_table,
              rc.name AS referenced_column
       FROM sys.foreign_keys fk
       JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
       JOIN sys.tables pt ON pt.object_id = fk.parent_object_id
       JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
       JOIN sys.columns pc ON pc.object_id = pt.object_id AND pc.column_id = fkc.parent_column_id
       JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
       JOIN sys.columns rc ON rc.object_id = rt.object_id AND rc.column_id = fkc.referenced_column_id
       WHERE pt.name = @p1 AND ps.name = @p2`,
      [tableName, schemaName]
    );
    return res.rows.map((r: any) => ({
      constraintName: r.constraint_name,
      columnName: r.column_name,
      referencedTable: r.referenced_table,
      referencedColumn: r.referenced_column,
    }));
  }

  async getProcedures(databaseName?: string, schemaName: string = 'dbo'): Promise<RoutineInfo[]> {
    const res = await this.executeParameterized(
      `SELECT ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES
       WHERE ROUTINE_TYPE = 'PROCEDURE' AND ROUTINE_SCHEMA = @p1 ORDER BY ROUTINE_NAME`,
      [schemaName]
    );
    return res.rows.map((r: any) => ({ name: r.ROUTINE_NAME, type: 'PROCEDURE' as const }));
  }

  async getFunctions(databaseName?: string, schemaName: string = 'dbo'): Promise<RoutineInfo[]> {
    const res = await this.executeParameterized(
      `SELECT ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES
       WHERE ROUTINE_TYPE = 'FUNCTION' AND ROUTINE_SCHEMA = @p1 ORDER BY ROUTINE_NAME`,
      [schemaName]
    );
    return res.rows.map((r: any) => ({ name: r.ROUTINE_NAME, type: 'FUNCTION' as const }));
  }

  async getTriggers(databaseName?: string, schemaName: string = 'dbo'): Promise<TriggerInfo[]> {
    const res = await this.executeQuery(
      `SELECT tr.name AS trigger_name, t.name AS table_name FROM sys.triggers tr
       JOIN sys.tables t ON t.object_id = tr.parent_id ORDER BY tr.name`
    );
    return res.rows.map((r: any) => ({ name: r.trigger_name, table: r.table_name }));
  }

  async getTableData(tableName: string, params: PageParams, schemaName: string = 'dbo'): Promise<QueryResult> {
    const tableRef = `[${schemaName.replace(/]/g, ']]')}].[${tableName.replace(/]/g, ']]')}]`;
    const columns = await this.getColumns(tableName, this.config.database, schemaName);
    const query = buildPagedQuery({
      dbType: 'SQLServer',
      tableRef,
      params,
      columns,
      limitStyle: 'offset-fetch',
    });

    const countSql = renumber(query.countSql, (i) => `@p${i}`);
    const countRes = query.countParams.length
      ? await this.executeParameterized(countSql, query.countParams)
      : await this.executeQuery(countSql);
    const totalCount = parseInt(countRes.rows[0]?.total ?? '0', 10);

    const rowsSql = renumber(query.rowsSql, (i) => `@p${i}`);
    const result = query.rowsParams.length
      ? await this.executeParameterized(rowsSql, query.rowsParams)
      : await this.executeQuery(rowsSql);
    result.totalCount = totalCount;
    if (columns && columns.length > 0) {
      result.fields = columns;
    }
    return finishPage(result, query.reversed);
  }
}
