import pg from 'pg';
import { BaseDriver, ForeignKeyInfo, RoutineInfo, TriggerInfo } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';

export class PostgresDriver extends BaseDriver {
  private client: pg.Client | null = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config, password);
  }

  async connect(): Promise<void> {
    if (!this.isConnected) {
      this.client = new pg.Client({
        host: this.config.host || 'localhost',
        port: this.config.port || 5432,
        user: this.config.user || 'postgres',
        password: this.password || '',
        database: this.config.database || 'postgres',
        ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
      });
      await this.client.connect();
      this.isConnected = true;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
      this.isConnected = false;
    }
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      await this.connect();
      await this.client!.query('SELECT 1;');
      return { success: true, message: 'Successfully connected to PostgreSQL database!' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    } finally {
      await this.disconnect();
    }
  }

  async getDatabases(): Promise<string[]> {
    const res = await this.executeQuery("SELECT datname FROM pg_database WHERE datistemplate = false AND datname != 'postgres';");
    return ['postgres', ...res.rows.map((r: any) => r.datname)];
  }

  async getSchemas(databaseName?: string): Promise<string[]> {
    const res = await this.executeQuery("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema');");
    return res.rows.map((r: any) => r.schema_name);
  }

  async getTables(databaseName?: string, schemaName: string = 'public'): Promise<TableInfo[]> {
    const res = await this.executeQuery(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schemaName}' AND table_type = 'BASE TABLE';`
    );
    return res.rows.map((r: any) => ({
      name: r.table_name,
      type: 'table',
      schema: schemaName,
    }));
  }

  async getViews(databaseName?: string, schemaName: string = 'public'): Promise<TableInfo[]> {
    const res = await this.executeQuery(
      `SELECT table_name FROM information_schema.views WHERE table_schema = '${schemaName}';`
    );
    return res.rows.map((r: any) => ({
      name: r.table_name,
      type: 'view',
      schema: schemaName,
    }));
  }

  async getFunctions(databaseName?: string, schemaName: string = 'public'): Promise<RoutineInfo[]> {
    const res = await this.executeQuery(
      `SELECT routine_name FROM information_schema.routines WHERE routine_schema = '${schemaName}' AND routine_type = 'FUNCTION';`
    );
    return res.rows.map((r: any) => ({
      name: r.routine_name,
      type: 'FUNCTION',
    }));
  }

  async getProcedures(databaseName?: string, schemaName: string = 'public'): Promise<RoutineInfo[]> {
    const res = await this.executeQuery(
      `SELECT routine_name FROM information_schema.routines WHERE routine_schema = '${schemaName}' AND routine_type = 'PROCEDURE';`
    );
    return res.rows.map((r: any) => ({
      name: r.routine_name,
      type: 'PROCEDURE',
    }));
  }

  async getTriggers(databaseName?: string, schemaName: string = 'public'): Promise<TriggerInfo[]> {
    const res = await this.executeQuery(
      `SELECT trigger_name, event_object_table, action_timing, event_manipulation FROM information_schema.triggers WHERE trigger_schema = '${schemaName}';`
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
    await this.connect();
    const startTime = Date.now();
    const result = await this.client!.query(sql);
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
  }

  async getTableData(tableName: string, params: PageParams, schemaName: string = 'public'): Promise<QueryResult> {
    const offset = (params.page - 1) * params.pageSize;
    const tableRef = `"${schemaName}"."${tableName}"`;

    let sql = `SELECT * FROM ${tableRef}`;
    let countSql = `SELECT COUNT(*) as total FROM ${tableRef}`;

    if (params.filterSql) {
      sql += ` WHERE ${params.filterSql}`;
      countSql += ` WHERE ${params.filterSql}`;
    }

    sql += ` LIMIT ${params.pageSize} OFFSET ${offset};`;

    const countRes = await this.executeQuery(countSql);
    const totalCount = parseInt(countRes.rows[0]?.total || '0', 10);

    const queryResult = await this.executeQuery(sql);
    queryResult.totalCount = totalCount;
    return queryResult;
  }
}
