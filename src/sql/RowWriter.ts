import { BaseDriver } from '../drivers/BaseDriver.js';

export interface BoundStatement {
  sql: string;
  params: any[];
}

/** Minimal surface a RowWriter needs, so tests do not need a live driver. */
export interface Dialect {
  placeholder(index: number): string;
}

export function quoteId(dbType: string, name: string): string {
  if (dbType === 'MySQL') {
    // Backticks are escaped by doubling; an identifier can never contain a NUL.
    return `\`${String(name).replace(/`/g, '``')}\``;
  }
  if (dbType === 'SQLServer') {
    return `[${String(name).replace(/]/g, ']]')}]`;
  }
  return `"${String(name).replace(/"/g, '""')}"`;
}

export function formatTableRef(dbType: string, tableName: string, schemaName?: string, databaseName?: string): string {
  if (dbType === 'SQLServer') {
    return `${quoteId(dbType, schemaName || 'dbo')}.${quoteId(dbType, tableName)}`;
  }
  if (dbType === 'MySQL') {
    const db = databaseName || (schemaName && schemaName !== 'public' ? schemaName : undefined);
    return db
      ? `${quoteId(dbType, db)}.${quoteId(dbType, tableName)}`
      : quoteId(dbType, tableName);
  }
  if (dbType === 'SQLite') {
    return quoteId(dbType, tableName);
  }
  return `${quoteId(dbType, schemaName || 'public')}.${quoteId(dbType, tableName)}`;
}

/**
 * Builds statements whose values are always bound, never interpolated. The
 * caller passes the dialect so PostgreSQL gets $1, $2 and the rest get ?.
 */
export class RowWriter {
  private params: any[] = [];

  constructor(private dialect: Dialect, private dbType: string, private tableRef: string) {}

  private bind(value: any): string {
    this.params.push(value === undefined ? null : value);
    return this.dialect.placeholder(this.params.length);
  }

  private whereKey(rowKey: Record<string, any>): string {
    return Object.keys(rowKey)
      .map((k) => {
        const col = quoteId(this.dbType, k);
        // NULL never equals NULL, so a nullable key column needs IS NULL.
        const value = rowKey[k];
        return value === null || value === undefined ? `${col} IS NULL` : `${col} = ${this.bind(value)}`;
      })
      .join(' AND ');
  }

  public insert(rowData: Record<string, any>): BoundStatement {
    const keys = Object.keys(rowData);
    if (keys.length === 0) {
      throw new Error('Nothing to insert.');
    }
    const cols = keys.map((k) => quoteId(this.dbType, k)).join(', ');
    const values = keys.map((k) => this.bind(rowData[k])).join(', ');
    return { sql: `INSERT INTO ${this.tableRef} (${cols}) VALUES (${values});`, params: this.params };
  }

  public update(columnName: string, value: any, rowKey: Record<string, any>): BoundStatement {
    if (Object.keys(rowKey).length === 0) {
      throw new Error('Refusing to update without a row key.');
    }
    // SET is bound before WHERE so numbered placeholders stay in argument order.
    const set = `${quoteId(this.dbType, columnName)} = ${this.bind(value)}`;
    const where = this.whereKey(rowKey);
    return { sql: `UPDATE ${this.tableRef} SET ${set} WHERE ${where};`, params: this.params };
  }

  public delete(rowKey: Record<string, any>): BoundStatement {
    if (Object.keys(rowKey).length === 0) {
      throw new Error('Refusing to delete without a row key.');
    }
    return { sql: `DELETE FROM ${this.tableRef} WHERE ${this.whereKey(rowKey)};`, params: this.params };
  }
}

/**
 * Last-resort literal substitution for drivers with no binding API. Kept in one
 * place so the escaping rules are auditable rather than scattered.
 */
export function inlineParams(sql: string, params: any[]): string {
  let index = 0;
  return sql.replace(/\?/g, () => {
    const value = params[index++];
    if (value === null || value === undefined) {
      return 'NULL';
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value);
    }
    if (typeof value === 'boolean') {
      return value ? 'TRUE' : 'FALSE';
    }
    if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    }
    return `'${String(value).replace(/'/g, "''")}'`;
  });
}

/** Runs a bound statement, using real parameters wherever the driver supports them. */
export async function runBound(driver: BaseDriver, statement: BoundStatement) {
  if (driver.supportsParameterizedQueries) {
    return driver.executeParameterized(statement.sql, statement.params);
  }
  return driver.executeQuery(inlineParams(statement.sql, statement.params));
}
