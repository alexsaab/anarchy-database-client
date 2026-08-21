import { ColumnInfo } from '../model/QueryTypes.js';
import { quoteId } from './RowWriter.js';

export interface KeyColumn {
  name: string;
  direction: 'ASC' | 'DESC';
}

export interface KeysetClause {
  /** SQL fragment with `?` placeholders, or '' when keyset paging cannot apply. */
  sql: string;
  params: any[];
  /** ORDER BY fragment matching the clause, already reversed for 'prev'. */
  orderBy: string;
  /** True when rows come back in reverse and must be flipped before display. */
  reversed: boolean;
}

/**
 * Chooses the columns that make a total order over the table: the requested
 * sort column, then the primary key to break ties.
 *
 * Returns null when no such order exists, in which case the caller must fall
 * back to OFFSET -- keyset paging with a non-unique order silently skips or
 * repeats rows.
 */
export function keyColumnsFor(
  columns: ColumnInfo[],
  sortField?: string,
  sortOrder?: 'ASC' | 'DESC'
): KeyColumn[] | null {
  const primaryKeys = columns.filter((c) => c.isPrimaryKey);
  if (primaryKeys.length === 0) {
    return null;
  }

  const direction: 'ASC' | 'DESC' = sortOrder === 'DESC' ? 'DESC' : 'ASC';
  const keys: KeyColumn[] = [];

  if (sortField) {
    const sortColumn = columns.find((c) => c.name === sortField);
    if (!sortColumn) {
      return null;
    }
    // A NULL in the ordering column makes every comparison unknown, so those
    // rows would be skipped. Such a sort falls back to OFFSET.
    if (sortColumn.nullable !== false && !sortColumn.isPrimaryKey) {
      return null;
    }
    keys.push({ name: sortField, direction });
  }

  for (const pk of primaryKeys) {
    if (!keys.some((k) => k.name === pk.name)) {
      keys.push({ name: pk.name, direction });
    }
  }

  return keys.length > 0 ? keys : null;
}

/**
 * Builds the "rows after this one" predicate as an expanded lexicographic
 * comparison rather than a row-value constructor, because SQL Server does not
 * support `(a, b) > (?, ?)`.
 *
 * For keys (a ASC, b ASC) and cursor (1, 5) going forwards this produces
 *   (a > 1) OR (a = 1 AND b > 5)
 */
export function buildKeysetClause(
  dbType: string,
  keys: KeyColumn[],
  cursor: Record<string, any>,
  direction: 'next' | 'prev'
): KeysetClause {
  const usable =
    keys.length > 0 &&
    keys.every((k) => {
      const value = cursor[k.name];
      return value !== undefined && value !== null;
    });

  if (!usable) {
    return { sql: '', params: [], orderBy: '', reversed: false };
  }

  const groups: string[] = [];
  const params: any[] = [];

  for (let i = 0; i < keys.length; i++) {
    const parts: string[] = [];
    for (let j = 0; j < i; j++) {
      parts.push(`${quoteId(dbType, keys[j].name)} = ?`);
      params.push(cursor[keys[j].name]);
    }
    // Going backwards flips every comparison, and so does a DESC column.
    const ascending = keys[i].direction === 'ASC';
    const forwards = direction === 'next';
    const operator = ascending === forwards ? '>' : '<';
    parts.push(`${quoteId(dbType, keys[i].name)} ${operator} ?`);
    params.push(cursor[keys[i].name]);
    groups.push(`(${parts.join(' AND ')})`);
  }

  // Reading backwards needs the reversed order to find the nearest rows; the
  // caller flips them again so the page still reads top to bottom.
  const reversed = direction === 'prev';
  const orderBy = keys
    .map((k) => {
      const dir = reversed ? (k.direction === 'ASC' ? 'DESC' : 'ASC') : k.direction;
      return `${quoteId(dbType, k.name)} ${dir}`;
    })
    .join(', ');

  return { sql: `(${groups.join(' OR ')})`, params, orderBy, reversed };
}

/** ORDER BY for the first page, where there is no cursor yet. */
export function keysetOrderBy(dbType: string, keys: KeyColumn[]): string {
  return keys.map((k) => `${quoteId(dbType, k.name)} ${k.direction}`).join(', ');
}

/** Extracts a cursor from a row: just the key columns. */
export function cursorFrom(row: any, keys: KeyColumn[]): Record<string, any> {
  const cursor: Record<string, any> = {};
  for (const k of keys) {
    cursor[k.name] = row?.[k.name];
  }
  return cursor;
}
