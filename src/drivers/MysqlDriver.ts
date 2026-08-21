import mysql from 'mysql2/promise';
import { BaseDriver, ForeignKeyInfo, RoutineInfo, TriggerInfo } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';
import { buildPagedQuery, finishPage, renumber } from '../sql/PagedQuery.js';

export class MysqlDriver extends BaseDriver {
  /**
   * A pool rather than one connection: tree expansion, the grid and the
   * status-bar ping run concurrently, and a single connection serialises them.
   */
  private pool: mysql.Pool | null = null;

  /** Connection ids of statements in flight, so they can be killed. */
  private running: Map<number, number> = new Map();
  private nextQueryId = 1;

  constructor(config: ConnectionConfig, password?: string) {
    super(config, password);
  }

  private connectionOptions(): mysql.ConnectionOptions {
    return {
      host: this.config.host || 'localhost',
      port: this.config.port || 3306,
      user: this.config.user || 'root',
      password: this.password || '',
      database: this.config.database || undefined,
      multipleStatements: true,
    };
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

      const pool = mysql.createPool({
        ...this.connectionOptions(),
        waitForConnections: true,
        connectionLimit: 4,
        maxIdle: 2,
        idleTimeout: 30000,
        enableKeepAlive: true,
      });

      // Fail fast on bad credentials or an unreachable host.
      const probe = await pool.getConnection();
      probe.release();

      this.pool = pool;
      this.isConnected = true;
    });
  }

  private async acquirePool(): Promise<mysql.Pool> {
    await this.connect();
    const pool = this.pool;
    if (!pool) {
      throw Object.assign(new Error('Connection to the database was lost.'), { code: 'PROTOCOL_CONNECTION_LOST' });
    }
    return pool;
  }

  /**
   * Runs work on one pooled connection, remembering its connection id so the
   * statement can be killed while it runs.
   */
  private async runOnConnection<T>(fn: (conn: mysql.PoolConnection) => Promise<T>, queryId?: number): Promise<T> {
    const pool = await this.acquirePool();
    const conn = await pool.getConnection();
    try {
      if (queryId != null) {
        this.running.set(queryId, (conn as any).threadId);
      }
      return await fn(conn);
    } finally {
      if (queryId != null) {
        this.running.delete(queryId);
      }
      conn.release();
    }
  }

  public get supportsCancellation(): boolean {
    return true;
  }

  public beginQueryId(): number {
    return this.nextQueryId++;
  }

  public async cancelQuery(queryId: number): Promise<boolean> {
    const threadId = this.running.get(queryId);
    if (threadId == null) {
      return false;
    }
    // KILL QUERY needs its own connection; the pooled one is busy running the
    // statement being killed.
    let killer: mysql.Connection | null = null;
    try {
      killer = await mysql.createConnection(this.connectionOptions());
      await killer.query(`KILL QUERY ${Number(threadId)}`);
      return true;
    } catch (e) {
      return false;
    } finally {
      try {
        await killer?.end();
      } catch (e) {}
    }
  }

  private async queryWithRetry(sql: string, params?: any[], queryId?: number): Promise<any> {
    return this.withReconnect(async () =>
      this.runOnConnection(async (conn) => conn.query(sql, params), queryId)
    );
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    this.running.clear();
    if (this.pool) {
      const pool = this.pool;
      this.pool = null;
      try {
        await pool.end();
      } catch (e) {}
    }
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      await this.executeQuery('SELECT 1');
      return { success: true, message: 'Successfully connected to MySQL database!' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    } finally {
      await this.disconnect();
    }
  }

  async getDatabases(): Promise<string[]> {
    const [results] = await this.queryWithRetry('SHOW DATABASES;');
    const rows = results as any[];
    return rows
      .map((r: any) => r.Database || r.database || Object.values(r)[0])
      .filter((db: any) => db && !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(String(db)))
      .sort((a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }));
  }

  async getTables(databaseName?: string): Promise<TableInfo[]> {
    const targetDb = databaseName || this.config.database;
    if (!targetDb) return [];
    if (databaseName) this.config.database = databaseName;

    try {
      await this.queryWithRetry(`USE \`${targetDb}\`;`);
    } catch (e) {
      // Ignore USE errors
    }

    const [results] = await this.queryWithRetry(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${targetDb}' AND TABLE_TYPE IN ('BASE TABLE', 'SYSTEM VIEW', 'SYSTEM TABLE') ORDER BY TABLE_NAME;`
    );

    const rows = results as any[];
    return rows.map((r: any) => ({
      name: String(r.TABLE_NAME || r.table_name || Object.values(r)[0]),
      type: 'table',
    }));
  }

  async getViews(databaseName?: string): Promise<TableInfo[]> {
    const targetDb = databaseName || this.config.database;
    if (!targetDb) return [];
    if (databaseName) this.config.database = databaseName;

    try {
      await this.queryWithRetry(`USE \`${targetDb}\`;`);
    } catch (e) {
      // Ignore
    }

    const [results] = await this.queryWithRetry(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${targetDb}' AND TABLE_TYPE = 'VIEW' ORDER BY TABLE_NAME;`
    );

    const rows = results as any[];
    return rows.map((r: any) => ({
      name: String(r.TABLE_NAME || r.table_name || Object.values(r)[0]),
      type: 'view',
    }));
  }

  async getFunctions(databaseName?: string): Promise<RoutineInfo[]> {
    const targetDb = databaseName || this.config.database;
    if (!targetDb) return [];

    const [results] = await this.queryWithRetry(
      `SELECT ROUTINE_NAME, ROUTINE_COMMENT FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = '${targetDb}' AND ROUTINE_TYPE = 'FUNCTION' ORDER BY ROUTINE_NAME;`
    );

    const rows = results as any[];
    return rows.map((r: any) => ({
      name: String(r.ROUTINE_NAME || r.routine_name || Object.values(r)[0]),
      type: 'FUNCTION',
      comment: r.ROUTINE_COMMENT || r.routine_comment,
    }));
  }

  async getProcedures(databaseName?: string): Promise<RoutineInfo[]> {
    const targetDb = databaseName || this.config.database;
    if (!targetDb) return [];

    const [results] = await this.queryWithRetry(
      `SELECT ROUTINE_NAME, ROUTINE_COMMENT FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = '${targetDb}' AND ROUTINE_TYPE = 'PROCEDURE' ORDER BY ROUTINE_NAME;`
    );

    const rows = results as any[];
    return rows.map((r: any) => ({
      name: String(r.ROUTINE_NAME || r.routine_name || Object.values(r)[0]),
      type: 'PROCEDURE',
      comment: r.ROUTINE_COMMENT || r.routine_comment,
    }));
  }

  async getTriggers(databaseName?: string): Promise<TriggerInfo[]> {
    const targetDb = databaseName || this.config.database;
    if (!targetDb) return [];

    const [results] = await this.queryWithRetry(
      `SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = '${targetDb}' ORDER BY TRIGGER_NAME;`
    );

    const rows = results as any[];
    return rows.map((r: any) => ({
      name: String(r.TRIGGER_NAME || r.trigger_name || Object.values(r)[0]),
      table: r.EVENT_OBJECT_TABLE || r.event_object_table,
      timing: r.ACTION_TIMING || r.action_timing,
      event: r.EVENT_MANIPULATION || r.event_manipulation,
    }));
  }

  async getScript(name: string, type: 'view' | 'function' | 'procedure' | 'trigger', databaseName?: string): Promise<string> {
    const targetDb = databaseName || this.config.database;

    if (targetDb) {
      try {
        await this.queryWithRetry(`USE \`${targetDb}\`;`);
      } catch (e) {}
    }

    try {
      if (type === 'view') {
        const [res] = await this.queryWithRetry(`SHOW CREATE VIEW \`${name}\`;`);
        const row = (res as any[])[0];
        return row?.['Create View'] || row?.['create view'] || Object.values(row || {})[1] || `-- Create View ${name}`;
      } else if (type === 'procedure') {
        const [res] = await this.queryWithRetry(`SHOW CREATE PROCEDURE \`${name}\`;`);
        const row = (res as any[])[0];
        return row?.['Create Procedure'] || row?.['create procedure'] || Object.values(row || {})[2] || `-- Create Procedure ${name}`;
      } else if (type === 'function') {
        const [res] = await this.queryWithRetry(`SHOW CREATE FUNCTION \`${name}\`;`);
        const row = (res as any[])[0];
        return row?.['Create Function'] || row?.['create function'] || Object.values(row || {})[2] || `-- Create Function ${name}`;
      } else if (type === 'trigger') {
        const [res] = await this.queryWithRetry(`SHOW CREATE TRIGGER \`${name}\`;`);
        const row = (res as any[])[0];
        return row?.['SQL Original Statement'] || row?.['sql original statement'] || Object.values(row || {})[2] || `-- Create Trigger ${name}`;
      }
    } catch (e: any) {
      return `-- Failed to fetch DDL for ${type} ${name}: ${e.message}`;
    }
    return `-- DDL for ${type} ${name}`;
  }

  async getColumns(tableName: string, databaseName?: string): Promise<ColumnInfo[]> {
    const targetDb = databaseName || this.config.database;
    if (!targetDb) return [];

    const [results] = await this.queryWithRetry(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, COLUMN_COMMENT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${targetDb}' AND TABLE_NAME = '${tableName}' ORDER BY ORDINAL_POSITION;`
    );

    const rows = results as any[];
    return rows.map((r: any) => {
      const colName = r.COLUMN_NAME ?? r.column_name ?? r.Field ?? r.field ?? Object.values(r)[0];
      const dataType = r.DATA_TYPE ?? r.data_type ?? r.Type ?? r.type ?? 'VARCHAR';
      const isNullable = r.IS_NULLABLE ?? r.is_nullable ?? r.Null ?? r.null;
      const colKey = r.COLUMN_KEY ?? r.column_key ?? r.Key ?? r.key;
      const colDef = r.COLUMN_DEFAULT ?? r.column_default ?? r.Default ?? r.default;
      const colComment = r.COLUMN_COMMENT ?? r.column_comment ?? r.Comment ?? r.comment;

      return {
        name: String(colName),
        type: String(dataType).toUpperCase(),
        nullable: isNullable === 'YES' || isNullable === true,
        isPrimaryKey: colKey === 'PRI',
        defaultValue: colDef !== null ? String(colDef) : undefined,
        comment: colComment || undefined,
      };
    });
  }

  async getForeignKeys(tableName: string, databaseName?: string): Promise<ForeignKeyInfo[]> {
    const targetDb = databaseName || this.config.database;
    if (!targetDb) return [];

    const [results] = await this.queryWithRetry(
      `SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = '${targetDb}' AND TABLE_NAME = '${tableName}' AND REFERENCED_TABLE_NAME IS NOT NULL;`
    );

    const rows = results as any[];
    return rows.map((r: any) => ({
      constraintName: r.CONSTRAINT_NAME || r.constraint_name,
      columnName: r.COLUMN_NAME || r.column_name,
      referencedTable: r.REFERENCED_TABLE_NAME || r.referenced_table_name,
      referencedColumn: r.REFERENCED_COLUMN_NAME || r.referenced_column_name,
    }));
  }

  async executeQuery(sql: string, queryId?: number): Promise<QueryResult> {
    const startTime = Date.now();

    const db = this.config.database;
    if (db) {
      try {
        await this.queryWithRetry(`USE \`${db}\`;`);
      } catch (e) {}
    }

    const [results, fields] = await this.queryWithRetry(sql, undefined, queryId);
    const costTimeMs = Date.now() - startTime;

    if (Array.isArray(results)) {
      const columnFields: ColumnInfo[] = (fields || []).map((f: any) => ({
        name: f.name,
        type: String(f.type || 'VARCHAR'),
        nullable: true,
      }));

      return {
        rows: results as any[],
        fields: columnFields,
        affectedRows: results.length,
        costTimeMs,
      };
    } else {
      const okPacket = results as mysql.ResultSetHeader;
      return {
        rows: [],
        fields: [],
        affectedRows: okPacket.affectedRows || 0,
        costTimeMs,
      };
    }
  }

  public get supportsParameterizedQueries(): boolean {
    return true;
  }

  public async executeParameterized(sql: string, params: any[], queryId?: number): Promise<QueryResult> {
    const startTime = Date.now();
    const [results, fields] = await this.queryWithRetry(sql, params, queryId);
    const costTimeMs = Date.now() - startTime;

    if (Array.isArray(results)) {
      return {
        rows: results as any[],
        fields: (fields || []).map((f: any) => ({ name: f.name, type: String(f.type || 'VARCHAR'), nullable: true })),
        affectedRows: results.length,
        costTimeMs,
      };
    }
    return {
      rows: [],
      fields: [],
      affectedRows: (results as any)?.affectedRows || 0,
      costTimeMs,
    };
  }

  async getTableData(tableName: string, params: PageParams, schemaName?: string): Promise<QueryResult> {
    const db = this.config.database || schemaName;
    const tableRef = db ? `\`${db}\`.\`${tableName}\`` : `\`${tableName}\``;
    const columns = await this.getColumns(tableName, db);
    const query = buildPagedQuery({ dbType: 'MySQL', tableRef, params, columns });

    const countRes = query.countParams.length
      ? await this.executeParameterized(query.countSql, query.countParams)
      : await this.executeQuery(query.countSql);
    const totalCount = parseInt(countRes.rows[0]?.total || '0', 10);

    const result = query.rowsParams.length
      ? await this.executeParameterized(query.rowsSql, query.rowsParams)
      : await this.executeQuery(query.rowsSql);
    result.totalCount = totalCount;
    return finishPage(result, query.reversed);
  }
}
