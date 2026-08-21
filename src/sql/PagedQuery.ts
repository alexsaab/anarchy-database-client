import { ColumnInfo, PageParams, QueryResult } from '../model/QueryTypes.js';
import { buildSearchClause, sqliteSearchClause } from './SearchClause.js';
import { buildKeysetClause, keyColumnsFor, keysetOrderBy } from './Keyset.js';
import { quoteId } from './RowWriter.js';

export interface PagedQuery {
  countSql: string;
  countParams: any[];
  rowsSql: string;
  rowsParams: any[];
  /** True when rows arrive reversed and must be flipped before display. */
  reversed: boolean;
}

export interface PagedQueryOptions {
  dbType: string;
  tableRef: string;
  params: PageParams;
  columns: ColumnInfo[];
  /** SQL Server needs OFFSET ... FETCH and always requires an ORDER BY. */
  limitStyle?: 'limit-offset' | 'offset-fetch';
}

/**
 * Builds the count and page queries for one table view, sharing filtering,
 * search, sorting and pagination across every SQL driver.
 *
 * Placeholders are the neutral `?`; drivers that number or name their
 * parameters rewrite them in order.
 */
export function buildPagedQuery(options: PagedQueryOptions): PagedQuery {
  const { dbType, tableRef, params, columns } = options;
  const limitStyle = options.limitStyle || 'limit-offset';

  const conditions: string[] = [];
  const filterParams: any[] = [];

  if (params.filterSql) {
    conditions.push(`(${params.filterSql})`);
  }

  if (params.searchTerm) {
    const clause =
      dbType === 'SQLite'
        ? sqliteSearchClause(columns, params.searchTerm)
        : buildSearchClause(dbType, columns, params.searchTerm);
    if (clause.sql) {
      conditions.push(clause.sql);
      filterParams.push(...clause.params);
    }
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const countSql = `SELECT COUNT(*) AS total FROM ${tableRef}${where}`;

  // Keyset paging when a total order exists and a cursor was supplied;
  // otherwise OFFSET, which still supports jumping to an arbitrary page.
  const keys = params.cursor ? keyColumnsFor(columns, params.sortField, params.sortOrder) : null;
  const keyset = keys && params.cursor ? buildKeysetClause(dbType, keys, params.cursor.values, params.cursor.direction) : null;

  const rowsParams = [...filterParams];
  let rowsWhere = where;
  let orderBy: string;
  let reversed = false;

  if (keyset && keyset.sql && keys) {
    rowsWhere = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')} AND ${keyset.sql}` : ` WHERE ${keyset.sql}`;
    rowsParams.push(...keyset.params);
    orderBy = keyset.orderBy;
    reversed = keyset.reversed;
  } else if (params.sortField) {
    const direction = params.sortOrder === 'DESC' ? 'DESC' : 'ASC';
    orderBy = `${quoteId(dbType, params.sortField)} ${direction}`;
  } else if (limitStyle === 'offset-fetch') {
    // OFFSET/FETCH is invalid without ORDER BY; this keeps the shape legal.
    orderBy = '(SELECT NULL)';
  } else {
    orderBy = '';
  }

  const offset = keyset && keyset.sql ? 0 : (params.page - 1) * params.pageSize;
  const orderClause = orderBy ? ` ORDER BY ${orderBy}` : '';

  const tail =
    limitStyle === 'offset-fetch'
      ? ` OFFSET ${offset} ROWS FETCH NEXT ${params.pageSize} ROWS ONLY`
      : ` LIMIT ${params.pageSize} OFFSET ${offset}`;

  return {
    countSql,
    countParams: filterParams,
    rowsSql: `SELECT * FROM ${tableRef}${rowsWhere}${orderClause}${tail}`,
    rowsParams,
    reversed,
  };
}

/** Applies the reversal a backwards keyset page needs. */
export function finishPage(result: QueryResult, reversed: boolean): QueryResult {
  if (reversed && Array.isArray(result.rows)) {
    result.rows = [...result.rows].reverse();
  }
  return result;
}

/** Rewrites neutral `?` placeholders into a dialect's numbered/named form. */
export function renumber(sql: string, format: (index: number) => string): string {
  let index = 0;
  return sql.replace(/\?/g, () => format(++index));
}
