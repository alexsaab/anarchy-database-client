import pg from 'pg';
import { BaseDriver, ForeignKeyInfo, RoutineInfo, TriggerInfo } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';
import { buildSearchClause } from '../sql/SearchClause.js';

export class PostgresDriver extends BaseDriver {
  private client: pg.Client | null = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config, password);
  }

  async connect(): Promise<void> {
    if (this.isConnected && this.client) {
      return;
    }
    await this.connectOnce(async () => {
      if (this.isConnected && this.client) {
        return;
      }
      await this.disconnect().catch(() => {});

      const client = new pg.Client({
        host: this.config.host || 'localhost',
        port: this.config.port || 5432,
        user: this.config.user || 'postgres',
        password: this.password || '',
        database: this.config.database || 'postgres',
        ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
      });

      client.on('error', (err: any) => {
        // Only retire the client if it is still the active one: a later
        // reconnect may already have replaced it.
        if (this.client === client) {
          this.isConnected = false;
          this.client = null;
          this.markLost(err);
        }
      });
      client.on('end', () => {
        if (this.client === client) {
          this.isConnected = false;
          this.client = null;
        }
      });

      await client.connect();
      this.client = client;
      this.isConnected = true;
    });
  }

  /**
   * Returns a live client. Never hand out this.client directly: it can be
   * nulled by an 'error' event between the await and the call site.
   */
  private async acquireClient(): Promise<pg.Client> {
    await this.connect();
    const client = this.client;
    if (!client) {
      throw Object.assign(new Error('Connection to the database was lost.'), { code: 'CONNECTION_CLOSED' });
    }
    return client;
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    if (this.client) {
      this.client.removeAllListeners('error');
      this.client.removeAllListeners('end');
      try {
        await this.client.end();
      } catch (e) {}
      this.client = null;
    }
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      const client = await this.acquireClient();
      await client.query('SELECT 1;');
      return { success: true, message: 'Successfully connected to PostgreSQL database!' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    } finally {
      await this.disconnect();
    }
  }

  async getDatabases(): Promise<string[]> {
    const res = await this.executeQuery("SELECT datname FROM pg_database WHERE datistemplate = false AND datname != 'postgres' ORDER BY datname;");
    return ['postgres', ...res.rows.map((r: any) => r.datname)];
  }

  async getSchemas(databaseName?: string): Promise<string[]> {
    const res = await this.executeQuery("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema') ORDER BY schema_name;");
    return res.rows.map((r: any) => r.schema_name);
  }

  async getTables(databaseName?: string, schemaName: string = 'public'): Promise<TableInfo[]> {
    const res = await this.executeQuery(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schemaName}' AND table_type = 'BASE TABLE' ORDER BY table_name;`
    );
    return res.rows.map((r: any) => ({
      name: r.table_name,
      type: 'table',
      schema: schemaName,
    }));
  }

  async getViews(databaseName?: string, schemaName: string = 'public'): Promise<TableInfo[]> {
    const res = await this.executeQuery(
      `SELECT table_name FROM information_schema.views WHERE table_schema = '${schemaName}' ORDER BY table_name;`
    );
    return res.rows.map((r: any) => ({
      name: r.table_name,
      type: 'view',
      schema: schemaName,
    }));
  }

  async getFunctions(databaseName?: string, schemaName: string = 'public'): Promise<RoutineInfo[]> {
    const res = await this.executeQuery(
      `SELECT routine_name FROM information_schema.routines WHERE routine_schema = '${schemaName}' AND routine_type = 'FUNCTION' ORDER BY routine_name;`
    );
    return res.rows.map((r: any) => ({
      name: r.routine_name,
      type: 'FUNCTION',
    }));
  }

  async getProcedures(databaseName?: string, schemaName: string = 'public'): Promise<RoutineInfo[]> {
    const res = await this.executeQuery(
      `SELECT routine_name FROM information_schema.routines WHERE routine_schema = '${schemaName}' AND routine_type = 'PROCEDURE' ORDER BY routine_name;`
    );
    return res.rows.map((r: any) => ({
      name: r.routine_name,
      type: 'PROCEDURE',
    }));
  }

  async getTriggers(databaseName?: string, schemaName: string = 'public'): Promise<TriggerInfo[]> {
    const res = await this.executeQuery(
      `SELECT trigger_name, event_object_table, action_timing, event_manipulation FROM information_schema.triggers WHERE trigger_schema = '${schemaName}' ORDER BY trigger_name;`
    );
    return res.rows.map((r: any) => ({
      name: r.trigger_name,
      table: r.event_object_table,
      timing: r.action_timing,
      event: r.event_manipulation,
    }));
  }

  async getScript(name: string, type: 'view' | 'function' | 'procedure' | 'trigger', databaseName?: string, schemaName: string = 'public'): Promise<string> {
    try {
      if (type === 'view') {
        const res = await this.executeQuery(`SELECT pg_get_viewdef('"${schemaName}"."${name}"', true) as def;`);
        return `CREATE OR REPLACE VIEW "${schemaName}"."${name}" AS\n` + (res.rows[0]?.def || '');
      } else if (type === 'function' || type === 'procedure') {
        const res = await this.executeQuery(`SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname = '${name}';`);
        return res.rows[0]?.def || `-- DDL for ${name}`;
      }
    } catch (e: any) {
      return `-- Failed to fetch DDL for ${type} ${name}: ${e.message}`;
    }
    return `-- DDL for ${type} ${name}`;
  }

  async getColumns(tableName: string, databaseName?: string, schemaName: string = 'public'): Promise<ColumnInfo[]> {
    const res = await this.executeQuery(
      `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default, pgd.description as comment
       FROM information_schema.columns c
       LEFT JOIN pg_catalog.pg_statio_all_tables st ON st.schemaname = c.table_schema AND st.relname = c.table_name
       LEFT JOIN pg_catalog.pg_description pgd ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
       WHERE c.table_schema = '${schemaName}' AND c.table_name = '${tableName}'
       ORDER BY c.ordinal_position;`
    );

    const pkRes = await this.executeQuery(
      `SELECT kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = '${schemaName}' AND tc.table_name = '${tableName}';`
    );

    const primaryKeys = new Set(pkRes.rows.map((r: any) => r.column_name));

    return res.rows.map((r: any) => ({
      name: r.column_name,
      type: String(r.data_type).toUpperCase(),
      nullable: r.is_nullable === 'YES',
      isPrimaryKey: primaryKeys.has(r.column_name),
      defaultValue: r.column_default || undefined,
      comment: r.comment || undefined,
    }));
  }

  async getForeignKeys(tableName: string, databaseName?: string, schemaName: string = 'public'): Promise<ForeignKeyInfo[]> {
    const res = await this.executeQuery(
      `SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS referenced_table_name, ccu.column_name AS referenced_column_name FROM information_schema.table_constraints AS tc JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = '${schemaName}' AND tc.table_name = '${tableName}';`
    );

    return res.rows.map((r: any) => ({
      constraintName: r.constraint_name,
      columnName: r.column_name,
      referencedTable: r.referenced_table_name,
      referencedColumn: r.referenced_column_name,
    }));
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    const runQuery = async () => {
      const client = await this.acquireClient();
      const startTime = Date.now();
      const result = await client.query(sql);
      const costTimeMs = Date.now() - startTime;

      const columnFields: ColumnInfo[] = (result.fields || []).map((f: any) => ({
        name: f.name,
        type: String(f.dataTypeID),
        nullable: true,
      }));

      return {
        rows: result.rows || [],
        fields: columnFields,
        affectedRows: result.rowCount || 0,
        costTimeMs,
      };
    };

    return this.withReconnect(runQuery);
  }

  public get supportsParameterizedQueries(): boolean {
    return true;
  }

  public placeholder(index: number): string {
    return `$${index}`;
  }

  public async executeParameterized(sql: string, params: any[]): Promise<QueryResult> {
    return this.withReconnect(async () => {
      const client = await this.acquireClient();
      const startTime = Date.now();
      const result = await client.query(sql, params);
      return {
        rows: result.rows || [],
        fields: (result.fields || []).map((f: any) => ({ name: f.name, type: String(f.dataTypeID), nullable: true })),
        affectedRows: result.rowCount || 0,
        costTimeMs: Date.now() - startTime,
      };
    });
  }

  async getTableData(tableName: string, params: PageParams, schemaName: string = 'public'): Promise<QueryResult> {
    const offset = (params.page - 1) * params.pageSize;
    const tableRef = `"${schemaName}"."${tableName}"`;

    const conditions: string[] = [];
    const searchParams: any[] = [];

    if (params.filterSql) {
      conditions.push(`(${params.filterSql})`);
    }

    if (params.searchTerm) {
      const columns = await this.getColumns(tableName, this.config.database, schemaName);
      const clause = buildSearchClause('PostgreSQL', columns, params.searchTerm);
      if (clause.sql) {
        conditions.push(clause.sql);
        searchParams.push(...clause.params);
      }
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    // Placeholders are numbered, so rewrite the shared `?` form in order.
    let index = 0;
    const number = (sql: string) => sql.replace(/\?/g, () => `$${++index}`);

    const countSql = number(`SELECT COUNT(*) as total FROM ${tableRef}${where}`);
    const countRes = searchParams.length
      ? await this.executeParameterized(countSql, searchParams)
      : await this.executeQuery(countSql);
    const totalCount = parseInt(countRes.rows[0]?.total || '0', 10);

    index = 0;
    let sql = number(`SELECT * FROM ${tableRef}${where}`);
    if (params.sortField) {
      const order = params.sortOrder === 'DESC' ? 'DESC' : 'ASC';
      sql += ` ORDER BY "${params.sortField}" ${order}`;
    }
    sql += ` LIMIT ${params.pageSize} OFFSET ${offset};`;

    const queryResult = searchParams.length
      ? await this.executeParameterized(sql, searchParams)
      : await this.executeQuery(sql);
    queryResult.totalCount = totalCount;
    return queryResult;
  }
}
