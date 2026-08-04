import { Client } from 'pg';
import { BaseDriver, ForeignKeyInfo } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';

export class PostgresDriver extends BaseDriver {
  private client: Client | null = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config, password);
  }

  private createClient(databaseName?: string): Client {
    return new Client({
      host: this.config.host || 'localhost',
      port: this.config.port || 5432,
      user: this.config.user || 'postgres',
      password: this.password || '',
      database: databaseName || this.config.database || 'postgres',
      ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 5000,
    });
  }

  async connect(): Promise<void> {
    if (this.client) {
      await this.disconnect();
    }
    this.client = this.createClient();
    await this.client.connect();
    this.isConnected = true;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.end();
      } catch (e) {
        // Ignore disconnect errors
      }
      this.client = null;
      this.isConnected = false;
    }
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    const tempClient = this.createClient();
    try {
      await tempClient.connect();
      await tempClient.query('SELECT 1');
      await tempClient.end();
      return { success: true, message: 'Successfully connected to PostgreSQL database!' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    }
  }

  async getDatabases(): Promise<string[]> {
    const res = await this.executeQuery(
      "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname ASC;"
    );
    return res.rows.map((r) => r.datname);
  }

  async getSchemas(databaseName?: string): Promise<string[]> {
    const res = await this.executeQuery(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast') ORDER BY schema_name ASC;"
    );
    const schemas = res.rows.map((r) => r.schema_name);
    return schemas.length > 0 ? schemas : ['public'];
  }

  async getTables(databaseName?: string, schemaName?: string): Promise<TableInfo[]> {
    let whereClause = "table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast')";
    if (schemaName) {
      whereClause = `table_schema = '${schemaName}'`;
    }

    const sql = `
      SELECT table_schema, table_name, table_type
      FROM information_schema.tables
      WHERE ${whereClause}
      ORDER BY table_name ASC;
    `;
    const res = await this.executeQuery(sql);
    return res.rows.map((r) => ({
      name: r.table_name,
      schema: r.table_schema || schemaName || 'public',
      type: r.table_type === 'VIEW' ? 'view' : 'table',
    }));
  }

  async getColumns(tableName: string, databaseName?: string, schemaName: string = 'public'): Promise<ColumnInfo[]> {
    const sql = `
      SELECT 
        c.column_name, 
        c.data_type, 
        c.is_nullable, 
        c.column_default,
        COALESCE(tc.constraint_type, '') as constraint_type,
        pgd.description as comment
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.table_schema, kcu.table_name, kcu.column_name, tc.constraint_type
        FROM information_schema.key_column_usage kcu
        JOIN information_schema.table_constraints tc
          ON kcu.table_schema = tc.table_schema 
          AND kcu.table_name = tc.table_name 
          AND kcu.constraint_name = tc.constraint_name 
          AND tc.constraint_type = 'PRIMARY KEY'
      ) tc
        ON c.table_schema = tc.table_schema 
        AND c.table_name = tc.table_name 
        AND c.column_name = tc.column_name
      LEFT JOIN pg_catalog.pg_statio_all_tables st 
        ON c.table_schema = st.schemaname AND c.table_name = st.relname
      LEFT JOIN pg_catalog.pg_description pgd 
        ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
      WHERE c.table_schema = '${schemaName}' AND c.table_name = '${tableName}'
      ORDER BY c.ordinal_position ASC;
    `;
    const res = await this.executeQuery(sql);
    return res.rows.map((r) => ({
      name: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === 'YES',
      isPrimaryKey: r.constraint_type === 'PRIMARY KEY',
      defaultValue: r.column_default,
      comment: r.comment || undefined,
    }));
  }

  async getForeignKeys(tableName: string, databaseName?: string, schemaName: string = 'public'): Promise<ForeignKeyInfo[]> {
    const sql = `
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = '${schemaName}' AND tc.table_name = '${tableName}';
    `;
    try {
      const res = await this.executeQuery(sql);
      return res.rows.map((r) => ({
        columnName: r.column_name,
        foreignTableName: r.foreign_table_name,
        foreignColumnName: r.foreign_column_name,
      }));
    } catch (e) {
      return [];
    }
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    if (!this.client) {
      await this.connect();
    }
    const startTime = Date.now();
    const res = await this.client!.query(sql);
    const costTimeMs = Date.now() - startTime;

    const fields: ColumnInfo[] = (res.fields || []).map((f) => ({
      name: f.name,
      type: 'unknown',
      nullable: true,
    }));

    return {
      rows: res.rows || [],
      fields,
      affectedRows: res.rowCount || 0,
      costTimeMs,
    };
  }

  async getTableData(tableName: string, params: PageParams, schemaName: string = 'public'): Promise<QueryResult> {
    const offset = (params.page - 1) * params.pageSize;
    let sql = `SELECT * FROM "${schemaName}"."${tableName}"`;

    if (params.filterSql) {
      sql += ` WHERE ${params.filterSql}`;
    }

    if (params.sortField && params.sortOrder) {
      sql += ` ORDER BY "${params.sortField}" ${params.sortOrder}`;
    }

    sql += ` LIMIT ${params.pageSize} OFFSET ${offset};`;

    const countSql = `SELECT COUNT(*) as total FROM "${schemaName}"."${tableName}"`;
    const countRes = await this.executeQuery(countSql);
    const totalCount = parseInt(countRes.rows[0]?.total || '0', 10);

    const queryResult = await this.executeQuery(sql);
    queryResult.totalCount = totalCount;
    return queryResult;
  }
}
