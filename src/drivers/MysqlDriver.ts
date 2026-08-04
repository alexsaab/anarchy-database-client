import mysql from 'mysql2/promise';
import { BaseDriver, ForeignKeyInfo, RoutineInfo, TriggerInfo } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';

export class MysqlDriver extends BaseDriver {
  private connection: mysql.Connection | null = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config, password);
  }

  async connect(): Promise<void> {
    if (!this.isConnected) {
      this.connection = await mysql.createConnection({
        host: this.config.host || 'localhost',
        port: this.config.port || 3306,
        user: this.config.user || 'root',
        password: this.password || '',
        database: this.config.database || undefined,
        multipleStatements: true,
      });
      this.isConnected = true;
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
      this.connection = null;
      this.isConnected = false;
    }
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      await this.connect();
      await this.connection!.ping();
      return { success: true, message: 'Successfully connected to MySQL database!' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    } finally {
      await this.disconnect();
    }
  }

  async getDatabases(): Promise<string[]> {
    const res = await this.executeQuery('SHOW DATABASES;');
    return res.rows
      .map((r: any) => r.Database || r.database)
      .filter((db: string) => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(db));
  }

  async getTables(databaseName?: string): Promise<TableInfo[]> {
    const db = databaseName || this.config.database;
    if (db) {
      await this.executeQuery(`USE \`${db}\`;`);
    }
    const res = await this.executeQuery('SHOW FULL TABLES WHERE Table_type = "BASE TABLE";');
    return res.rows.map((r: any) => {
      const keys = Object.keys(r);
      const tableName = r[keys[0]];
      return {
        name: tableName,
        type: 'table',
      };
    });
  }

  async getViews(databaseName?: string): Promise<TableInfo[]> {
    const db = databaseName || this.config.database;
    if (db) {
      await this.executeQuery(`USE \`${db}\`;`);
    }
    const res = await this.executeQuery('SHOW FULL TABLES WHERE Table_type = "VIEW";');
    return res.rows.map((r: any) => {
      const keys = Object.keys(r);
      return {
        name: r[keys[0]],
        type: 'view',
      };
    });
  }

  async getFunctions(databaseName?: string): Promise<RoutineInfo[]> {
    const db = databaseName || this.config.database;
    const res = await this.executeQuery(
      `SELECT ROUTINE_NAME, ROUTINE_COMMENT FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = '${db}' AND ROUTINE_TYPE = 'FUNCTION';`
    );
    return res.rows.map((r: any) => ({
      name: r.ROUTINE_NAME || r.routine_name,
      type: 'FUNCTION',
      comment: r.ROUTINE_COMMENT || r.routine_comment,
    }));
  }

  async getProcedures(databaseName?: string): Promise<RoutineInfo[]> {
    const db = databaseName || this.config.database;
    const res = await this.executeQuery(
      `SELECT ROUTINE_NAME, ROUTINE_COMMENT FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = '${db}' AND ROUTINE_TYPE = 'PROCEDURE';`
    );
    return res.rows.map((r: any) => ({
      name: r.ROUTINE_NAME || r.routine_name,
      type: 'PROCEDURE',
      comment: r.ROUTINE_COMMENT || r.routine_comment,
    }));
  }

  async getTriggers(databaseName?: string): Promise<TriggerInfo[]> {
    const db = databaseName || this.config.database;
    const res = await this.executeQuery(
      `SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = '${db}';`
    );
    return res.rows.map((r: any) => ({
      name: r.TRIGGER_NAME || r.trigger_name,
      table: r.EVENT_OBJECT_TABLE || r.event_object_table,
      timing: r.ACTION_TIMING || r.action_timing,
      event: r.EVENT_MANIPULATION || r.event_manipulation,
    }));
  }

  async getScript(name: string, type: 'view' | 'function' | 'procedure' | 'trigger', databaseName?: string): Promise<string> {
    const db = databaseName || this.config.database;
    if (db) {
      await this.executeQuery(`USE \`${db}\`;`);
    }

    try {
      if (type === 'view') {
        const res = await this.executeQuery(`SHOW CREATE VIEW \`${name}\`;`);
        return res.rows[0]?.['Create View'] || res.rows[0]?.['create view'] || `-- Create View ${name}`;
      } else if (type === 'procedure') {
        const res = await this.executeQuery(`SHOW CREATE PROCEDURE \`${name}\`;`);
        return res.rows[0]?.['Create Procedure'] || res.rows[0]?.['create procedure'] || `-- Create Procedure ${name}`;
      } else if (type === 'function') {
        const res = await this.executeQuery(`SHOW CREATE FUNCTION \`${name}\`;`);
        return res.rows[0]?.['Create Function'] || res.rows[0]?.['create function'] || `-- Create Function ${name}`;
      } else if (type === 'trigger') {
        const res = await this.executeQuery(`SHOW CREATE TRIGGER \`${name}\`;`);
        return res.rows[0]?.['SQL Original Statement'] || res.rows[0]?.['sql original statement'] || `-- Create Trigger ${name}`;
      }
    } catch (e: any) {
      return `-- Failed to fetch DDL for ${type} ${name}: ${e.message}`;
    }
    return `-- DDL for ${type} ${name}`;
  }

  async getColumns(tableName: string, databaseName?: string): Promise<ColumnInfo[]> {
    const db = databaseName || this.config.database;
    if (db) {
      await this.executeQuery(`USE \`${db}\`;`);
    }
    const res = await this.executeQuery(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, COLUMN_COMMENT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${db}' AND TABLE_NAME = '${tableName}' ORDER BY ORDINAL_POSITION;`
    );

    return res.rows.map((r: any) => {
      const colName = r.COLUMN_NAME ?? r.column_name ?? r.Field ?? r.field;
      const dataType = r.DATA_TYPE ?? r.data_type ?? r.Type ?? r.type ?? 'VARCHAR';
      const isNullable = r.IS_NULLABLE ?? r.is_nullable ?? r.Null ?? r.null;
      const colKey = r.COLUMN_KEY ?? r.column_key ?? r.Key ?? r.key;
      const colDef = r.COLUMN_DEFAULT ?? r.column_default ?? r.Default ?? r.default;
      const colComment = r.COLUMN_COMMENT ?? r.column_comment ?? r.Comment ?? r.comment;

      return {
        name: colName,
        type: String(dataType).toUpperCase(),
        nullable: isNullable === 'YES' || isNullable === true,
        isPrimaryKey: colKey === 'PRI',
        defaultValue: colDef !== null ? String(colDef) : undefined,
        comment: colComment || undefined,
      };
    });
  }

  async getForeignKeys(tableName: string, databaseName?: string): Promise<ForeignKeyInfo[]> {
    const db = databaseName || this.config.database;
    const res = await this.executeQuery(
      `SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = '${db}' AND TABLE_NAME = '${tableName}' AND REFERENCED_TABLE_NAME IS NOT NULL;`
    );

    return res.rows.map((r: any) => ({
      constraintName: r.CONSTRAINT_NAME || r.constraint_name,
      columnName: r.COLUMN_NAME || r.column_name,
      referencedTable: r.REFERENCED_TABLE_NAME || r.referenced_table_name,
      referencedColumn: r.REFERENCED_COLUMN_NAME || r.referenced_column_name,
    }));
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    await this.connect();
    const startTime = Date.now();

    const db = this.config.database;
    if (db) {
      await this.connection!.query(`USE \`${db}\`;`);
    }

    const [results, fields] = await this.connection!.query(sql);
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

  async getTableData(tableName: string, params: PageParams, schemaName?: string): Promise<QueryResult> {
    const offset = (params.page - 1) * params.pageSize;
    const db = this.config.database;
    const tableRef = `\`${tableName}\``;

    let sql = `SELECT * FROM ${tableRef}`;
    let countSql = `SELECT COUNT(*) as total FROM ${tableRef}`;

    if (params.filterSql) {
      sql += ` WHERE ${params.filterSql}`;
      countSql += ` WHERE ${params.filterSql}`;
    }

    sql += ` LIMIT ${params.pageSize} OFFSET ${offset};`;

    if (db) {
      await this.executeQuery(`USE \`${db}\`;`);
    }

    const countRes = await this.executeQuery(countSql);
    const totalCount = parseInt(countRes.rows[0]?.total || '0', 10);

    const queryResult = await this.executeQuery(sql);
    queryResult.totalCount = totalCount;
    return queryResult;
  }
}
