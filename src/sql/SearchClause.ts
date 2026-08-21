import { ColumnInfo } from '../model/QueryTypes.js';
import { quoteId } from './RowWriter.js';

export interface SearchClause {
  /** SQL fragment with `?` placeholders, or '' when nothing should be filtered. */
  sql: string;
  params: string[];
}

/**
 * Builds a case-insensitive "contains" filter across every column.
 *
 * Values are bound, and the term's LIKE metacharacters are escaped, so a search
 * for `100%` looks for that text rather than matching everything.
 */
export function buildSearchClause(dbType: string, columns: ColumnInfo[], term: string): SearchClause {
  const trimmed = String(term ?? '').trim();
  if (!trimmed || columns.length === 0) {
    return { sql: '', params: [] };
  }

  // \ escapes the wildcards; the ESCAPE clause below makes that explicit.
  const escaped = trimmed.replace(/([\\%_])/g, '\\$1');
  const pattern = `%${escaped}%`;

  const parts: string[] = [];
  const params: string[] = [];

  for (const column of columns) {
    const id = quoteId(dbType, column.name);
    if (dbType === 'PostgreSQL') {
      // Cast so numeric, date and json columns are searchable as text too.
      parts.push(`CAST(${id} AS TEXT) ILIKE ? ESCAPE '\\'`);
    } else if (dbType === 'MySQL') {
      // MySQL string comparison is case-insensitive under the usual collations.
      parts.push(`CAST(${id} AS CHAR) LIKE ? ESCAPE '\\\\'`);
    } else {
      parts.push(`CAST(${id} AS TEXT) LIKE ? ESCAPE '\\'`);
    }
    params.push(pattern);
  }

  return { sql: `(${parts.join(' OR ')})`, params };
}

/** SQLite's LIKE is case-insensitive for ASCII only; UPPER() widens that a little. */
export function sqliteSearchClause(columns: ColumnInfo[], term: string): SearchClause {
  const trimmed = String(term ?? '').trim();
  if (!trimmed || columns.length === 0) {
    return { sql: '', params: [] };
  }
  const escaped = trimmed.replace(/([\\%_])/g, '\\$1');
  const pattern = `%${escaped.toUpperCase()}%`;
  const parts = columns.map((c) => `UPPER(CAST(${quoteId('SQLite', c.name)} AS TEXT)) LIKE ? ESCAPE '\\'`);
  return { sql: `(${parts.join(' OR ')})`, params: columns.map(() => pattern) };
}
